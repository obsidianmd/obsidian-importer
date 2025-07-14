import { Notice, TFolder, TFile, htmlToMarkdown, normalizePath, Setting } from "obsidian";
import { FormatImporter } from "../format-importer";
import { ImportContext } from "../main";
import { parseHTML, sanitizeFileName } from "../util";
import { readZip, ZipEntryFile } from "../zip";
import { PickedFile } from "filesystem";

const ATTACHMENTS_FOLDERS = [
	'files', 'photos', 'round_video_messages', 'stickers', 'video_files', 'voice_messages'
];
const MESSAGES_FILENAME = 'messages.html';
const OUT_CHANNEL_NOTES_FOLDER = 'My Notes';

export class TelegramImporter extends FormatImporter {
	ctx: ImportContext;
	outFolder: TFolder;
	inputZip: PickedFile;
	mainHtml: string;

	init() {
		this.addFileChooserSetting('Exported chat (zip)', ['zip'], false);
		this.addOutputLocationSetting('Telegram import');
	}

	async import(ctx: ImportContext): Promise<void> {
		const outFolder = await this.getOutputFolder();

		if (this.files.length === 0) {
			new Notice('Please pick a Telegram exported chat under zip archive.');
			return;
		}

		if (!outFolder) {
			new Notice('Please select a location to export to.');
			return;
		}

		this.ctx = ctx;
		this.outFolder = outFolder;
		this.inputZip = this.files[0];

		try {
			await this.extractZip();
			this.parseAndSaveMessages();
		} catch (error) {
			this.ctx.reportFailed('Error has happened', `Information: ${error}`);
		}
	}

	private async extractZip() {
		await readZip(this.inputZip, async (_zip, entries) => {
			this.mainHtml = (await entries.find(e => e.name === MESSAGES_FILENAME)?.readText()) || '';
			if (!this.mainHtml) {
				this.ctx.reportFailed(`${MESSAGES_FILENAME} file not found in zip.`);
				return;
			}

			for (const e of entries) {
				if (this.ctx.isCancelled()) return;
				if (!ATTACHMENTS_FOLDERS.includes(e.parent)) continue;

				await this.saveAttachment(e);
			}
		});
	}

	private async saveAttachment(entry: ZipEntryFile) {
		const folderPath = normalizePath(`${this.outFolder.path}/_attachments/${entry.parent}`);
		const folder = await this.createFolders(folderPath);

		const filePath = `${folder.path}/${entry.name}`;
		const fileExists = this.vault.getAbstractFileByPath(filePath);
		if (fileExists) {
			this.ctx.reportSkipped(filePath, 'the file already exists.');
			return;
		}

		const data = await entry.read();
		await this.vault.createBinary(filePath, data);
	}

	private async parseAndSaveMessages() {
		this.ctx.status('Parsing Telegram messages...');

		const dom = parseHTML(this.mainHtml);
		const body = dom.find('body');
		const msgs = Array.from(body.querySelectorAll('.message:not(.service)'));
		const total = msgs.length;

		this.ctx.reportProgress(0, total);

		let count = 0;
		const lastNoteInfoByChannels: { 
			[channel: string]: { 
				lastNote: TFile; 
				lastNoteTimestamp: string; 
				lastNoteDate: string; 
			} 
		} = {};
		let lastChannel = null;
		for (const msg of msgs) {
			if (this.ctx.isCancelled()) return;

			const channel = msg.querySelector('.forwarded .from_name')?.childNodes[0]?.textContent?.trim() || OUT_CHANNEL_NOTES_FOLDER;
			const timestamp = msg.querySelector('.date')?.getAttribute('title') || 'Unknown time';
			const date = (([d, m, y]) => `${y}-${m}-${d}`)(timestamp.split(' ')[0].split('.'));
			const html = msg.querySelector('.text')?.innerHTML || '';
			const links = this.extractLinks(msg);
			let md = htmlToMarkdown(html);

			if (links) {
				md = links + '\n' + md;
			}


			const lastChannelLastNoteInfo = lastChannel ? lastNoteInfoByChannels[lastChannel] : null;
			if (lastChannelLastNoteInfo) {
				const { lastNote, lastNoteTimestamp, lastNoteDate } = lastChannelLastNoteInfo;

				// If current message time == last note time, append to it
				// Because Telegram treated messages with multiple attachments as separate messages
				// It is trick to work around this
				if (lastNote && lastNoteTimestamp === timestamp) {
					await this.vault.process(lastNote, (data) => `${md}\n` + data);

					this.ctx.reportNoteSuccess(lastNote.path);
					this.ctx.reportProgress(++count, total);

					continue;
				}
			}


			const lastNoteInfo = lastNoteInfoByChannels[channel];
			if (lastNoteInfo) {
				const { lastNote, lastNoteTimestamp, lastNoteDate } = lastNoteInfo;

				// Group messages with the same date into one note
				if (lastNote && lastNoteDate === date) {
					await this.vault.append(lastNote, `\n\n${md}`);

					this.ctx.reportNoteSuccess(lastNote.path);
					this.ctx.reportProgress(++count, total);

					continue;
				}
			}

			const title = sanitizeFileName(date);
			const noteFolder = await this.createFolders(normalizePath(`${this.outFolder.path}/${channel}`));
			const note = await this.saveAsMarkdownFile(noteFolder, title, md);

			lastNoteInfoByChannels[channel] = {
				lastNote: note,
				lastNoteTimestamp: timestamp,
				lastNoteDate: date
			};
			lastChannel = channel;

			this.ctx.reportNoteSuccess(note.path);
			this.ctx.reportProgress(++count, total);
		}
	}

	private extractLinks(msg: Element): string {
		return Array.from(msg.querySelectorAll('a[href]'))
			.map(a => a.getAttribute('href'))
			.filter(href => href && !href.startsWith('#go_to_message'))
			.filter(href => ATTACHMENTS_FOLDERS.some(folder => href?.startsWith(folder))) // filter not-attachments links
			.map(href => `![[${href}]]`)
			.join('\n');
	}
}
