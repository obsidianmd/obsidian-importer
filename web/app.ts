/**
 * The website: the same importers, with a browser where the vault was.
 *
 * An import here runs exactly as the scripted one in main.ts does - no dialog,
 * no settings drawn, files in and an ImportContext reporting out - and writes
 * into the in-memory vault the tests write into. What the vault holds at the
 * end is what the reader downloads.
 */
import './obsidian/runtime';
import { installDomExtensions } from './obsidian/dom-extensions';
import TurndownService from 'turndown';

// Before anything that converts: the conversion code uses createEl and the
// rest as if they were the DOM's own.
installDomExtensions(window, { turndown: TurndownService });

import { BlobReader, BlobWriter, TextReader, ZipWriter } from '@zip.js/zip.js';
import { getLanguage, setNoticeContainer } from './obsidian';
import { installNodeShims } from './node-shims';
import { MemoryVault } from './obsidian/vault';
import { browserApp } from './obsidian/metadata';
import { FormatImporter, ImporterHost } from '../src/format-importer';
import { ImportContext, ImportLogEntry } from '../src/import-context';
import { WebPickedFile } from '../src/filesystem';
import { DEFAULT_DATA, HostPlugin, ImporterData } from '../src/plugin-data';
import { i18n, setLanguage } from '../src/i18n';

import { Bear2bkImporter } from '../src/formats/bear-bear2bk';
import { CSVImporter } from '../src/formats/csv';
import { EvernoteEnexImporter } from '../src/formats/evernote-enex';
import { HtmlImporter } from '../src/formats/html';
import { KeepImporter } from '../src/formats/keep-json';
import { NotionImporter } from '../src/formats/notion';
import { RoamJSONImporter } from '../src/formats/roam-json';
import { TextbundleImporter } from '../src/formats/textbundle';

installNodeShims();
setLanguage(getLanguage());

/**
 * The importers offered here.
 *
 * Every one of these reads a file the reader hands over and needs nothing else
 * - no disk to walk, no API to authenticate against. The rest are not absent
 * because they cannot work in a browser, only because they have not been
 * brought over yet.
 */
const IMPORTERS: Record<string, new (app: never, host: ImporterHost) => FormatImporter> = {
	'bear': Bear2bkImporter,
	'csv': CSVImporter,
	'evernote': EvernoteEnexImporter,
	'html': HtmlImporter,
	'keep': KeepImporter,
	'notion': NotionImporter,
	// The id the plugin registers it under, and the one the string table is
	// keyed by; a name that misses shows as its own key.
	'roam-json': RoamJSONImporter,
	'textbundle': TextbundleImporter,
};

/** What the plugin keeps in its data file, kept in this browser instead. */
class BrowserHostPlugin implements HostPlugin {
	private static readonly KEY = 'obsidian-importer';

	async loadData(): Promise<ImporterData> {
		try {
			const stored = localStorage.getItem(BrowserHostPlugin.KEY);
			return stored ? { ...DEFAULT_DATA, ...JSON.parse(stored) } : { ...DEFAULT_DATA };
		}
		catch {
			return { ...DEFAULT_DATA };
		}
	}

	async saveData(data: ImporterData): Promise<void> {
		try {
			localStorage.setItem(BrowserHostPlugin.KEY, JSON.stringify(data));
		}
		catch {
			// A browser that refuses storage still imports; it just forgets.
		}
	}

	registerAuthCallback(): void {
		// Nothing here authenticates yet.
	}
}

const el = <K extends keyof HTMLElementTagNameMap>(id: string): HTMLElementTagNameMap[K] =>
	document.getElementById(id) as HTMLElementTagNameMap[K];

const formatEl = el<'select'>('format');
const filesEl = el<'input'>('files');
const runEl = el<'button'>('run');
const statusEl = el<'p'>('status');
const barEl = el<'div'>('bar');
const logEl = el<'ul'>('log');
const resultEl = el<'div'>('result');

setNoticeContainer(el<'div'>('notices'));

for (const id of Object.keys(IMPORTERS).sort()) {
	const option = document.createElement('option');
	option.value = id;
	option.textContent = i18n.importer(`${id}.name`);
	formatEl.appendChild(option);
}

/** Reports where the page can show it. */
class PageContext extends ImportContext {
	protected onStatus(message: string): void {
		statusEl.textContent = message;
	}

	protected onProgress(current: number, total: number): void {
		barEl.style.width = `${Math.round((current / total) * 100)}%`;
	}

	protected onLogged(entry: ImportLogEntry): void {
		const line = document.createElement('li');
		line.className = entry.outcome;
		line.textContent = entry.reason ? `${entry.name} — ${String(entry.reason)}` : entry.name;
		logEl.appendChild(line);
		logEl.scrollTop = logEl.scrollHeight;
	}
}

/** The vault, as a zip the reader can unpack into a real one. */
async function zipOf(vault: MemoryVault): Promise<Blob> {
	const writer = new ZipWriter(new BlobWriter('application/zip'));

	for (const [path, content] of vault.contents) {
		await writer.add(path, typeof content === 'string'
			? new TextReader(content)
			: new BlobReader(new Blob([content])));
	}

	return writer.close();
}

/**
 * What the import produced, before it is downloaded.
 *
 * Worth having beyond a check that it ran: unzipping into a vault to find out
 * what a conversion did is a slow way to read one note.
 */
function preview(vault: MemoryVault, paths: string[]): HTMLElement {
	const list = document.createElement('div');
	list.className = 'files';

	for (const path of paths) {
		const content = vault.contents.get(path);
		const item = document.createElement('details');

		const summary = document.createElement('summary');
		summary.textContent = path;
		item.appendChild(summary);

		const body = document.createElement('pre');
		body.textContent = typeof content === 'string'
			? content
			: `${Math.ceil((content?.byteLength ?? 0) / 1024)} KB`;
		item.appendChild(body);

		list.appendChild(item);
	}

	return list;
}

function download(blob: Blob, name: string): void {
	const url = URL.createObjectURL(blob);
	const link = document.createElement('a');
	link.href = url;
	link.download = name;
	link.click();
	// Revoked late: Safari reads the blob after the click returns.
	setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

let running = false;

async function run(): Promise<void> {
	if (running) return;

	const files = Array.from(filesEl.files ?? []);
	if (files.length === 0) {
		statusEl.textContent = i18n.common.msgPickFile();
		return;
	}

	running = true;
	runEl.disabled = true;
	logEl.replaceChildren();
	resultEl.replaceChildren();
	barEl.style.width = '0%';

	const importerId = formatEl.value;
	const vault = new MemoryVault();
	const host: ImporterHost = {
		sourceEl: null,
		outputEl: null,
		optionsEl: null,
		plugin: new BrowserHostPlugin(),
		importerId,
		abortController: new AbortController(),
	};

	const ctx = new PageContext();

	try {
		const importer = new IMPORTERS[importerId](browserApp(vault) as never, host);
		await importer.ready;

		if (importer.notAvailable) {
			throw new Error(`The ${i18n.importer(`${importerId}.name`)} importer is not available here.`);
		}

		importer.files = files.map(file => new WebPickedFile(file));
		importer.outputLocation = 'Import';

		importer.indexImportedNotes();
		try {
			await importer.import(ctx);
		}
		finally {
			await importer.finalizeMarkdownOutput(ctx);
		}

		const paths = vault.paths();
		statusEl.textContent = `${ctx.notes} notes, ${ctx.attachments} attachments, ${ctx.failed.length} failed`;

		if (paths.length > 0) {
			const button = document.createElement('button');
			button.textContent = `Download ${paths.length} files (.zip)`;
			button.addEventListener('click', () => {
				void zipOf(vault).then(blob => download(blob, `${importerId}-import.zip`));
			});
			resultEl.appendChild(button);
			resultEl.appendChild(preview(vault, paths));
		}
	}
	catch (error) {
		statusEl.textContent = String(error instanceof Error ? error.message : error);
		console.error(error);
	}
	finally {
		running = false;
		runEl.disabled = false;
	}
}

runEl.addEventListener('click', () => void run());
