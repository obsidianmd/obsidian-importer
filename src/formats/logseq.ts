import { moment, Notice, Platform, Setting, TFile, TextComponent } from 'obsidian';
import { FormatImporter } from '../format-importer';
// Type-only: `main.ts` imports this file, so a value import here would be a
// circular dependency and the imported binding would be undefined at init().
import type { ImportContext } from '../main';
import { NodePickedFile, PickedFile, parseFilePath, fs, fsPromises, path, nodeBufferToArrayBuffer } from '../filesystem';
import { sanitizeFileNameKeepPath } from './roam/utils';
import { DEFAULT_LOGSEQ_OPTIONS, LogseqImportOptions, TaskFormat, KeepOrDrop } from './logseq/options';
import { convertLocal } from './logseq/pipeline';
import { resolveBlockRefs, BlockRefTarget, removeOrphanBlockRefs } from './logseq/block-ids';
import { rewriteAliasReferences, convertTags, disambiguateBasenameLinks, BasenameIndex } from './logseq/links';
import { journalFilenameToISO } from './logseq/journals';
import { namespaceToPath } from './logseq/paths';
import { deOutline } from './logseq/de-outline';

const ISO_FORMAT = 'YYYY-MM-DD';
// Note directories under a Logseq graph root (relative paths).
const GRAPH_NOTE_DIRS = ['pages', 'journals'] as const;

interface PagePlan {
	file: PickedFile;
	kind: 'page' | 'journal';
	/** Canonical wikilink name used as the target for block references. */
	canonicalName: string;
	/** Vault-relative output path including `.md`. */
	outputPath: string;
	/** Absolute directory of the source file (for resolving relative assets). */
	sourceDir: string;
}

interface Intermediate extends PagePlan {
	yaml: string;
	body: string;
}

export class LogseqImporter extends FormatImporter {
	// Initialized in init(), not as a field initializer: FormatImporter's
	// constructor calls init() before subclass fields are assigned.
	options!: LogseqImportOptions;
	/** Absolute path to the selected Logseq graph root. */
	graphRoot: string | null = null;

	init() {
		this.options = { ...DEFAULT_LOGSEQ_OPTIONS };
		const dn = this.getDailyNotesConfig();
		this.options.journalDateFormat = dn.format;
		this.options.journalFolder = dn.folder || 'Journals';

		const graphSetting = new Setting(this.modal.contentEl)
			.setName('Graph folder')
			.setDesc('Pick the root of your Logseq graph (the folder containing pages/, journals/ and assets/).');

		if (!Platform.isDesktopApp) {
			graphSetting.setDesc('Logseq import requires the desktop app to select a graph folder.');
			this.notAvailable = true;
			return;
		}

		graphSetting.addButton(button => button
			.setButtonText('Choose graph folder')
			.onClick(async () => {
				const picked = window.electron.remote.dialog.showOpenDialogSync({
					title: 'Pick Logseq graph folder',
					properties: ['openDirectory', 'dontAddToRecent'],
				});
				if (!picked?.[0]) return;

				const graphRoot = picked[0];
				this.graphRoot = graphRoot;
				const notes = collectGraphNotes(graphRoot);
				this.files = notes;

				const pages = notes.filter(f => relPathFromGraph(graphRoot, this.absPath(f)).startsWith('pages/')).length;
				const journals = notes.length - pages;
				graphSetting.setDesc(
					`Graph: ${graphRoot}\n`
					+ `${notes.length} note(s) to import (${pages} page(s), ${journals} journal(s)).`
				);
			}));

		this.addOutputLocationSetting('Logseq');

		// ── Tasks ────────────────────────────────────────────────────────────────

		new Setting(this.modal.contentEl).setName('Tasks').setHeading();

		new Setting(this.modal.contentEl)
			.setName('Task format')
			.setDesc('How rich Logseq tasks (TODO/DOING/SCHEDULED/priority…) are written in Obsidian.')
			.addDropdown(d => d
				.addOption('tasks-emoji', 'Tasks plugin — emoji')
				.addOption('tasks-dataview', 'Tasks plugin — Dataview fields')
				.addOption('plain', 'Plain checkboxes')
				.setValue(this.options.taskFormat)
				.onChange(v => this.options.taskFormat = v as TaskFormat));

		// ── Journals ──────────────────────────────────────────────────────────────

		new Setting(this.modal.contentEl).setName('Journals').setHeading();

		const dn2 = this.getDailyNotesConfig();
		const dnFolder = dn2.folder || 'Journals';
		const dnFormat = dn2.format;

		let journalFolderText: TextComponent;
		let journalFormatText: TextComponent;

		new Setting(this.modal.contentEl)
			.setName('Use Daily Notes settings')
			.setDesc(`Migrate journals directly into your Daily Notes folder (${dnFolder}) using the configured date format (${dnFormat}).`)
			.addToggle(t => t
				.setValue(this.options.useDailyNotes)
				.onChange(v => {
					this.options.useDailyNotes = v;
					journalFolderText.setDisabled(v);
					journalFormatText.setDisabled(v);
					if (v) {
						this.options.journalFolder = dnFolder;
						this.options.journalDateFormat = dnFormat;
						journalFolderText.setValue(dnFolder);
						journalFormatText.setValue(dnFormat);
					}
				}));

		new Setting(this.modal.contentEl)
			.setName('Journal folder')
			.setDesc('Vault folder (relative to output) for imported journals.')
			.addText(t => {
				journalFolderText = t;
				t.setValue(this.options.journalFolder)
					.setDisabled(this.options.useDailyNotes)
					.onChange(v => this.options.journalFolder = v);
			});

		new Setting(this.modal.contentEl)
			.setName('Journal date format')
			.setDesc('moment.js format for daily-note filenames. Prefilled from your Daily Notes settings.')
			.addText(t => {
				journalFormatText = t;
				t.setValue(this.options.journalDateFormat)
					.setDisabled(this.options.useDailyNotes)
					.onChange(v => this.options.journalDateFormat = v || ISO_FORMAT);
			});

		new Setting(this.modal.contentEl)
			.setName('De-outline journals')
			.setDesc('Flatten journal outlines to paragraphs and headings (experimental).')
			.addToggle(t => t
				.setValue(this.options.deOutlineJournals)
				.onChange(v => this.options.deOutlineJournals = v));

		// ── Pages ─────────────────────────────────────────────────────────────────

		new Setting(this.modal.contentEl).setName('Pages').setHeading();

		new Setting(this.modal.contentEl)
			.setName('Pages folder')
			.setDesc('Vault folder (relative to output) for imported pages. Leave empty to place pages in the output root.')
			.addText(t => t
				.setValue(this.options.pagesFolder)
				.onChange(v => this.options.pagesFolder = v));

		new Setting(this.modal.contentEl)
			.setName('De-outline pages')
			.setDesc('Flatten page outlines to paragraphs and headings (experimental).')
			.addToggle(t => t
				.setValue(this.options.deOutlinePages)
				.onChange(v => this.options.deOutlinePages = v));

		// ── Links & tags ──────────────────────────────────────────────────────────

		new Setting(this.modal.contentEl).setName('Links & tags').setHeading();

		new Setting(this.modal.contentEl)
			.setName('Convert tags to links')
			.setDesc('Turn #tags into [[wikilinks]] instead of keeping them as tags.')
			.addToggle(t => t
				.setValue(this.options.convertTagsToLinks)
				.onChange(v => this.options.convertTagsToLinks = v));

		new Setting(this.modal.contentEl)
			.setName('Only convert tags with a matching page')
			.setDesc('When converting tags to links, keep tags as #tags if no corresponding page exists in the graph.')
			.addToggle(t => t
				.setValue(this.options.convertTagsOnlyExistingPages)
				.onChange(v => this.options.convertTagsOnlyExistingPages = v));

		new Setting(this.modal.contentEl)
			.setName('Drop tags')
			.setDesc('Comma-separated list of tags to remove entirely (e.g. "card, public").')
			.addText(t => t
				.setValue(this.options.dropTags.join(', '))
				.onChange(v => {
					this.options.dropTags = v.split(',').map(s => s.trim()).filter(s => s.length > 0);
				}));

		// ── Logseq-only content ───────────────────────────────────────────────────

		new Setting(this.modal.contentEl).setName('Logseq-only content').setHeading();

		new Setting(this.modal.contentEl)
			.setName('Queries')
			.setDesc('{{query}} and #+BEGIN_QUERY blocks have no Obsidian equivalent.')
			.addDropdown(d => d
				.addOption('keep', 'Keep verbatim')
				.addOption('drop', 'Drop')
				.setValue(this.options.queries)
				.onChange(v => this.options.queries = v as KeepOrDrop));

		new Setting(this.modal.contentEl)
			.setName('Flashcards')
			.setDesc('#card markers and {{cloze}} wrappers.')
			.addDropdown(d => d
				.addOption('keep', 'Keep verbatim')
				.addOption('drop', 'Drop (unwrap cloze to plain text)')
				.setValue(this.options.flashcards)
				.onChange(v => this.options.flashcards = v as KeepOrDrop));

		new Setting(this.modal.contentEl)
			.setName('Time tracking (LOGBOOK)')
			.setDesc('Logseq LOGBOOK/CLOCK entries have no Obsidian equivalent.')
			.addDropdown(d => d
				.addOption('drop', 'Drop')
				.addOption('keep', 'Keep verbatim')
				.setValue(this.options.logbook)
				.onChange(v => this.options.logbook = v as KeepOrDrop));

		// ── Assets ────────────────────────────────────────────────────────────────

		new Setting(this.modal.contentEl).setName('Assets').setHeading();

		new Setting(this.modal.contentEl)
			.setName('Keep image alt text')
			.setDesc('Preserve image alt text as the embed display text.')
			.addToggle(t => t
				.setValue(this.options.keepAssetAltText)
				.onChange(v => this.options.keepAssetAltText = v));

		// ── Block references ──────────────────────────────────────────────────────

		new Setting(this.modal.contentEl).setName('Block references').setHeading();

		new Setting(this.modal.contentEl)
			.setName('Shorten block IDs')
			.setDesc('Convert Logseq UUID block IDs to short Obsidian-style anchors.')
			.addToggle(t => t
				.setValue(this.options.shortenBlockIds)
				.onChange(v => this.options.shortenBlockIds = v));

		new Setting(this.modal.contentEl)
			.setName('Remove orphan block references')
			.setDesc('Remove ((uuid)) references that could not be resolved to a known block in the graph.')
			.addToggle(t => t
				.setValue(this.options.removeOrphanBlockRefs)
				.onChange(v => this.options.removeOrphanBlockRefs = v));

		// ── Properties ────────────────────────────────────────────────────────────

		new Setting(this.modal.contentEl).setName('Properties').setHeading();

		new Setting(this.modal.contentEl)
			.setName('Drop page properties')
			.setDesc('Comma-separated list of page-level property keys to exclude from frontmatter (e.g. "public, exclude-from-graph-view").')
			.addText(t => t
				.setValue(this.options.dropPageProperties.join(', '))
				.onChange(v => {
					this.options.dropPageProperties = v.split(',').map(s => s.trim()).filter(s => s.length > 0);
				}));

		new Setting(this.modal.contentEl)
			.setName('Drop block properties')
			.setDesc('Comma-separated list of additional inline block property keys to strip (Logseq-internal keys like collapsed, background-color are always stripped).')
			.addText(t => t
				.setValue(this.options.dropBlockProperties.join(', '))
				.onChange(v => {
					this.options.dropBlockProperties = v.split(',').map(s => s.trim()).filter(s => s.length > 0);
				}));
	}

	private getDailyNotesConfig(): { format: string, folder: string } {
		try {
			// @ts-expect-error : internalPlugins is not in the public API
			const instance = this.app.internalPlugins.getPluginById('daily-notes')?.instance;
			return {
				format: instance?.options?.format || ISO_FORMAT,
				folder: instance?.options?.folder || '',
			};
		}
		catch {
			return { format: ISO_FORMAT, folder: '' };
		}
	}

	async import(ctx: ImportContext): Promise<void> {
		if (!this.graphRoot || !fs || !path) {
			new Notice('Please pick a Logseq graph folder to import.');
			return;
		}

		const notes = collectGraphNotes(this.graphRoot);
		if (notes.length === 0) {
			const hasPages = fs.existsSync(path.join(this.graphRoot, 'pages'));
			const hasJournals = fs.existsSync(path.join(this.graphRoot, 'journals'));
			if (!hasPages && !hasJournals) {
				new Notice('The selected folder does not look like a Logseq graph (missing pages/ and journals/).');
			}
			else {
				new Notice('No markdown notes found under pages/ or journals/.');
			}
			return;
		}

		const { options } = this;

		const outputFolder = await this.getOutputFolder();
		if (!outputFolder) {
			new Notice('Please select a location to export to.');
			return;
		}

		const journalDir = options.journalFolder.trim()
			? `${outputFolder.path}/${options.journalFolder.trim()}`
			: outputFolder.path;

		const pagesDir = options.pagesFolder.trim()
			? `${outputFolder.path}/${options.pagesFolder.trim()}`
			: outputFolder.path;

		// Plan output paths from pages/ and journals/ only.
		// Use a Set to detect output-path collisions (two sources → same path).
		const claimedPaths = new Set<string>();
		const plans: PagePlan[] = [];
		for (const file of notes) {
			const rel = relPathFromGraph(this.graphRoot, this.absPath(file));
			if (/\/whiteboards\//i.test(rel)) {
				ctx.reportSkipped(file.name, 'Whiteboards are not supported');
				continue;
			}
			const plan = this.planFor(file, rel, pagesDir, journalDir);
			if (claimedPaths.has(plan.outputPath)) {
				ctx.reportSkipped(file.name, `Output path collision: ${plan.outputPath} already claimed by another note`);
				continue;
			}
			claimedPaths.add(plan.outputPath);
			plans.push(plan);
		}

		if (plans.length === 0) {
			new Notice('No Logseq pages or journals found in the selected folder.');
			return;
		}

		// Build basename disambiguation index: basename (lower-cased) -> [fullPath, ...]
		// A "basename" here is the last path component of the canonical name without .md.
		const basenameMap = new Map<string, string[]>();
		for (const plan of plans) {
			const name = plan.canonicalName;
			const base = name.includes('/') ? name.slice(name.lastIndexOf('/') + 1).toLowerCase() : name.toLowerCase();
			const existing = basenameMap.get(base);
			if (existing) existing.push(name);
			else basenameMap.set(base, [name]);
		}
		const basenameIndex: BasenameIndex = { basenameMap };

		// Build vault-wide page set for tag→link page-existence check (lower-cased).
		const knownPages = new Set(plans.map(p => p.canonicalName.toLowerCase()));

		// PASS 1: per-file local conversion + index building.
		const intermediates: Intermediate[] = [];
		const blockIndex = new Map<string, BlockRefTarget>();
		const aliasMap = new Map<string, string>();
		const ambiguousAliases = new Set<string>();
		const assetPlan = new Map<string, string>(); // absolute source -> filename

		for (const plan of plans) {
			if (ctx.isCancelled()) return;
			ctx.status(`Reading ${plan.file.name}`);
			try {
				const content = await plan.file.readText();
				const local = convertLocal(content, options);

				this.indexAliases(local.raw, plan.canonicalName, aliasMap, ambiguousAliases);
				for (const id of local.ids) {
					blockIndex.set(id.uuid, { page: plan.canonicalName, shortId: id.shortId });
				}
				for (const asset of local.assets) {
					const abs = this.resolveAsset(plan.sourceDir, asset.sourcePath);
					if (abs) assetPlan.set(abs, asset.filename);
				}

				let body = this.applyLogseqOnly(local.body, plan.file.name, ctx);
				intermediates.push({ ...plan, yaml: local.yaml, body });
			}
			catch (e) {
				ctx.reportFailed(plan.file.name, e);
			}
		}

		for (const alias of ambiguousAliases) aliasMap.delete(alias);

		const dropTags = new Set(options.dropTags);

		// PASS 2: cross-file resolution + write.
		let index = 0;
		for (const inter of intermediates) {
			if (ctx.isCancelled()) return;
			index++;
			try {
				let body = resolveBlockRefs(inter.body, blockIndex);

				if (options.removeOrphanBlockRefs) {
					body = removeOrphanBlockRefs(body);
				}

				body = rewriteAliasReferences(body, { aliasMap });
				body = disambiguateBasenameLinks(body, basenameIndex);

				// Tag conversion deferred to pass-2 so we have the full knownPages set.
				body = convertTags(body, {
					toLinks: options.convertTagsToLinks,
					onlyExistingPages: options.convertTagsOnlyExistingPages,
					knownPages,
					dropTags,
				});

				if (options.journalDateFormat !== ISO_FORMAT) {
					body = this.reformatIsoDateLinks(body, options.journalDateFormat);
				}

				// De-outline: flatten outline to paragraphs/headings when configured
				const shouldDeOutline = inter.kind === 'journal' ? options.deOutlineJournals : options.deOutlinePages;
				if (shouldDeOutline) {
					body = deOutline(body);
				}

				const final = inter.yaml ? `${inter.yaml}\n\n${body}\n` : `${body}\n`;
				await this.writeNote(inter.outputPath, final);
				ctx.reportNoteSuccess(inter.outputPath);
				ctx.reportProgress(index, intermediates.length);
			}
			catch (e) {
				ctx.reportFailed(inter.outputPath, e);
			}
		}

		await this.copyAssets(assetPlan, outputFolder.path, ctx);
	}

	private planFor(file: PickedFile, relPath: string, pagesDir: string, journalDir: string): PagePlan {
		const sourceDir = path ? parseFilePath(this.absPath(file)).parent : '';
		const isJournal = relPath.startsWith('journals/');

		if (isJournal) {
			const iso = journalFilenameToISO(file.basename);
			const name = iso ? moment(iso, ISO_FORMAT).format(this.options.journalDateFormat) : file.basename;
			const safe = sanitizeFileNameKeepPath(name);
			return { file, kind: 'journal', canonicalName: safe, outputPath: `${journalDir}/${safe}.md`, sourceDir };
		}

		const rel = sanitizeFileNameKeepPath(namespaceToPath(file.basename));
		return { file, kind: 'page', canonicalName: rel, outputPath: `${pagesDir}/${rel}.md`, sourceDir };
	}

	private absPath(file: PickedFile): string {
		return (file as NodePickedFile).filepath ?? file.name;
	}

	private indexAliases(
		raw: Record<string, string>,
		canonical: string,
		aliasMap: Map<string, string>,
		ambiguous: Set<string>
	): void {
		const value = raw.alias ?? raw.aliases;
		if (!value) return;
		for (const item of value.split(',')) {
			const name = item.trim().replace(/^\[\[(.*)\]\]$/, '$1').trim();
			if (!name) continue;
			const key = name.toLowerCase();
			const existing = aliasMap.get(key);
			if (existing !== undefined && existing !== canonical) ambiguous.add(key);
			else aliasMap.set(key, canonical);
		}
	}

	private applyLogseqOnly(body: string, name: string, ctx: ImportContext): string {
		const { options } = this;

		// Queries
		const hasQuery = /\{\{query|#\+BEGIN_QUERY/i.test(body);
		if (hasQuery) {
			if (options.queries === 'keep') {
				ctx.reportSkipped(name, 'Logseq queries kept verbatim');
			}
			else {
				body = body.replace(/^[ \t]*#\+BEGIN_QUERY[\s\S]*?#\+END_QUERY[ \t]*$/gim, '');
				body = body.replace(/\{\{query[\s\S]*?\}\}/gi, '');
			}
		}

		// Flashcards
		const hasCard = /#card\b|\{\{cloze/i.test(body);
		if (hasCard) {
			if (options.flashcards === 'keep') {
				ctx.reportSkipped(name, 'Logseq flashcard content kept verbatim');
			}
			else {
				body = body.replace(/\{\{cloze\s+([\s\S]*?)\}\}/gi, '$1');
				body = body.replace(/(^|\s)#card\b/gi, '$1');
			}
		}

		return body;
	}

	private resolveAsset(sourceDir: string, sourcePath: string): string | null {
		if (!fs || !path || !sourceDir) return null;
		const candidates = [
			path.resolve(sourceDir, sourcePath),
			path.resolve(sourceDir, sourcePath.replace(/^(\.\.\/)+/, '')),
		];
		for (const candidate of candidates) {
			try {
				if (fs.existsSync(candidate)) return candidate;
			}
			catch {
				// ignore
			}
		}
		return null;
	}

	private reformatIsoDateLinks(content: string, format: string): string {
		return content.replace(/\[\[(\d{4}-\d{2}-\d{2})\]\]/g, (whole, iso) => {
			const d = moment(iso, ISO_FORMAT, true);
			return d.isValid() ? `[[${d.format(format)}]]` : whole;
		});
	}

	private async writeNote(outputPath: string, content: string): Promise<void> {
		const { parent } = parseFilePath(outputPath);
		if (parent) await this.createFolders(parent);
		const existing = this.vault.getAbstractFileByPath(outputPath);
		if (existing instanceof TFile) {
			await this.vault.modify(existing, content);
		}
		else {
			await this.vault.create(outputPath, content);
		}
	}

	private async copyAssets(assetPlan: Map<string, string>, outputBase: string, ctx: ImportContext): Promise<void> {
		if (!fs || assetPlan.size === 0) return;
		const assetDir = `${outputBase}/assets`;
		await this.createFolders(assetDir);
		for (const [source, filename] of assetPlan) {
			if (ctx.isCancelled()) return;
			const dest = `${assetDir}/${filename}`;
			if (this.vault.getAbstractFileByPath(dest)) continue; // de-dupe by name
			try {
				const buffer = await fsPromises.readFile(source);
				await this.vault.createBinary(dest, nodeBufferToArrayBuffer(buffer));
				ctx.reportAttachmentSuccess(filename);
			}
			catch (e) {
				ctx.reportFailed(filename, e);
			}
		}
	}
}

/** Collect markdown notes from pages/ and journals/ under a graph root. */
function collectGraphNotes(graphRoot: string): NodePickedFile[] {
	if (!fs || !path) return [];
	const results: NodePickedFile[] = [];
	for (const dir of GRAPH_NOTE_DIRS) {
		const fullDir = path.join(graphRoot, dir);
		if (!fs.existsSync(fullDir)) continue;
		walkNotes(fullDir, results);
	}
	return results;
}

function walkNotes(dir: string, out: NodePickedFile[]): void {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path!.join(dir, entry.name);
		if (entry.isDirectory()) {
			walkNotes(full, out);
		}
		else if (entry.isFile() && entry.name.endsWith('.md')) {
			out.push(new NodePickedFile(full));
		}
	}
}

function relPathFromGraph(graphRoot: string, absPath: string): string {
	return path!.relative(graphRoot, absPath).replace(/\\/g, '/');
}
