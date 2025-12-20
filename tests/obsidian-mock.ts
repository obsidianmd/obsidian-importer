import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { vi } from 'vitest';

class TAbstractFile {
	path: string;
	name: string;
	parent: TFolder | null;

	constructor(filePath: string, parent: TFolder | null = null) {
		this.path = filePath;
		this.name = path.posix.basename(filePath);
		this.parent = parent;
	}
}

export class TFolder extends TAbstractFile {
	children: TAbstractFile[] = [];
	constructor(filePath: string) {
		super(filePath, null);
	}
}

export class TFile extends TAbstractFile {
	extension: string | null = null;
	constructor(filePath: string, parent: TFolder) {
		super(filePath, parent);
		this.extension = path.posix.extname(filePath).slice(1) || null;
	}
}

export class Vault {
	root: string;
	adapter: { exists: (relPath: string) => Promise<boolean> };

	constructor(root: string) {
		this.root = root;
		this.adapter = {
			exists: async (relPath: string) => fs.existsSync(path.join(this.root, relPath)),
		};
	}

	getAbstractFileByPath(relPath: string): TAbstractFile | null {
		const absolute = path.join(this.root, relPath);
		if (!fs.existsSync(absolute)) return null;
		const stats = fs.statSync(absolute);
		if (stats.isDirectory()) return new TFolder(relPath);
		const parent = new TFolder(path.posix.dirname(relPath));
		return new TFile(relPath, parent);
	}

	getAbstractFileByPathInsensitive(relPath: string): TAbstractFile | null {
		return this.getAbstractFileByPath(relPath);
	}

	async createFolder(relPath: string): Promise<TFolder> {
		await fsp.mkdir(path.join(this.root, relPath), { recursive: true });
		return new TFolder(relPath);
	}

	async createBinary(relPath: string, data: ArrayBuffer): Promise<TFile> {
		const absolute = path.join(this.root, relPath);
		await fsp.mkdir(path.dirname(absolute), { recursive: true });
		await fsp.writeFile(absolute, Buffer.from(data));
		const parent = new TFolder(path.posix.dirname(relPath));
		return new TFile(relPath, parent);
	}

	async append(file: TFile, data: string): Promise<void> {
		await fsp.appendFile(path.join(this.root, file.path), data);
	}

	async getAvailablePathForAttachments(basename: string, extension: string, sourceFile?: { parent: TFolder } | null): Promise<string> {
		const directory = sourceFile?.parent?.path ?? '';
		const withExt = extension ? `${basename}.${extension}` : basename;
		let candidate = directory ? path.posix.join(directory, withExt) : withExt;
		let counter = 1;
		while (fs.existsSync(path.join(this.root, candidate))) {
			const numbered = `${basename} ${counter}${extension ? `.${extension}` : ''}`;
			candidate = directory ? path.posix.join(directory, numbered) : numbered;
			counter++;
		}
		return candidate;
	}
}

export class FileManager {
	vault: Vault;
	constructor(vault: Vault) {
		this.vault = vault;
	}

	async createNewMarkdownFile(folder: TFolder, name: string, content: string): Promise<TFile> {
		const relPath = path.posix.join(folder.path || '', `${name}.md`);
		const absolute = path.join(this.vault.root, relPath);
		await fsp.mkdir(path.dirname(absolute), { recursive: true });
		await fsp.writeFile(absolute, content);
		return new TFile(relPath, folder);
	}
}

export class App {
	vault: Vault;
	fileManager: FileManager;
	constructor(vault: Vault, fileManager: FileManager) {
		this.vault = vault;
		this.fileManager = fileManager;
	}
}

export class Plugin {
	app: App | undefined;
	constructor(app?: App) {
		this.app = app;
	}
	addRibbonIcon(): void {}
	addCommand(): void {}
	registerObsidianProtocolHandler(): void {}
	onload(): void {}
	onunload(): void {}
}

export class Modal {
	contentEl: HTMLElement = document.createElement('div');
}

export class Notice {
	static messages: string[] = [];
	message: string;
	constructor(message: string) {
		this.message = message;
		Notice.messages.push(message);
	}
}

export class Setting {
	settingEl: HTMLElement;
	constructor(containerEl: HTMLElement) {
		this.settingEl = containerEl.createDiv ? containerEl.createDiv() : document.createElement('div');
		(this.settingEl as any).toggle = (value: boolean) => {
			this.settingEl.hidden = !value;
		};
		(this.settingEl as any).show = () => {
			this.settingEl.hidden = false;
		};
		(this.settingEl as any).hide = () => {
			this.settingEl.hidden = true;
		};
	}

	setName(): this { return this; }
	setDesc(): this { return this; }
	addToggle(cb: (toggle: any) => void): this { cb({ setValue: () => this, onChange: () => this }); return this; }
	addButton(cb: (button: any) => void): this { cb({ setCta: () => this, setButtonText: () => this, onClick: () => this }); return this; }
	addText(cb: (text: any) => void): this { cb({ setValue: () => this, onChange: () => this }); return this; }
}

export const Platform = { isDesktopApp: false };
export const normalizePath = (p: string) => p.replace(/\\/g, '/');

export const htmlToMarkdown = (element: HTMLElement): string => {
	const walk = (node: Node): string => {
		if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
		if (!(node instanceof HTMLElement)) return '';
		if (node.nodeName === 'BR') return '\n';
		if (node.nodeName === 'IMG') {
			const alt = node.getAttribute('alt') ?? '';
			const src = node.getAttribute('src') ?? '';
			return `![${alt}](${src})`;
		}
		if (node.nodeName === 'PRE') {
			return `\n\n\`\`\`\n${node.textContent ?? ''}\n\`\`\`\n\n`;
		}
		const children = Array.from(node.childNodes).map(walk).join('');
		if (node.nodeName === 'P' || node.nodeName === 'DIV') return `${children}\n\n`;
		return children;
	};

	return walk(element).replace(/\n{3,}/g, '\n\n').trim();
};

export const requestUrl = vi.fn(async () => ({ json: { access_token: 'mock-access', refresh_token: 'mock-refresh' } }));
export const moment = ((_: any) => ({ format: () => '2023-01-01-000000' })) as any;
moment.utc = (_: any) => ({ format: () => '2023-01-01' });

export default {
	App,
	Vault,
	FileManager,
	Plugin,
	TFolder,
	TFile,
	Modal,
	Notice,
	Setting,
	Platform,
	normalizePath,
	htmlToMarkdown,
	requestUrl,
	moment,
};
