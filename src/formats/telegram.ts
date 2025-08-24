import { Notice, TFolder, TFile, htmlToMarkdown, normalizePath, Setting } from "obsidian";
import { FormatImporter } from "../format-importer";
import { ImportContext } from "../main";
import { parseHTML, sanitizeFileName } from "../util";
import { readZip, ZipEntryFile } from "../zip";
import { PickedFile } from "filesystem";

export enum MergeStrategy {
    NoMerge = 'No Merge',
    ByDate = 'By Date',
    ByHour = 'By Hour',
}

type AttachmentsFolder = string;
// During saving some special characters may be sanitized from file name
// AttachmentInitialName is needed to link attachments files to messages
type AttachmentInitialName = string;
type AttachmentFile = TFile;
type AttachmentsInFolder = Map<AttachmentInitialName, AttachmentFile>;

type LastHandledNoteInfo = {
	note: TFile;
	noteTimestamp: string;
	noteDate: string;
	noteHour: string;
};
type LastHandled = {
	channel: string | null;
	noteInChannel: Record<string, LastHandledNoteInfo>;
};

type MessageInfo = {
	channel: string;
	timestamp: string;
	date: string;
	hour: string;
	content: string;
	attachmentsRawLinks: string[]; // attachment links extracted from HTML (not compatible for use in obsidian notes without processing)
};


const SOURCE_ATTACHMENTS_FOLDERS = [
	'files', 'photos', 'round_video_messages', 'stickers', 'video_files', 'voice_messages'
];
const SOURCE_HTML_FILENAME = 'messages.html';
const OUTPUT_ATTACHMENTS_FOLDER = '_attachments';
const OUTPUT_NO_CHANNEL_MESSAGES_FOLDER = 'My Notes';
const OUTPUT_FOLDER_DEFAULT = 'Telegram import';
const DEFAULT_MERGE_STRATEGY = MergeStrategy.NoMerge;

export class TelegramImporter extends FormatImporter {
	ctx: ImportContext;
	outputFOlder: TFolder;
	sourceZip: PickedFile;
	sourceHtml: string;
	strategy: MergeStrategy = DEFAULT_MERGE_STRATEGY;
	attachments = new Map<AttachmentsFolder, AttachmentsInFolder>();
	lastHandled: LastHandled = {
		channel: null,
		noteInChannel: {},
	};
	totalCount: number;
	handledCount = 0;

	init() {
		this.addFileChooserSetting('Telegram exported folder (under zip)', ['zip'], false);
		this.addOutputLocationSetting(OUTPUT_FOLDER_DEFAULT);
		new Setting(this.modal.contentEl)
			.setName('Merge strategy')
			.setDesc('Allow to set up how to merge messages with same parameters.')
			.addDropdown(dropdown => {
				Object.values(MergeStrategy).forEach(strategy => {
					dropdown.addOption(strategy, strategy);
				});

				dropdown.onChange((value) => {
					this.strategy = value as MergeStrategy;
				});

				dropdown.setValue(DEFAULT_MERGE_STRATEGY);
			});
	}

	async import(ctx: ImportContext): Promise<void> {
		const outputFolder = await this.getOutputFolder();

		if (this.files.length === 0) {
			new Notice('Please provide Telegram export folder (under zip).');
			return;
		}

		if (!outputFolder) {
			new Notice('Please select a location to export to.');
			return;
		}

		this.ctx = ctx;
		this.outputFOlder = outputFolder;
		this.sourceZip = this.files[0];

		try {
			await this.extractZip();
			await this.parseAndSaveMessages();
		} catch (error) {
			this.ctx.reportFailed('Error has happened', `Information: ${error}`);
		}
	}

	private async extractZip() {
		await readZip(this.sourceZip, async (_, entries) => {
			this.sourceHtml = (await entries.find(e => e.name === SOURCE_HTML_FILENAME)?.readText()) || '';
			if (!this.sourceHtml) {
				throw new Error(`${SOURCE_HTML_FILENAME} file not found.`);
			}

			this.ctx.status('Extracting attachments...');
			for (const e of entries) {
				if (this.ctx.isCancelled()) return;
				if (!SOURCE_ATTACHMENTS_FOLDERS.includes(e.parent)) continue;

				const file = await this.saveAttachment(e);

				if (!file) continue;
				
				const attachmentsInFolder = this.attachments.get(e.parent) ?? new Map();
				attachmentsInFolder.set(e.name, file);
				this.attachments.set(e.parent, attachmentsInFolder);
			}
		});
	}

	private async saveAttachment(entry: ZipEntryFile): Promise<TFile | null> {
		const folderPath = normalizePath(`${this.outputFOlder.path}/${OUTPUT_ATTACHMENTS_FOLDER}/${entry.parent}`);
		const folder = await this.createFolders(folderPath);

		const fileName = sanitizeFileName(entry.name); 
		const filePath = `${folder.path}/${fileName}`;
		const fileExists = this.vault.getAbstractFileByPath(filePath);
		if (fileExists) {
			this.ctx.reportSkipped(filePath, 'the file already exists.');
			return null;
		}

		const data = await entry.read();
		const file = await this.vault.createBinary(filePath, data);
		this.ctx.reportAttachmentSuccess(fileName);

		return file;
	}

	private async parseAndSaveMessages() {
		this.ctx.status('Parsing Telegram messages...');

		const dom = parseHTML(this.sourceHtml);
		const body = dom.find('body');
		const msgs = Array.from(body.querySelectorAll('.message:not(.service)'));
		this.totalCount = msgs.length;

		this.ctx.reportProgress(this.handledCount, this.totalCount);
		for (const msg of msgs) {
			if (this.ctx.isCancelled()) return;

			const messageInfo = this.extractMessageInfo(msg);

			const isAttachmentMerged = await this.mergeGroupedAttachmentsIfNeeded(messageInfo);
			if (isAttachmentMerged) {
				continue;
			}

            const isMessageMerged = await this.mergeMessageIfNeeded(messageInfo);
			if (isMessageMerged) {
				continue;
			}

			const newNote = await this.createNote(messageInfo);

			this.lastHandled.noteInChannel[messageInfo.channel] = {
				note: newNote,
				noteTimestamp: messageInfo.timestamp,
				noteDate: messageInfo.date,
				noteHour: messageInfo.hour,
			};
			this.lastHandled.channel = messageInfo.channel;

			this.ctx.reportNoteSuccess(newNote.path);
			this.ctx.reportProgress(++this.handledCount, this.totalCount);
		}
	}

	/**
	 * Telegram treated messages with grouped attachments as separate messages
	 * This function check if previous message has similar time like previous message
	 * Same times is a sign that messages are grouped
	 * 
	 * @return return TRUE if message was merged, FALSE if doesn't
	 */ 
	private async mergeGroupedAttachmentsIfNeeded(message: MessageInfo): Promise<boolean> {
		if (this.lastHandled.channel && this.lastHandled.noteInChannel[this.lastHandled.channel]) {
			// search by last channel because grouped attachments has no information which channel they are linked to
			const last = this.lastHandled.noteInChannel[this.lastHandled.channel];

			if (last.note && last.noteTimestamp === message.timestamp) {
				const links = this.rawLinks2ObsidianLinks(message.attachmentsRawLinks, last.note.path);
				const content = links.length ? `${links.join(`\n`)}\n${message.content}` : message.content;
				await this.vault.process(last.note, (data) => `\n${content}` + data);

				this.ctx.reportNoteSuccess(last.note.path);
				this.ctx.reportProgress(++this.handledCount, this.totalCount);

				return true;
			}
		}

		return false;
	}

	/**
	 * Merges message into the last handled note if it matches the strategy
	 * 
	 * @return return TRUE if message merged, FALSE if doesn't
	 */
	private async mergeMessageIfNeeded(message: MessageInfo): Promise<boolean> {
		const last = this.lastHandled.noteInChannel[message.channel];
		if (!last) return false;

		if (
			(this.strategy === MergeStrategy.ByDate && message.date === last.noteDate) ||
			(this.strategy === MergeStrategy.ByHour && message.date === last.noteDate && message.hour === last.noteHour)
		) {
			const links = this.rawLinks2ObsidianLinks(message.attachmentsRawLinks, last.note.path);
			const content = links.length ? `${links.join(`\n`)}\n${message.content}` : message.content;
			await this.vault.append(last.note, `\n${content}`);

			this.ctx.reportNoteSuccess(last.note.path);
			this.ctx.reportProgress(++this.handledCount, this.totalCount);

			return true;
		}

		return false;
	}

	private async createNote(message: MessageInfo): Promise<TFile> {
		const title = sanitizeFileName(this.strategy === MergeStrategy.ByHour ? `${message.date} ${message.hour}` : message.date);
		const folder = await this.createFolders(normalizePath(`${this.outputFOlder.path}/${message.channel}`));
		const note = await this.saveAsMarkdownFile(folder, title, message.content);

		const links = this.rawLinks2ObsidianLinks(message.attachmentsRawLinks, note.path);
		if (links.length) {
			await this.vault.process(note, (data) => `${links.join(`\n`)}\n` + data);
		}

		return note;
	}

	private extractMessageInfo(msg: Element): MessageInfo {
		const channel = sanitizeFileName(msg.querySelector('.forwarded .from_name')?.childNodes[0]?.textContent?.trim() || OUTPUT_NO_CHANNEL_MESSAGES_FOLDER);
		const timestamp = msg.querySelector('.date')?.getAttribute('title') || 'Unknown time';
		const [d, m, y] = timestamp.split(' ')[0].split('.');
		const [h] = timestamp.split(' ')[1].split(':');
		const date = `${y}-${m}-${d}`;
		const hour = `${h}-00`;
		const html = msg.querySelector('.text')?.innerHTML || '';
		const content = htmlToMarkdown(html);
		const attachmentsRawLinks = this.extractAttachmentsRawLinks(msg);

		return { channel, timestamp, date, hour, content, attachmentsRawLinks } as MessageInfo; 
	}

	private extractAttachmentsRawLinks(msg: Element): string[] {
		const links = Array.from(msg.querySelectorAll('a[href]'))
			.map(a => a.getAttribute('href')!)
			.filter(link => SOURCE_ATTACHMENTS_FOLDERS.some(folder => link.startsWith(folder))); // filter not-attachments links

		return links;
	}

	/**
 	 * Converts raw attachment links extracted from HTML into Obsidian markdown links.
	 * 
     * @param sourcePath - the path of the note where links will be inserted. 
	 * Needed to correctly calculate relative paths from the note's location to the attachment files.
     */
	private rawLinks2ObsidianLinks(rawLinks: string[], sourcePath: string): string[] {
		const links = [];

		for (const link of rawLinks) {
			const [folder, filename] = link!.split(/\/(.*)/);

			if (this.attachments.has(folder) && this.attachments.get(folder)!.has(filename)) {
				const obsidianLink = this.app.fileManager.generateMarkdownLink(this.attachments.get(folder)!.get(filename)!, sourcePath);
				links.push(obsidianLink);
			}
		}

		return links;
	}
}
