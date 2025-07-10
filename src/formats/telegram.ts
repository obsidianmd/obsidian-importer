import { Notice, TFolder, TFile, htmlToMarkdown, normalizePath } from "obsidian";
import { FormatImporter } from "../format-importer";
import { ImportContext } from "../main";
import { parseHTML, sanitizeFileName } from "../util";
import { readZip, ZipEntryFile } from "../zip";
import { PickedFile } from "filesystem";

const ATTACHMENTS_FOLDERS = [
	'files', 'photos', 'round_video_messages', 'stickers', 'video_files', 'voice_messages'
];
const MESSAGES_FILENAME = 'messages.html';

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

		await this.extractZip();
		this.parseAndSaveMessages();
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
		const folderPath = normalizePath(`${this.outFolder.path}/${entry.parent}`);
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
		for (let i = 0; i < total; i++) {
			if (this.ctx.isCancelled()) return;

			const msg = msgs[i];
			const time = msg.querySelector('.date')?.getAttribute('title') || 'Unknown time';
			const html = msg.querySelector('.text')?.innerHTML || '';
			let md = htmlToMarkdown(html);

			const links = this.extractLinks(msg);
			if (links) {
				md = links + '\n' + md;
			}

			const title = sanitizeFileName(time);
			const note = await this.saveAsMarkdownFile(this.outFolder, title, md);

			this.ctx.reportNoteSuccess(note.path);
			count++;
			this.ctx.reportProgress(count, total);
		}
	}

	private extractLinks(msg: Element): string {
		return Array.from(msg.querySelectorAll('a[href]'))
			.map(a => a.getAttribute('href'))
			.filter(href => href && !href.startsWith('#go_to_message'))
			.map(href => `![[${href}]]`)
			.join('\n');
	}
}
