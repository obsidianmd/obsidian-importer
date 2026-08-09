/**
 * A vault held in memory, for the half of an importer that writes.
 *
 * The conversion tests need no vault - that is the point of the seam. What
 * needs one is FormatImporter itself: every importer now writes through
 * createFile, and what that does with a name already taken is shared by all of
 * them. e2e runs the real thing, but only for fixtures whose conversion needs
 * no vault, which leaves Roam and Apple Notes uncovered.
 *
 * getAvailablePath is the part worth reading closely. It is Obsidian's, and
 * what it does was measured rather than guessed: asked for a name that is
 * taken, the app returns "Note 1", then "Note 2", and it compares without
 * regard to case, so "note" does not come back free while "Note" exists.
 */
import { DataWriteOptions, TAbstractFile, TFile, TFolder, normalizePath } from './obsidian';
import { parseFrontMatterBlock } from '../../src/util';

export class MemoryVault {
	/** Every file and folder, keyed by its lower-cased path. */
	private entries = new Map<string, TAbstractFile>();
	/** What each file holds, so a test can read back what an import wrote. */
	readonly contents = new Map<string, string | ArrayBuffer>();
	readonly config = new Map<string, unknown>();

	constructor() {
		const root = new TFolder();
		root.path = '/';
		root.name = '';
		this.entries.set('/', root);
	}

	get root(): TFolder {
		return this.entries.get('/') as TFolder;
	}

	getConfig(key: string): unknown {
		return this.config.get(key);
	}

	/** Every file path written, in the order the paths were taken. */
	paths(): string[] {
		return [...this.contents.keys()];
	}

	/** Every file and folder the vault holds, as Obsidian hands them out. */
	getAllLoadedFiles(): TAbstractFile[] {
		return [...this.entries.values()];
	}

	getMarkdownFiles(): TFile[] {
		return this.getAllLoadedFiles()
			.filter((entry): entry is TFile => entry instanceof TFile && entry.path.toLowerCase().endsWith('.md'));
	}

	getAbstractFileByPath(path: string): TAbstractFile | null {
		const found = this.entries.get(normalizePath(path).toLowerCase());

		// The real one is an exact match on the vault's map; this map is keyed
		// without case, so the spelling has to be compared here instead.
		return found && found.path === normalizePath(path) ? found : null;
	}

	getAbstractFileByPathInsensitive(path: string): TAbstractFile | null {
		return this.entries.get(normalizePath(path).toLowerCase()) ?? null;
	}

	getAvailablePath(base: string, extension?: string): string {
		const suffix = extension ? `.${extension}` : '';

		for (let n = 0; ; n++) {
			const candidate = n === 0 ? `${base}${suffix}` : `${base} ${n}${suffix}`;
			if (!this.entries.has(normalizePath(candidate).toLowerCase())) return candidate;
		}
	}

	/**
	 * Where an attachment goes, at the setting Obsidian ships with.
	 *
	 * The real one reads attachmentFolderPath, whose default is "/": the vault
	 * root, whatever note the attachment belongs to, which is why the note it
	 * came with is not asked about here.
	 */
	async getAvailablePathForAttachments(
		basename: string,
		extension: string,
		currentFile?: { parent: TFolder } | null
	): Promise<string> {
		let folderPath = String(this.config.get('attachmentFolderPath') ?? '/');
		if (folderPath === '.' || folderPath === './') {
			folderPath = currentFile?.parent.path ?? '';
		}
		else if (folderPath.startsWith('./')) {
			const parent = currentFile?.parent.path ?? '';
			folderPath = normalizePath(`${parent}/${folderPath.slice(2)}`);
		}

		if (folderPath === '/') folderPath = '';
		if (folderPath && !this.getAbstractFileByPathInsensitive(folderPath)) await this.createFolder(folderPath);
		const prefix = folderPath ? `${folderPath}/` : '';
		return this.getAvailablePath(prefix + basename, extension);
	}

	async createFolder(path: string): Promise<TFolder> {
		const normalized = normalizePath(path);
		const folder = new TFolder();
		folder.path = normalized;
		folder.name = normalized.split('/').pop() ?? '';

		this.entries.set(normalized.toLowerCase(), folder);
		return folder;
	}

	async create(path: string, data: string, options?: DataWriteOptions): Promise<TFile> {
		return this.write(path, data, options);
	}

	async createBinary(path: string, data: ArrayBuffer, options?: DataWriteOptions): Promise<TFile> {
		return this.write(path, data, options);
	}

	// Taken by path rather than by TFile: what an importer hands back is
	// Obsidian's TFile, which the tests are typechecked against, while what
	// this hands out is the shim's.
	async read(file: { path: string }): Promise<string> {
		return String(this.contents.get(file.path) ?? '');
	}

	async modify(file: { path: string }, data: string, options?: DataWriteOptions): Promise<void> {
		this.contents.set(file.path, data);

		const entry = this.entries.get(normalizePath(file.path).toLowerCase());
		if (entry instanceof TFile && options) Object.assign(entry.stat, options);
	}

	/** The vault refuses a name that is taken rather than picking another. */
	private write(path: string, data: string | ArrayBuffer, options?: DataWriteOptions): TFile {
		const normalized = normalizePath(path);
		if (this.entries.has(normalized.toLowerCase())) {
			throw new Error('File already exists.');
		}

		const file = new TFile();
		file.path = normalized;
		file.name = normalized.split('/').pop() ?? '';
		const dot = file.name.lastIndexOf('.');
		file.basename = dot > 0 ? file.name.slice(0, dot) : file.name;
		file.extension = dot > 0 ? file.name.slice(dot + 1) : '';
		file.stat.size = typeof data === 'string' ? data.length : data.byteLength;

		// The dates an importer asks for, which duplicate handling compares
		if (options) Object.assign(file.stat, options);

		this.entries.set(normalized.toLowerCase(), file);
		this.contents.set(normalized, data);
		return file;
	}
}

/**
 * An app with nothing in it but the vault, the link writer and local storage.
 *
 * FormatImporter reads the vault; an importer that links to what it wrote asks
 * fileManager for the link, in whichever form the vault is set to. The plain
 * wiki form stands in for all of them here, as it does in the conversion tests.
 * Local storage holds nothing, so every setting kept there stays at its default.
 */
export function memoryApp(vault: MemoryVault) {
	return {
		vault,
		loadLocalStorage: () => null,
		saveLocalStorage: () => {},
		metadataCache: {
			getFileCache: (file: { path: string }) => {
				const content = vault.contents.get(file.path);
				if (typeof content !== 'string') return null;

				return { frontmatter: parseFrontMatterBlock(content)?.frontMatter };
			},
		},
		fileManager: {
			generateMarkdownLink: (file: { path: string }, _sourcePath: string, subpath?: string, display?: string) =>
				`[[${file.path}${subpath ?? ''}${display ? `|${display}` : ''}]]`,
		},
	} as never;
}
