import { moment, normalizePath, Notice, TFile } from 'obsidian';
import { ImportContext } from '../import-context';
import { NodePickedFile, PickedFile, PickedFolder, fsPromises } from '../filesystem';
import { FormatImporter, NoteTemplateSample, PlannedNote, TEMPLATE_PREVIEW_LIMIT } from '../format-importer';
import { i18n } from '../i18n';
import { normalizeTreePath, parentTreePath } from '../imported-path-index';
import { outsideMarkdownCode } from '../markdown';
import { PickedFolderLoad, PickedFolderNode, PickedFolderPicker, PickedFolderSelection, pickedFolderFileCount, pickedFolderNodes } from '../picked-folder-tree';
import { sameBytes, sanitizeFileName, sanitizeFilePath } from '../util';
import { convertAssetLinks } from './logseq/assets';
import { BlockRefTarget, resolveBlockRefs } from './logseq/block-ids';
import { defaultLogseqConfig, LogseqFilenameFormat, LogseqGraphConfig, parseLogseqConfig } from './logseq/config';
import { deOutline } from './logseq/de-outline';
import { journalFilenameToISO, logseqDateFormatToMoment, reformatDateLinks } from './logseq/journals';
import { convertTags, rewriteAliasReferences, rewritePlannedPageLinks, PlannedPageLink } from './logseq/links';
import { DEFAULT_LOGSEQ_OPTIONS, LogseqImportOptions } from './logseq/options';
import { namespaceToPath } from './logseq/paths';
import { convertLocal, indexPageAliases, isBodyEmpty, LocalResult } from './logseq/pipeline';

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
	hasWhiteboards: boolean;
	config: LogseqGraphConfig;
}

interface FileTimes { ctime: number, mtime: number }

interface SourceNote extends GraphFile {
	kind: 'page' | 'journal';
	logicalName: string;
	sourceNames: string[];
	filenameFormat: LogseqFilenameFormat;
	parent: string;
	title: string;
	sourceId: string;
	content: string;
	local: LocalResult;
	planned: PlannedNote;
	times?: FileTimes;
	assetTargets: Map<string, string | null>;
}

interface PlannedAsset {
	file: PickedFile;
	path: string;
	reuse: TFile | null;
	times?: FileTimes;
}

function withoutMarkdownExtension(path: string): string {
	return path.replace(/\.md$/i, '');
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

function relativeToGraphDirectory(path: string, directory: string): string | null {
	const lowerPath = path.toLowerCase();
	const lowerDirectory = directory.toLowerCase();
	const prefix = `${lowerDirectory}/`;
	return lowerPath.startsWith(prefix) ? path.slice(prefix.length) : null;
}

async function walkItems(items: (PickedFile | PickedFolder)[], parent: string, files: GraphFile[]): Promise<void> {
	for (const item of items) {
		const path = normalizeTreePath(parent ? `${parent}/${item.name}` : item.name);
		if (item.type === 'folder') await walkItems(await item.list(), path, files);
		else files.push({ file: item, path });
	}
}

async function fileTimes(file: PickedFile): Promise<FileTimes | undefined> {
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

type BooleanOptionKey = {
	[K in keyof LogseqImportOptions]: LogseqImportOptions[K] extends boolean ? K : never;
}[keyof LogseqImportOptions];

export class LogseqImporter extends FormatImporter {
	static extensions = ['md'];

	interruption = 'pause' as const;
	options!: LogseqImportOptions;
	private folderPicker!: PickedFolderPicker;

	init(): void {
		this.keepsFolders = true;
		this.defaultOutputFolder = 'Logseq';
		this.idProperty = 'logseq-source';
		this.idLabel = i18n.importer.logseq.labelId();
		this.options = { ...DEFAULT_LOGSEQ_OPTIONS };
		this.folderPicker = new PickedFolderPicker(
			() => this.chosen,
			async (source, isCurrent) => this.loadFolderTree(source, isCurrent),
		);

		this.addExportSetting(i18n.importer.logseq.descExport());
		this.addFileChooserSetting(i18n.importer.logseq.fileType(), LogseqImporter.extensions, true,
			i18n.importer.logseq.descFiles());
		this.draw(contentEl => this.folderPicker.draw(contentEl, this.addSetting('source')), 'source');

		this.drawOptions();
	}

	get sourceReady(): boolean {
		return this.graphFolder() !== null;
	}

	protected override sourceChanged(): void {
		super.sourceChanged();
		this.folderPicker.changed();
	}

	private drawOptions(): void {
		this.startGroup('options', i18n.importer.logseq.groupJournals());
		this.toggleSetting(i18n.importer.logseq.nameUseDailyNotes(), i18n.importer.logseq.descUseDailyNotes(), 'useDailyNotes');

		this.startGroup('options', i18n.importer.logseq.groupStructure());
		this.toggleSetting(i18n.importer.logseq.nameFlattenOutlines(), i18n.importer.logseq.descFlattenOutlines(), 'flattenOutlines');

		this.startGroup('options', i18n.importer.logseq.groupLogseqOnly());
		this.toggleSetting(i18n.importer.logseq.nameQueries(), i18n.importer.logseq.descQueries(), 'queries');
		this.toggleSetting(i18n.importer.logseq.nameFlashcards(), i18n.importer.logseq.descFlashcards(), 'flashcards');
		this.toggleSetting(i18n.importer.logseq.nameTimeTracking(), i18n.importer.logseq.descTimeTracking(), 'timeTracking');
	}

	private toggleSetting(name: string, description: string, key: BooleanOptionKey): void {
		this.addSetting()
			?.setName(name)
			.setDesc(description)
			.addToggle(toggle => toggle
				.setValue(this.options[key])
				.onChange(value => this.options[key] = value));
	}

	private async loadFolderTree(
		source: (PickedFile | PickedFolder)[],
		isCurrent: () => boolean,
	): Promise<PickedFolderLoad> {
		const root = source.length === 1 && source[0].type === 'folder' ? source[0] : null;
		if (!root) return { nodes: [], files: 0 };

		const items = await root.list();
		const files: GraphFile[] = [];
		await walkItems(items.filter(item => item.type === 'folder' && item.name.toLowerCase() === 'logseq'), '', files);
		if (!isCurrent()) return { nodes: [], files: 0 };

		const config = await this.graphConfig(files);
		const noteRoots = new Set([config.pagesDirectory, config.journalsDirectory]
			.map(path => normalizeTreePath(path).split('/')[0].toLowerCase()));
		const countFile = (file: PickedFile, parent: string) => file.extension === 'md' && (
			relativeToGraphDirectory(`${parent}/${file.name}`, config.pagesDirectory) !== null
			|| relativeToGraphDirectory(`${parent}/${file.name}`, config.journalsDirectory) !== null
		);
		const nodes = await pickedFolderNodes(items, {
			includeFolder: (folder, chosen) => !chosen || noteRoots.has(folder.name.toLowerCase()),
			countFile,
			isCurrent,
		});
		const withNotes = this.noteFolders(nodes);
		return {
			nodes: withNotes,
			files: pickedFolderFileCount(items, withNotes, countFile),
		};
	}

	private noteFolders(nodes: PickedFolderNode[]): PickedFolderNode[] {
		for (const node of nodes) node.children = this.noteFolders(node.children ?? []);
		return nodes.filter(node => node.files > 0);
	}

	private async graphConfig(files: GraphFile[]): Promise<LogseqGraphConfig> {
		const configFile = files.find(entry => entry.path.toLowerCase() === 'logseq/config.edn');
		if (!configFile) return defaultLogseqConfig();
		return parseLogseqConfig(await configFile.file.readText());
	}

	private dailyNotesConfig(): { format: string, folder: string } {
		const app = this.app as { internalPlugins?: InternalPlugins };
		const options = app.internalPlugins?.getPluginById('daily-notes')?.instance?.options;
		return { format: options?.format || ISO_FORMAT, folder: options?.folder || 'Journals' };
	}

	private graphFolder(): PickedFolder | null {
		const folders = this.chosen.filter((item): item is PickedFolder => item.type === 'folder');
		return folders.length === 1 ? folders[0] : null;
	}

	private includesEntry(entry: GraphFile, selection: PickedFolderSelection): boolean {
		if (selection.included === null) return true;
		const parent = parentTreePath(entry.path);
		for (const skipped of selection.skipped) {
			if (parent === skipped || parent.startsWith(`${skipped}/`)) return false;
		}
		return selection.included.has(parent);
	}

	private async readGraph(ctx: ImportContext): Promise<GraphSource | null> {
		const root = this.graphFolder();
		if (!root) return null;

		const files: GraphFile[] = [];
		let hasWhiteboards = false;
		try {
			const items = await root.list();
			hasWhiteboards = items.some(item => item.type === 'folder' && item.name.toLowerCase() === 'whiteboards');
			await walkItems(items.filter(item =>
				!(item.type === 'folder' && item.name.toLowerCase() === 'whiteboards')), '', files);
		}
		catch (error) {
			ctx.reportFailed(root.name, error);
			return null;
		}

		const byPath = new Map<string, GraphFile>();
		for (const entry of files) byPath.set(entry.path.toLowerCase(), entry);
		let config = defaultLogseqConfig();
		try {
			config = await this.graphConfig(files);
		}
		catch (error) {
			ctx.reportFailed('logseq/config.edn', error);
		}
		const whiteboardsPrefix = `${config.whiteboardsDirectory.toLowerCase()}/`;
		hasWhiteboards ||= files.some(entry => entry.path.toLowerCase().startsWith(whiteboardsPrefix));
		return { name: root.name, files, byPath, hasWhiteboards, config };
	}

	private noteEntries(graph: GraphSource): GraphFile[] {
		const selection = this.folderPicker.selection();
		return graph.files.filter(entry => this.includesEntry(entry, selection) && entry.file.extension === 'md' && (
			relativeToGraphDirectory(entry.path, graph.config.pagesDirectory) !== null ||
			relativeToGraphDirectory(entry.path, graph.config.journalsDirectory) !== null
		));
	}

	private desiredNote(entry: GraphFile, graph: GraphSource, outputRoot: string): Omit<SourceNote,
		'content' | 'local' | 'planned' | 'times' | 'assetTargets'> {
		const journalPath = relativeToGraphDirectory(entry.path, graph.config.journalsDirectory);
		const journal = journalPath !== null;
		let logicalName: string;
		let parent: string;
		let sourceNames: string[];

		if (journal) {
			const dailyNotes = this.options.useDailyNotes
				? this.dailyNotesConfig()
				: { format: ISO_FORMAT, folder: 'Journals' };
			const sourceStem = withoutMarkdownExtension(journalPath);
			const iso = journalFilenameToISO(sourceStem, graph.config.journalFileNameFormat);
			logicalName = iso
				? moment(iso, ISO_FORMAT, true).format(dailyNotes.format)
				: sourceStem;
			sourceNames = [logicalName];
			if (iso) {
				sourceNames.push(iso);
				if (graph.config.journalPageTitleFormat) {
					sourceNames.push(moment(iso, ISO_FORMAT, true)
						.format(logseqDateFormatToMoment(graph.config.journalPageTitleFormat)));
				}
			}
			const journalRoot = this.options.useDailyNotes
				? dailyNotes.folder.trim()
				: normalizePath([outputRoot, dailyNotes.folder].filter(Boolean).join('/'));
			const logicalParent = sanitizeFilePath(parentTreePath(logicalName), journalRoot);
			parent = normalizePath([journalRoot, logicalParent].filter(Boolean).join('/'));
		}
		else {
			logicalName = namespaceToPath(entry.file.basename, graph.config.filenameFormat);
			sourceNames = [logicalName];
			const pageRoot = outputRoot;
			const logicalParent = sanitizeFilePath(parentTreePath(logicalName), pageRoot);
			parent = normalizePath([pageRoot, logicalParent].filter(Boolean).join('/'));
		}

		const title = graphBasename(logicalName);
		return {
			...entry,
			kind: journal ? 'journal' : 'page',
			logicalName,
			sourceNames: [...new Set(sourceNames)],
			filenameFormat: graph.config.filenameFormat,
			parent,
			title,
			sourceId: `${graph.name}/${entry.path}`,
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
				const desired = this.desiredNote(entry, graph, outputRoot);
				const local = convertLocal(await entry.file.readText(), this.options, {
					commaSeparatedProperties: graph.config.commaSeparatedProperties,
				});
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
			new Notice(i18n.importer.logseq.msgPickGraph());
			return;
		}
		if (graph.hasWhiteboards) {
			ctx.reportSkipped('whiteboards', i18n.importer.logseq.reasonWhiteboards());
		}

		const entries = this.noteEntries(graph);
		if (entries.length === 0) {
			new Notice(i18n.importer.logseq.msgNoNotes());
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
				const desired = this.desiredNote(entry, graph, outputRoot);
				const content = await entry.file.readText();
				// Attachment paths depend on every note's provisional claim.
				const local = convertLocal(content, this.options, {
					assetTarget: () => null,
					commaSeparatedProperties: graph.config.commaSeparatedProperties,
				});
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
		for (const note of notes) this.releasePath(note.planned.targetPath);
		if (ctx.isCancelled()) return;

		// Re-plan titles so {{content}} sees final attachment links.
		for (const note of notes) {
			const linked = convertAssetLinks(note.local.body, {
				keepAltText: false,
				target: asset => note.assetTargets.get(asset.sourcePath) ?? null,
			});
			note.local = { ...note.local, body: linked.content };
			const preliminary = note.local.yaml
				? `${note.local.yaml}\n\n${note.local.body}\n`
				: `${note.local.body}\n`;
			note.planned = await this.planTemplatedNote(note.parent, note.title, preliminary, {
				sourceId: note.sourceId,
				...note.times,
			});
		}

		const linkPlans = this.linkPlans(notes);
		const knownPages = this.knownPages(notes);
		const blockIndex = new Map<string, BlockRefTarget>();
		const aliasMap = new Map<string, string>();
		const ambiguousAliases = new Set<string>();

		for (const note of notes) {
			const target = withoutMarkdownExtension(note.planned.targetPath);
			const aliases = { ...note.local.raw };
			if (aliases.title?.toLowerCase() === note.logicalName.toLowerCase()) delete aliases.title;
			indexPageAliases(aliases, target, aliasMap, ambiguousAliases, knownPages);
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
					await this.writeAttachment(asset.path, await asset.file.read(), asset.times);
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
		let body = this.applyLogseqOnly(note.local.body, note.local.hasQueries, note.path, ctx);
		body = resolveBlockRefs(body, blockIndex);
		body = rewriteAliasReferences(body, { aliasMap });
		body = convertTags(body, {
			toLinks: false,
			onlyExistingPages: true,
			knownPages,
			dropTags: new Set(this.options.flashcards ? [] : ['card']),
		});
		const yaml = note.local.yaml;
		const journalDateFormat = this.options.useDailyNotes
			? this.dailyNotesConfig().format
			: ISO_FORMAT;
		if (journalDateFormat !== ISO_FORMAT) {
			body = reformatDateLinks(body, iso => {
				const date = moment(iso, ISO_FORMAT, true);
				return date.isValid() ? date.format(journalDateFormat) : null;
			});
		}
		body = rewritePlannedPageLinks(body, linkPlans, note.filenameFormat);
		if (this.options.flattenOutlines) {
			body = deOutline(body);
		}
		if (isBodyEmpty(yaml, body)) {
			ctx.reportSkipped(note.path, i18n.importer.logseq.reasonEmptyPage());
			return null;
		}
		return yaml ? `${yaml}\n\n${body}\n` : `${body}\n`;
	}

	private applyLogseqOnly(body: string, hasQueries: boolean, name: string, ctx: ImportContext): string {
		if (hasQueries && this.options.queries) {
			ctx.reportMessage(i18n.importer.logseq.msgKeptQueries({ name }));
		}
		if (/#card\b|\{\{cloze/i.test(body)) {
			if (this.options.flashcards) {
				ctx.reportMessage(i18n.importer.logseq.msgKeptFlashcards({ name }));
			}
			else {
				body = outsideMarkdownCode(body, segment => segment
					.replace(/\{\{cloze\s+([\s\S]*?)\}\}/gi, '$1')
					.replace(/(^|\s)#card\b/gi, '$1'));
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
			for (const sourceName of note.sourceNames) {
				const display = graphBasename(sourceName);
				plans.set(sourceName.toLowerCase(), {
					target,
					display: display.toLowerCase() === targetBase.toLowerCase() ? undefined : display,
				});
			}
			const key = sourceBase.toLowerCase();
			basenames.set(key, [...(basenames.get(key) ?? []), note]);
		}
		for (const [basename, matching] of basenames) {
			const selected = matching.find(note => note.logicalName.toLowerCase() === basename) ?? null;
			if (!selected) continue;
			plans.set(basename, plans.get(selected.logicalName.toLowerCase())!);
		}
		return plans;
	}

	private knownPages(notes: SourceNote[]): Set<string> {
		const known = new Set<string>();
		for (const note of notes) {
			for (const sourceName of note.sourceNames) {
				known.add(sourceName.toLowerCase());
				known.add(graphBasename(sourceName).toLowerCase());
			}
		}
		return known;
	}

	private resolveGraphAsset(graph: GraphSource, notePath: string, sourcePath: string): GraphFile | null {
		const clean = decodedPath(sourcePath.trim().replace(/^<|>$/g, ''));
		const relative = normalizeTreePath(`${parentTreePath(notePath)}/${clean}`);
		return graph.byPath.get(relative.toLowerCase())
			?? graph.byPath.get(normalizeTreePath(clean.replace(/^(\.\.\/)+/, '')).toLowerCase())
			?? null;
	}

	private async planAssets(graph: GraphSource, notes: SourceNote[], ctx: ImportContext): Promise<PlannedAsset[]> {
		const planned: PlannedAsset[] = [];
		const bySource = new Map<string, PlannedAsset>();
		const failedSources = new Set<string>();

		for (const note of notes) {
			for (const reference of note.local.assets) {
				if (await ctx.shouldStop()) return planned;
				const source = this.resolveGraphAsset(graph, note.path, reference.sourcePath);
				if (!source) {
					note.assetTargets.set(reference.sourcePath, null);
					ctx.reportSkipped(reference.sourcePath,
						i18n.importer.logseq.reasonMissingAsset({ name: note.path }));
					continue;
				}

				const sourceKey = source.path.toLowerCase();
				if (failedSources.has(sourceKey)) {
					note.assetTargets.set(reference.sourcePath, null);
					continue;
				}

				let asset = bySource.get(sourceKey);
				try {
					if (!asset) {
						const data = await source.file.read();
						const filename = decodedPath(reference.filename);
						const placed = await this.placeAttachment(filename, note.planned.targetPath, async existing =>
							sameBytes(await this.vault.readBinary(existing), data) ? 'same' : 'another');
						asset = {
							file: source.file,
							path: placed.path,
							reuse: placed.reuse,
							times: placed.reuse ? undefined : await fileTimes(source.file),
						};
						bySource.set(sourceKey, asset);
						planned.push(asset);
					}
					note.assetTargets.set(reference.sourcePath, asset.path);
				}
				catch (error) {
					failedSources.add(sourceKey);
					note.assetTargets.set(reference.sourcePath, null);
					ctx.reportFailed(source.path, error);
				}
			}
		}

		return planned;
	}
}
