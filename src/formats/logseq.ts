import { moment, normalizePath, Notice, TextComponent, TFile } from 'obsidian';
import { ImportContext } from '../import-context';
import { NodePickedFile, PickedFile, PickedFolder, fsPromises } from '../filesystem';
import { FormatImporter, NoteTemplateSample, PlannedNote, TEMPLATE_PREVIEW_LIMIT } from '../format-importer';
import { i18n } from '../i18n';
import { sameBytes, sanitizeFileName } from '../util';
import { BlockRefTarget, removeOrphanBlockRefs, resolveBlockRefs } from './logseq/block-ids';
import { deOutline } from './logseq/de-outline';
import { journalFilenameToISO, reformatDateLinks } from './logseq/journals';
import { convertTags, rewriteAliasReferences, rewritePlannedPageLinks, PlannedPageLink } from './logseq/links';
import { DEFAULT_LOGSEQ_OPTIONS, KeepOrDrop, LogseqImportOptions, TaskFormat } from './logseq/options';
import { namespaceToPath } from './logseq/paths';
import { convertLocal, indexPageAliases, isBodyEmpty, LocalResult } from './logseq/pipeline';
import { linkifyTagValuesInFrontmatter } from './logseq/properties';

const ISO_FORMAT = 'YYYY-MM-DD';

interface InternalPlugins {
	getPluginById(id: string): { instance?: { options?: { format?: string, folder?: string } } } | null;
}

interface GraphFile {
	file: PickedFile;
	path: string;
}

interface GraphSource {
	name: string;
	files: GraphFile[];
	byPath: Map<string, GraphFile>;
}

interface SourceNote extends GraphFile {
	kind: 'page' | 'journal';
	logicalName: string;
	parent: string;
	title: string;
	sourceId: string;
	content: string;
	local: LocalResult;
	planned: PlannedNote;
	times?: { ctime: number, mtime: number };
	assetTargets: Map<string, string | null>;
}

interface PlannedAsset {
	file: PickedFile;
	path: string;
	reuse: TFile | null;
	data: ArrayBuffer;
}

function withoutMarkdownExtension(path: string): string {
	return path.replace(/\.md$/i, '');
}

function normalizedGraphPath(path: string): string {
	const parts: string[] = [];
	for (const part of path.replace(/\\/g, '/').split('/')) {
		if (!part || part === '.') continue;
		if (part === '..') parts.pop();
		else parts.push(part);
	}
	return parts.join('/');
}

function decodedPath(path: string): string {
	try {
		return decodeURIComponent(path);
	}
	catch {
		return path;
	}
}

function graphBasename(path: string): string {
	const slash = path.lastIndexOf('/');
	return slash < 0 ? path : path.slice(slash + 1);
}

function graphParent(path: string): string {
	const slash = path.lastIndexOf('/');
	return slash < 0 ? '' : path.slice(0, slash);
}

async function walkFolder(folder: PickedFolder, parent: string, files: GraphFile[]): Promise<void> {
	for (const item of await folder.list()) {
		const path = normalizedGraphPath(parent ? `${parent}/${item.name}` : item.name);
		if (item.type === 'folder') await walkFolder(item, path, files);
		else files.push({ file: item, path });
	}
}

async function fileTimes(file: PickedFile): Promise<{ ctime: number, mtime: number } | undefined> {
	if (!(file instanceof NodePickedFile)) return undefined;
	try {
		const stat = await fsPromises.stat(file.filepath);
		return {
			ctime: Math.round(stat.birthtimeMs || stat.ctimeMs),
			mtime: Math.round(stat.mtimeMs),
		};
	}
	catch {
		return undefined;
	}
}

export class LogseqImporter extends FormatImporter {
	static extensions = ['md'];

	interruption = 'pause' as const;
	options!: LogseqImportOptions;

	init(): void {
		this.keepsFolders = true;
		this.defaultOutputFolder = 'Logseq';
		this.idProperty = 'logseq-source';
		this.idLabel = 'Logseq source';
		this.options = { ...DEFAULT_LOGSEQ_OPTIONS };

		const dailyNotes = this.dailyNotesConfig();
		this.options.journalDateFormat = dailyNotes.format;
		this.options.journalFolder = dailyNotes.folder || 'Journals';

		this.addExportSetting('Choose the root folder of a Logseq Markdown graph.');
		this.addFileChooserSetting('Logseq graph', LogseqImporter.extensions, true,
			'Choose one graph folder containing pages/, journals/, and assets/.');

		this.drawOptions(dailyNotes);
	}

	get sourceReady(): boolean {
		return this.chosen.filter(item => item.type === 'folder').length === 1;
	}

	private drawOptions(dailyNotes: { format: string, folder: string }): void {
		this.startGroup('options', 'Tasks');
		this.addSetting()
			?.setName('Task format')
			.setDesc('Choose native checkboxes or Tasks plugin metadata.')
			.addDropdown(dropdown => dropdown
				.addOption('plain', 'Plain checkboxes')
				.addOption('tasks-emoji', 'Tasks plugin — emoji')
				.addOption('tasks-dataview', 'Tasks plugin — Dataview fields')
				.setValue(this.options.taskFormat)
				.onChange(value => this.options.taskFormat = value as TaskFormat));

		this.startGroup('options', 'Journals');
		let journalFolder: TextComponent | undefined;
		let journalFormat: TextComponent | undefined;
		this.addSetting()
			?.setName('Use Daily Notes settings')
			.setDesc('Write journals to the configured Daily Notes folder and filename format.')
			.addToggle(toggle => toggle
				.setValue(this.options.useDailyNotes)
				.onChange(value => {
					this.options.useDailyNotes = value;
					journalFolder?.setDisabled(value);
					journalFormat?.setDisabled(value);
					if (value) {
						this.options.journalFolder = dailyNotes.folder;
						this.options.journalDateFormat = dailyNotes.format;
						journalFolder?.setValue(dailyNotes.folder);
						journalFormat?.setValue(dailyNotes.format);
					}
				}));
		this.addSetting()
			?.setName('Journal folder')
			.setDesc('Folder relative to the import folder when Daily Notes settings are disabled.')
			.addText(text => {
				journalFolder = text;
				text.setValue(this.options.journalFolder)
					.setDisabled(this.options.useDailyNotes)
					.onChange(value => this.options.journalFolder = value);
			});
		this.addSetting()
			?.setName('Journal date format')
			.setDesc('Moment.js format used for imported journal filenames.')
			.addText(text => {
				journalFormat = text;
				text.setValue(this.options.journalDateFormat)
					.setDisabled(this.options.useDailyNotes)
					.onChange(value => this.options.journalDateFormat = value || ISO_FORMAT);
			});
		this.addSetting()
			?.setName('De-outline journals')
			.setDesc('Convert journal outlines into paragraphs, headings, and lists.')
			.addToggle(toggle => toggle
				.setValue(this.options.deOutlineJournals)
				.onChange(value => this.options.deOutlineJournals = value));

		this.startGroup('options', 'Pages');
		this.addSetting()
			?.setName('Pages folder')
			.setDesc('Folder relative to the import folder. Leave empty to use the import folder.')
			.addText(text => text
				.setValue(this.options.pagesFolder)
				.onChange(value => this.options.pagesFolder = value));
		this.addSetting()
			?.setName('De-outline pages')
			.setDesc('Convert page outlines into paragraphs, headings, and lists.')
			.addToggle(toggle => toggle
				.setValue(this.options.deOutlinePages)
				.onChange(value => this.options.deOutlinePages = value));

		this.startGroup('options', 'Links and tags');
		this.addSetting()
			?.setName('Convert tags to links')
			.setDesc('Convert Logseq tags into links to matching pages.')
			.addToggle(toggle => toggle
				.setValue(this.options.convertTagsToLinks)
				.onChange(value => this.options.convertTagsToLinks = value));
		this.addSetting()
			?.setName('Only convert tags with a matching page')
			.setDesc('Keep tags unchanged when the graph has no page with that name.')
			.addToggle(toggle => toggle
				.setValue(this.options.convertTagsOnlyExistingPages)
				.onChange(value => this.options.convertTagsOnlyExistingPages = value));
		this.addSetting()
			?.setName('Drop tags')
			.setDesc('Comma-separated tags to remove.')
			.addText(text => text
				.setValue(this.options.dropTags.join(', '))
				.onChange(value => this.options.dropTags = this.listSetting(value)));

		this.startGroup('options', 'Logseq-only content');
		this.keepOrDropSetting('Queries', '{{query}} and query blocks have no direct Obsidian equivalent.',
			this.options.queries, value => this.options.queries = value);
		this.keepOrDropSetting('Flashcards', 'Control #card markers and {{cloze}} wrappers.',
			this.options.flashcards, value => this.options.flashcards = value);
		this.keepOrDropSetting('Time tracking', 'Control LOGBOOK and CLOCK entries.',
			this.options.logbook, value => this.options.logbook = value);

		this.startGroup('options', 'Block references');
		this.addSetting()
			?.setName('Shorten block IDs')
			.setDesc('Convert Logseq UUIDs into shorter Obsidian block anchors.')
			.addToggle(toggle => toggle
				.setValue(this.options.shortenBlockIds)
				.onChange(value => this.options.shortenBlockIds = value));
		this.addSetting()
			?.setName('Remove unresolved block references')
			.setDesc('Remove references whose target block is missing from the graph.')
			.addToggle(toggle => toggle
				.setValue(this.options.removeOrphanBlockRefs)
				.onChange(value => this.options.removeOrphanBlockRefs = value));
		this.addSetting()
			?.setName('Embed block references')
			.setDesc('Show referenced block content in place instead of linking to it.')
			.addToggle(toggle => toggle
				.setValue(this.options.alwaysEmbedBlockRefs)
				.onChange(value => this.options.alwaysEmbedBlockRefs = value));

		this.startGroup('options', 'Properties');
		this.addSetting()
			?.setName('Drop page properties')
			.setDesc('Comma-separated page properties to remove.')
			.addText(text => text
				.setValue(this.options.dropPageProperties.join(', '))
				.onChange(value => this.options.dropPageProperties = this.listSetting(value)));
		this.addSetting()
			?.setName('Drop block properties')
			.setDesc('Comma-separated block properties to remove in addition to Logseq-internal properties.')
			.addText(text => text
				.setValue(this.options.dropBlockProperties.join(', '))
				.onChange(value => this.options.dropBlockProperties = this.listSetting(value)));
		this.addSetting()
			?.setName('Block properties')
			.setDesc('Keep, wrap as Dataview inline fields, or remove remaining block properties.')
			.addDropdown(dropdown => dropdown
				.addOption('keep', 'Keep')
				.addOption('wrap', 'Wrap as inline fields')
				.addOption('drop', 'Drop')
				.setValue(this.options.blockProperties)
				.onChange(value => this.options.blockProperties = value as LogseqImportOptions['blockProperties']));
		this.addSetting()
			?.setName('Use snake_case page properties')
			.setDesc('Replace hyphens in imported page property names with underscores.')
			.addToggle(toggle => toggle
				.setValue(this.options.snakeCasePageProperties)
				.onChange(value => this.options.snakeCasePageProperties = value));
		this.addSetting()
			?.setName('Use snake_case block properties')
			.setDesc('Replace hyphens in retained block property names with underscores.')
			.addToggle(toggle => toggle
				.setValue(this.options.snakeCaseBlockProperties)
				.onChange(value => this.options.snakeCaseBlockProperties = value));

		this.startGroup('options', 'Cleanup');
		this.addSetting()
			?.setName('Keep image alt text')
			.setDesc('Use source image alt text as the Obsidian embed display text.')
			.addToggle(toggle => toggle
				.setValue(this.options.keepAssetAltText)
				.onChange(value => this.options.keepAssetAltText = value));
		this.addSetting()
			?.setName('Normalize whitespace')
			.setDesc('Trim trailing whitespace and remove empty outline bullets.')
			.addToggle(toggle => toggle
				.setValue(this.options.normalizeWhitespace)
				.onChange(value => this.options.normalizeWhitespace = value));
	}

	private keepOrDropSetting(
		name: string,
		description: string,
		value: KeepOrDrop,
		changed: (value: KeepOrDrop) => void,
	): void {
		this.addSetting()
			?.setName(name)
			.setDesc(description)
			.addDropdown(dropdown => dropdown
				.addOption('keep', 'Keep')
				.addOption('drop', 'Drop')
				.setValue(value)
				.onChange(next => changed(next as KeepOrDrop)));
	}

	private listSetting(value: string): string[] {
		return value.split(',').map(item => item.trim()).filter(Boolean);
	}

	private dailyNotesConfig(): { format: string, folder: string } {
		const app = this.app as { internalPlugins?: InternalPlugins };
		const options = app.internalPlugins?.getPluginById('daily-notes')?.instance?.options;
		return { format: options?.format || ISO_FORMAT, folder: options?.folder || '' };
	}

	private graphFolder(): PickedFolder | null {
		const folders = this.chosen.filter((item): item is PickedFolder => item.type === 'folder');
		return folders.length === 1 ? folders[0] : null;
	}

	private async readGraph(ctx: ImportContext): Promise<GraphSource | null> {
		const root = this.graphFolder();
		if (!root) return null;

		const files: GraphFile[] = [];
		try {
			await walkFolder(root, '', files);
		}
		catch (error) {
			ctx.reportFailed(root.name, error);
			return null;
		}

		const byPath = new Map<string, GraphFile>();
		for (const entry of files) byPath.set(entry.path.toLowerCase(), entry);
		return { name: root.name, files, byPath };
	}

	private noteEntries(graph: GraphSource): GraphFile[] {
		return graph.files.filter(entry => /^(pages|journals)\/.*\.md$/i.test(entry.path));
	}

	private desiredNote(entry: GraphFile, graphName: string, outputRoot: string): Omit<SourceNote,
		'content' | 'local' | 'planned' | 'times' | 'assetTargets'> {
		const journal = entry.path.toLowerCase().startsWith('journals/');
		let logicalName: string;
		let parent: string;

		if (journal) {
			const iso = journalFilenameToISO(entry.file.basename);
			logicalName = iso
				? moment(iso, ISO_FORMAT, true).format(this.options.journalDateFormat)
				: entry.file.basename;
			parent = this.options.useDailyNotes
				? this.options.journalFolder.trim()
				: normalizePath([outputRoot, this.options.journalFolder.trim()].filter(Boolean).join('/'));
		}
		else {
			logicalName = namespaceToPath(entry.file.basename);
			const logicalParent = graphParent(logicalName);
			parent = normalizePath([outputRoot, this.options.pagesFolder.trim(), logicalParent]
				.filter(Boolean).join('/'));
		}

		const title = graphBasename(logicalName);
		return {
			...entry,
			kind: journal ? 'journal' : 'page',
			logicalName,
			parent,
			title,
			sourceId: `${graphName}/${entry.path}`,
		};
	}

	protected override async templatePreviewSamples(ctx: ImportContext): Promise<NoteTemplateSample[]> {
		const graph = await this.readGraph(ctx);
		if (!graph) return [];

		const outputRoot = this.outputLocation.trim();
		const samples: NoteTemplateSample[] = [];
		for (const entry of this.noteEntries(graph)) {
			if (samples.length >= TEMPLATE_PREVIEW_LIMIT || await ctx.shouldStop()) break;
			try {
				const desired = this.desiredNote(entry, graph.name, outputRoot);
				const local = convertLocal(await entry.file.readText(), this.options);
				const content = local.yaml ? `${local.yaml}\n${local.body}` : local.body;
				const path = normalizePath([desired.parent, `${sanitizeFileName(desired.title, desired.parent)}.md`]
					.filter(Boolean).join('/'));
				samples.push({ title: desired.title, path, content, sourceId: desired.sourceId });
			}
			catch (error) {
				console.warn(`Could not preview Logseq note ${entry.path}`, error);
			}
		}
		return samples;
	}

	async import(ctx: ImportContext): Promise<void> {
		const graph = await this.readGraph(ctx);
		if (!graph) {
			new Notice('Please choose one Logseq graph folder.');
			return;
		}

		const entries = this.noteEntries(graph);
		if (entries.length === 0) {
			new Notice('The selected folder has no Markdown notes under pages/ or journals/.');
			return;
		}

		const outputFolder = await this.getOutputFolder();
		if (!outputFolder) {
			new Notice(i18n.common.msgPickOutput());
			return;
		}
		const outputRoot = outputFolder.path === '/' ? '' : outputFolder.path;

		const notes: SourceNote[] = [];
		for (const entry of entries) {
			if (await ctx.shouldStop()) return;
			ctx.status(i18n.common.statusProcessing({ name: entry.path }));
			try {
				const desired = this.desiredNote(entry, graph.name, outputRoot);
				const content = await entry.file.readText();
				const local = convertLocal(content, this.options);
				const times = await fileTimes(entry.file);
				const preliminary = local.yaml ? `${local.yaml}\n\n${local.body}\n` : `${local.body}\n`;
				const planned = await this.planTemplatedNote(desired.parent, desired.title, preliminary, {
					sourceId: desired.sourceId,
					...times,
				});
				notes.push({ ...desired, content, local, planned, times, assetTargets: new Map() });
			}
			catch (error) {
				ctx.reportFailed(entry.path, error);
			}
		}

		const assets = await this.planAssets(graph, notes, ctx);
		const linkPlans = this.linkPlans(notes);
		const knownPages = this.knownPages(notes);
		const blockIndex = new Map<string, BlockRefTarget>();
		const aliasMap = new Map<string, string>();
		const ambiguousAliases = new Set<string>();

		for (const note of notes) {
			note.local = convertLocal(note.content, this.options, {
				assetTarget: sourcePath => note.assetTargets.get(sourcePath) ?? null,
			});
			const target = withoutMarkdownExtension(note.planned.targetPath);
			const aliases = { ...note.local.raw };
			if (aliases.title?.toLowerCase() === note.logicalName.toLowerCase()) delete aliases.title;
			indexPageAliases(aliases, target, aliasMap, ambiguousAliases);
			for (const id of note.local.ids) blockIndex.set(id.uuid, { page: target, shortId: id.shortId });
		}
		for (const alias of ambiguousAliases) aliasMap.delete(alias);

		const total = notes.length + assets.length;
		let done = 0;
		ctx.reportProgress(done, total);
		for (const note of notes) {
			if (await ctx.shouldStop()) return;
			try {
				const final = this.resolveNote(note, blockIndex, aliasMap, knownPages, linkPlans, ctx);
				if (final === null) {
					this.releasePath(note.planned.targetPath);
				}
				else {
					const result = await this.writePlannedNote(ctx, note.planned, final, {
						sourceId: note.sourceId,
						...note.times,
					});
					if (result.written) ctx.reportNoteSuccess(result.file.path);
				}
			}
			catch (error) {
				ctx.reportFailed(note.path, error);
			}
			ctx.reportProgress(++done, total);
		}

		for (const asset of assets) {
			if (await ctx.shouldStop()) return;
			try {
				if (!asset.reuse) {
					await this.writeAttachment(asset.path, asset.data);
					ctx.reportAttachmentSuccess(asset.path);
				}
			}
			catch (error) {
				ctx.reportFailed(asset.file.name, error);
			}
			ctx.reportProgress(++done, total);
		}
	}

	private resolveNote(
		note: SourceNote,
		blockIndex: Map<string, BlockRefTarget>,
		aliasMap: Map<string, string>,
		knownPages: Set<string>,
		linkPlans: Map<string, PlannedPageLink>,
		ctx: ImportContext,
	): string | null {
		let body = this.applyLogseqOnly(note.local.body, note.path, ctx);
		body = resolveBlockRefs(body, blockIndex, { alwaysEmbedBlockRefs: this.options.alwaysEmbedBlockRefs });
		if (this.options.removeOrphanBlockRefs) body = removeOrphanBlockRefs(body);
		body = rewriteAliasReferences(body, { aliasMap });
		body = convertTags(body, {
			toLinks: this.options.convertTagsToLinks,
			onlyExistingPages: this.options.convertTagsOnlyExistingPages,
			knownPages,
			dropTags: new Set(this.options.dropTags),
		});
		const yaml = linkifyTagValuesInFrontmatter(note.local.yaml, {
			knownPages,
			toLinks: this.options.convertTagsToLinks,
			onlyExistingPages: this.options.convertTagsOnlyExistingPages,
		});
		if (this.options.journalDateFormat !== ISO_FORMAT) {
			body = reformatDateLinks(body, iso => {
				const date = moment(iso, ISO_FORMAT, true);
				return date.isValid() ? date.format(this.options.journalDateFormat) : null;
			});
		}
		body = rewritePlannedPageLinks(body, linkPlans);
		if (note.kind === 'journal' ? this.options.deOutlineJournals : this.options.deOutlinePages) {
			body = deOutline(body);
		}
		if (isBodyEmpty(yaml, body)) {
			ctx.reportSkipped(note.path, 'The converted page is empty');
			return null;
		}
		return yaml ? `${yaml}\n\n${body}\n` : `${body}\n`;
	}

	private applyLogseqOnly(body: string, name: string, ctx: ImportContext): string {
		if (/\{\{query|#\+BEGIN_QUERY/i.test(body)) {
			if (this.options.queries === 'keep') ctx.reportMessage(`${name}: kept Logseq queries`);
			else {
				body = body.replace(/^[ \t]*#\+BEGIN_QUERY[\s\S]*?#\+END_QUERY[ \t]*$/gim, '');
				body = body.replace(/\{\{query[\s\S]*?\}\}/gi, '');
			}
		}
		if (/#card\b|\{\{cloze/i.test(body)) {
			if (this.options.flashcards === 'keep') ctx.reportMessage(`${name}: kept Logseq flashcards`);
			else {
				body = body.replace(/\{\{cloze\s+([\s\S]*?)\}\}/gi, '$1');
				body = body.replace(/(^|\s)#card\b/gi, '$1');
			}
		}
		return body;
	}

	private linkPlans(notes: SourceNote[]): Map<string, PlannedPageLink> {
		const plans = new Map<string, PlannedPageLink>();
		const basenames = new Map<string, SourceNote[]>();
		for (const note of notes) {
			const target = withoutMarkdownExtension(note.planned.targetPath);
			const sourceBase = graphBasename(note.logicalName);
			const targetBase = graphBasename(target);
			plans.set(note.logicalName.toLowerCase(), {
				target,
				display: sourceBase.toLowerCase() === targetBase.toLowerCase() ? undefined : sourceBase,
			});
			const key = sourceBase.toLowerCase();
			basenames.set(key, [...(basenames.get(key) ?? []), note]);
		}
		for (const [basename, matching] of basenames) {
			const selected = matching.find(note => note.logicalName.toLowerCase() === basename)
				?? (matching.length === 1 ? matching[0] : null);
			if (!selected) continue;
			plans.set(basename, plans.get(selected.logicalName.toLowerCase())!);
		}
		return plans;
	}

	private knownPages(notes: SourceNote[]): Set<string> {
		const known = new Set<string>();
		for (const note of notes) {
			known.add(note.logicalName.toLowerCase());
			known.add(graphBasename(note.logicalName).toLowerCase());
		}
		return known;
	}

	private resolveGraphAsset(graph: GraphSource, notePath: string, sourcePath: string): GraphFile | null {
		const clean = decodedPath(sourcePath.trim().replace(/^<|>$/g, ''));
		const relative = normalizedGraphPath(`${graphParent(notePath)}/${clean}`);
		return graph.byPath.get(relative.toLowerCase())
			?? graph.byPath.get(normalizedGraphPath(clean.replace(/^(\.\.\/)+/, '')).toLowerCase())
			?? null;
	}

	private async planAssets(graph: GraphSource, notes: SourceNote[], ctx: ImportContext): Promise<PlannedAsset[]> {
		const planned: PlannedAsset[] = [];
		const bySource = new Map<string, PlannedAsset>();

		for (const note of notes) {
			for (const reference of note.local.assets) {
				const source = this.resolveGraphAsset(graph, note.path, reference.sourcePath);
				if (!source) {
					note.assetTargets.set(reference.sourcePath, null);
					ctx.reportSkipped(reference.sourcePath, `Referenced by ${note.path}, but missing from the graph`);
					continue;
				}

				let asset = bySource.get(source.path.toLowerCase());
				if (!asset) {
					const data = await source.file.read();
					const filename = decodedPath(reference.filename);
					const placed = await this.placeAttachment(filename, note.planned.targetPath, async existing =>
						sameBytes(await this.vault.readBinary(existing), data) ? 'same' : 'another');
					asset = { file: source.file, path: placed.path, reuse: placed.reuse, data };
					bySource.set(source.path.toLowerCase(), asset);
					planned.push(asset);
				}
				note.assetTargets.set(reference.sourcePath, asset.path);
			}
		}

		return planned;
	}
}
