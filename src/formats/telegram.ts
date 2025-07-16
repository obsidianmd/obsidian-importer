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

const ATTACHMENTS_FOLDERS = [
	'files', 'photos', 'round_video_messages', 'stickers', 'video_files', 'voice_messages'
];
const MESSAGES_FILENAME = 'messages.html';
const OUT_CHANNEL_NOTES_FOLDER = 'My Notes';
const DEFAULT_MERGE_STRATEGY = MergeStrategy.NoMerge;

export class TelegramImporter extends FormatImporter {
	ctx: ImportContext;
	outFolder: TFolder;
	inputZip: PickedFile;
	mainHtml: string;
	strategy: MergeStrategy = DEFAULT_MERGE_STRATEGY;

	init() {
		this.addFileChooserSetting('Exported chat (zip)', ['zip'], false);
		this.addOutputLocationSetting('Telegram import');
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
			await this.parseAndSaveMessages();
		} catch (error) {
			this.ctx.reportFailed('Error has happened', `Information: ${error}`);
		}
	}

	private async extractZip() {
		await readZip(this.inputZip, async (_zip, entries) => {
			this.mainHtml = (await entries.find(e => e.name === MESSAGES_FILENAME)?.readText()) || '';
			if (!this.mainHtml) {
				throw new Error(`${MESSAGES_FILENAME} file not found in zip.`);
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

		const fileName = this.sanitizeAttachmentName(entry.name);
		const filePath = `${folder.path}/${fileName}`;
		const fileExists = this.vault.getAbstractFileByPath(filePath);
		if (fileExists) {
			this.ctx.reportSkipped(filePath, 'the file already exists.');
			return;
		}

		const data = await entry.read();
		await this.vault.createBinary(filePath, data);
		this.ctx.reportAttachmentSuccess(fileName);
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
				lastNoteHour: string;
			} 
		} = {};
		let lastChannel = null;
		for (const msg of msgs) {
			if (this.ctx.isCancelled()) return;

			const channel = sanitizeFileName(msg.querySelector('.forwarded .from_name')?.childNodes[0]?.textContent?.trim() || OUT_CHANNEL_NOTES_FOLDER);
			const timestamp = msg.querySelector('.date')?.getAttribute('title') || 'Unknown time';
			const date = (([d, m, y]) => `${y}-${m}-${d}`)(timestamp.split(' ')[0].split('.'));
			const hour = (([h]) => `${h}-00`)(timestamp.split(' ')[1].split(':'));
			const html = msg.querySelector('.text')?.innerHTML || '';
			const links = this.extractLinks(msg);
			let md = htmlToMarkdown(html);

			if (links) {
				md = links + '\n' + md;
			}


			const lastChannelLastNoteInfo = lastChannel ? lastNoteInfoByChannels[lastChannel] : null;
			if (lastChannelLastNoteInfo) {
				const { lastNote, lastNoteTimestamp } = lastChannelLastNoteInfo;

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

            switch (this.strategy) {
				case MergeStrategy.ByDate:
					const lastNoteInfo1 = lastNoteInfoByChannels[channel];
					if (lastNoteInfo1) {
						const { lastNote, lastNoteDate } = lastNoteInfo1;

						// Group messages with the same date into one note
						if (lastNote && lastNoteDate === date) {
							await this.vault.append(lastNote, `\n\n${md}`);

							this.ctx.reportNoteSuccess(lastNote.path);
							this.ctx.reportProgress(++count, total);

							continue;
						}
					}

					break;
				case MergeStrategy.ByHour:
					const lastNoteInfo2 = lastNoteInfoByChannels[channel];
					if (lastNoteInfo2) {
						const { lastNote, lastNoteDate, lastNoteHour } = lastNoteInfo2;

						// Group messages with the same date into one note
						if (lastNote && lastNoteDate === date && lastNoteHour === hour) {
							await this.vault.append(lastNote, `\n\n${md}`);

							this.ctx.reportNoteSuccess(lastNote.path);
							this.ctx.reportProgress(++count, total);

							continue;
						}
					}

					break;
				case MergeStrategy.NoMerge:
					break;
			}


			const title = this.strategy === MergeStrategy.ByHour ? sanitizeFileName(`${date} ${hour}`) : sanitizeFileName(date);
			const noteFolder = await this.createFolders(normalizePath(`${this.outFolder.path}/${channel}`));
			const note = await this.saveAsMarkdownFile(noteFolder, title, md);

			lastNoteInfoByChannels[channel] = {
				lastNote: note,
				lastNoteTimestamp: timestamp,
				lastNoteDate: date,
				lastNoteHour: hour,
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
			.map(href => href ? this.sanitizeAttachmentName(href) : '')
			.map(href => `![[${href}]]`)
			.join('\n');
	}

	private sanitizeAttachmentName(initialName: string): string {
		return initialName.replace(/[#!\[\]\|\^]/g, '');
	}
}
