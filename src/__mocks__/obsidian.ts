/**
 * Minimal mock of the `obsidian` module, providing just enough surface
 * for the importer conversion logic to run in a Node/vitest environment.
 *
 * Only pure-logic helpers are faithfully implemented (e.g. stringifyYaml,
 * htmlToMarkdown). UI and vault classes are lightweight stubs.
 */

/* ------------------------------------------------------------------ */
/*  Types re-exported from the real module                             */
/* ------------------------------------------------------------------ */

export interface FrontMatterCache {
	[key: string]: any;
}

export class TFile {
	path: string;
	name: string;
	basename: string;
	extension: string;
	parent: TFolder | null;

	constructor(path: string) {
		this.path = path;
		const parts = path.split('/');
		this.name = parts[parts.length - 1];
		const dotIdx = this.name.lastIndexOf('.');
		this.basename = dotIdx > 0 ? this.name.substring(0, dotIdx) : this.name;
		this.extension = dotIdx > 0 ? this.name.substring(dotIdx + 1) : '';
		this.parent = null;
	}
}

export class TFolder {
	path: string;
	name: string;
	children: any[] = [];

	constructor(path: string) {
		this.path = path;
		const parts = path.split('/');
		this.name = parts[parts.length - 1];
	}
}

export class Notice {
	constructor(public message: string) {}
}

export class Setting {
	constructor(_el: any) {}
	setName(_n: string) {
		return this; 
	}
	setDesc(_d: string | DocumentFragment) {
		return this; 
	}
	setHeading() {
		return this; 
	}
	addToggle(cb: (toggle: any) => void) {
		cb({
			setValue: () => ({ onChange: () => {} }),
			onChange: () => {},
		});
		return this;
	}
	addDropdown(cb: (dropdown: any) => void) {
		cb({
			addOption: () => ({ addOption: (a: any, b: any) => ({ addOption: (a2: any, b2: any) => ({ setValue: () => ({ onChange: () => {} }) }) }), setValue: () => ({ onChange: () => {} }) }),
			setValue: () => ({ onChange: () => {} }),
			onChange: () => {},
		});
		return this;
	}
	addText(cb: (text: any) => void) {
		cb({
			setValue: () => ({ onChange: () => {} }),
			onChange: () => {},
		});
		return this;
	}
	addButton(cb: (button: any) => void) {
		cb({
			setButtonText: () => ({ onClick: () => {} }),
			onClick: () => {},
		});
		return this;
	}
}

export class App {
	vault = new Vault();
	fileManager = {
		createNewMarkdownFile: async (_folder: any, _name: string, _content: string) => {
			return new TFile(`${_folder.path}/${_name}.md`);
		},
	};
}

export class Vault {
	private files = new Map<string, string>();

	async create(path: string, content: string) {
		this.files.set(path, content);
		return new TFile(path);
	}

	async createBinary(path: string, _data: ArrayBuffer) {
		this.files.set(path, '[binary]');
		return new TFile(path);
	}

	async createFolder(_path: string) {}

	async modify(file: TFile, content: string) {
		this.files.set(file.path, content);
	}

	async read(file: TFile): Promise<string> {
		return this.files.get(file.path) ?? '';
	}

	async append(_file: TFile, _content: string, _options?: any) {}

	getAbstractFileByPath(path: string): TFile | TFolder | null {
		return null;
	}

	getAbstractFileByPathInsensitive(path: string): TFile | TFolder | null {
		return null;
	}
}

export class Modal {
	app: App;
	contentEl: any = { empty: () => {}, createDiv: () => ({}) };
	titleEl: any = { setText: () => {} };
	modalEl: any = { addClass: () => {} };
	constructor(app: App) {
		this.app = app; 
	}
	open() {}
	close() {}
}

export class Plugin {
	app: App;
	constructor() {
		this.app = new App(); 
	}
	addRibbonIcon() {}
	addCommand() {}
	registerObsidianProtocolHandler() {}
	async loadData() {
		return {}; 
	}
	async saveData(_data: any) {}
}

export const Platform = {
	isDesktopApp: false,
	isMobileApp: false,
};

/* ------------------------------------------------------------------ */
/*  Utility functions                                                  */
/* ------------------------------------------------------------------ */

export function normalizePath(path: string): string {
	return path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
}

/**
 * Minimal YAML serializer that covers the shapes used by the importers
 * (flat scalars, arrays of scalars, nested objects).
 */
export function stringifyYaml(obj: Record<string, any>): string {
	const lines: string[] = [];

	function serializeValue(value: any, indent: string): string {
		if (Array.isArray(value)) {
			if (value.length === 0) return ' []\n';
			return '\n' + value.map(v => `${indent}  - ${v}`).join('\n') + '\n';
		}
		if (typeof value === 'object' && value !== null) {
			const inner = Object.entries(value)
				.map(([k, v]) => `${indent}  ${k}:${serializeValue(v, indent + '  ')}`)
				.join('');
			return '\n' + inner;
		}
		return ` ${value}\n`;
	}

	for (const [key, value] of Object.entries(obj)) {
		lines.push(`${key}:${serializeValue(value, '')}`);
	}
	return lines.join('');
}

/**
 * Very basic HTML-to-Markdown conversion covering the tags the importers rely on.
 */
export function htmlToMarkdown(el: HTMLElement | string): string {
	let html: string;
	if (typeof el === 'string') {
		html = el;
	}
	else if (el && typeof el.innerHTML === 'string') {
		html = el.innerHTML;
	}
	else {
		return '';
	}

	return html
		// paragraphs to double newline
		.replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
		.replace(/<\/?p[^>]*>/gi, '')
		// strip remaining tags
		.replace(/<\/?[^>]+>/gi, '')
		// decode basic entities
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, '\'')
		// collapse leading/trailing whitespace
		.trim();
}

/**
 * Stub moment — only the format/isValid used by apple-journal is covered.
 */
export function moment(dateStr: string, format: string) {
	// Parse "Sunday, 3 November 2024" style dates
	const months: Record<string, number> = {
		january: 0, february: 1, march: 2, april: 3,
		may: 4, june: 5, july: 6, august: 7,
		september: 8, october: 9, november: 10, december: 11,
	};

	// Try to parse "DayName, D MonthName YYYY"
	const match = dateStr.match(/\w+,\s+(\d{1,2})\s+(\w+)\s+(\d{4})/);
	if (match) {
		const day = parseInt(match[1], 10);
		const monthName = match[2].toLowerCase();
		const year = parseInt(match[3], 10);
		const month = months[monthName];
		if (month !== undefined) {
			const d = new Date(year, month, day);
			return {
				isValid: () => true,
				format: (fmt: string) => {
					if (fmt === 'YYYY-MM-DD') {
						const mm = String(d.getMonth() + 1).padStart(2, '0');
						const dd = String(d.getDate()).padStart(2, '0');
						return `${d.getFullYear()}-${mm}-${dd}`;
					}
					return d.toISOString();
				},
			};
		}
	}
	return {
		isValid: () => false,
		format: () => '',
	};
}
