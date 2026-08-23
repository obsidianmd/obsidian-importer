import { moment, normalizePath, Notice, TextComponent, TFile } from 'obsidian';
import { ImportContext } from '../import-context';
import { NodePickedFile, PickedFile, PickedFolder, fsPromises } from '../filesystem';
import { FormatImporter, NoteTemplateSample, PlannedNote, TEMPLATE_PREVIEW_LIMIT } from '../format-importer';
import { i18n } from '../i18n';
import { outsideMarkdownCode } from '../markdown';
import { sameBytes, sanitizeFileName, sanitizeFilePath } from '../util';
import { convertAssetLinks } from './logseq/assets';
import { BlockRefTarget, removeOrphanBlockRefs, resolveBlockRefs } from './logseq/block-ids';
import { defaultLogseqConfig, LogseqFilenameFormat, LogseqGraphConfig, parseLogseqConfig } from './logseq/config';
import { deOutline } from './logseq/de-outline';
import { journalFilenameToISO, logseqDateFormatToMoment, reformatDateLinks } from './logseq/journals';
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

function relativeToGraphDirectory(path: string, directory: string): string | null {
	const lowerPath = path.toLowerCase();
	const lowerDirectory = directory.toLowerCase();
	const prefix = `${lowerDirectory}/`;
	return lowerPath.startsWith(prefix) ? path.slice(prefix.length) : null;
}

async function walkItems(items: (PickedFile | PickedFolder)[], parent: string, files: GraphFile[]): Promise<void> {
	for (const item of items) {
		const path = normalizedGraphPath(parent ? `${parent}/${item.name}` : item.name);
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

export class LogseqImporter extends FormatImporter {
	static extensions = ['md'];

	interruption = 'pause' as const;
	options!: LogseqImportOptions;

	init(): void {
		this.keepsFolders = true;
		this.defaultOutputFolder = 'Logseq';
		this.idProperty = 'logseq-source';
		this.idLabel = i18n.importer.logseq.labelId();
		this.options = { ...DEFAULT_LOGSEQ_OPTIONS };

		const dailyNotes = this.dailyNotesConfig();
		this.options.journalDateFormat = dailyNotes.format;
		this.options.journalFolder = dailyNotes.folder;

		this.addExportSetting(i18n.importer.logseq.descExport());
		this.addFileChooserSetting(i18n.importer.logseq.fileType(), LogseqImporter.extensions, true,
			i18n.importer.logseq.descFiles());

		this.drawOptions(dailyNotes);
	}

	get sourceReady(): boolean {
		return this.chosen.filter(item => item.type === 'folder').length === 1;
	}

	private drawOptions(dailyNotes: { format: string, folder: string }): void {
		this.startGroup('options', i18n.importer.logseq.groupTasks());
		this.addSetting()
			?.setName(i18n.importer.logseq.nameTaskFormat())
			.setDesc(i18n.importer.logseq.descTaskFormat())
			.addDropdown(dropdown => dropdown
				.addOption('plain', i18n.importer.logseq.optionPlainCheckboxes())
				.addOption('tasks-emoji', i18n.importer.logseq.optionTasksEmoji())
				.addOption('tasks-dataview', i18n.importer.logseq.optionTasksDataview())
				.setValue(this.options.taskFormat)
				.onChange(value => this.options.taskFormat = value as TaskFormat));

		this.startGroup('options', i18n.importer.logseq.groupJournals());
		let journalFolder: TextComponent | undefined;
		let journalFormat: TextComponent | undefined;
		this.addSetting()
			?.setName(i18n.importer.logseq.nameUseDailyNotes())
			.setDesc(i18n.importer.logseq.descUseDailyNotes())
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
			?.setName(i18n.importer.logseq.nameJournalFolder())
			.setDesc(i18n.importer.logseq.descJournalFolder())
			.addText(text => {
				journalFolder = text;
				text.setValue(this.options.journalFolder)
					.setDisabled(this.options.useDailyNotes)
					.onChange(value => this.options.journalFolder = value);
			});
		this.addSetting()
			?.setName(i18n.importer.logseq.nameJournalDateFormat())
			.setDesc(i18n.importer.logseq.descJournalDateFormat())
			.addText(text => {
				journalFormat = text;
				text.setValue(this.options.journalDateFormat)
					.setDisabled(this.options.useDailyNotes)
					.onChange(value => this.options.journalDateFormat = value || ISO_FORMAT);
			});
		this.addSetting()
			?.setName(i18n.importer.logseq.nameDeOutlineJournals())
			.setDesc(i18n.importer.logseq.descDeOutlineJournals())
			.addToggle(toggle => toggle
				.setValue(this.options.deOutlineJournals)
				.onChange(value => this.options.deOutlineJournals = value));

		this.startGroup('options', i18n.importer.logseq.groupPages());
		this.addSetting()
			?.setName(i18n.importer.logseq.namePagesFolder())
			.setDesc(i18n.importer.logseq.descPagesFolder())
			.addText(text => text
				.setValue(this.options.pagesFolder)
				.onChange(value => this.options.pagesFolder = value));
		this.addSetting()
			?.setName(i18n.importer.logseq.nameDeOutlinePages())
			.setDesc(i18n.importer.logseq.descDeOutlinePages())
			.addToggle(toggle => toggle
				.setValue(this.options.deOutlinePages)
				.onChange(value => this.options.deOutlinePages = value));

		this.startGroup('options', i18n.importer.logseq.groupLinks());
		this.addSetting()
			?.setName(i18n.importer.logseq.nameConvertTags())
			.setDesc(i18n.importer.logseq.descConvertTags())
			.addToggle(toggle => toggle
				.setValue(this.options.convertTagsToLinks)
				.onChange(value => this.options.convertTagsToLinks = value));
		this.addSetting()
			?.setName(i18n.importer.logseq.nameOnlyExistingTags())
			.setDesc(i18n.importer.logseq.descOnlyExistingTags())
			.addToggle(toggle => toggle
				.setValue(this.options.convertTagsOnlyExistingPages)
				.onChange(value => this.options.convertTagsOnlyExistingPages = value));
		this.addSetting()
			?.setName(i18n.importer.logseq.nameDropTags())
			.setDesc(i18n.importer.logseq.descDropTags())
			.addText(text => text
				.setValue(this.options.dropTags.join(', '))
				.onChange(value => this.options.dropTags = this.listSetting(value)));

		this.startGroup('options', i18n.importer.logseq.groupLogseqOnly());
		this.keepOrDropSetting(i18n.importer.logseq.nameQueries(), i18n.importer.logseq.descQueries(),
			this.options.queries, value => this.options.queries = value);
		this.keepOrDropSetting(i18n.importer.logseq.nameFlashcards(), i18n.importer.logseq.descFlashcards(),
			this.options.flashcards, value => this.options.flashcards = value);
		this.keepOrDropSetting(i18n.importer.logseq.nameTimeTracking(), i18n.importer.logseq.descTimeTracking(),
			this.options.logbook, value => this.options.logbook = value);

		this.startGroup('options', i18n.importer.logseq.groupBlockReferences());
		this.addSetting()
			?.setName(i18n.importer.logseq.nameShortenBlockIds())
			.setDesc(i18n.importer.logseq.descShortenBlockIds())
			.addToggle(toggle => toggle
				.setValue(this.options.shortenBlockIds)
				.onChange(value => this.options.shortenBlockIds = value));
		this.addSetting()
			?.setName(i18n.importer.logseq.nameRemoveOrphanRefs())
			.setDesc(i18n.importer.logseq.descRemoveOrphanRefs())
			.addToggle(toggle => toggle
				.setValue(this.options.removeOrphanBlockRefs)
				.onChange(value => this.options.removeOrphanBlockRefs = value));
		this.addSetting()
			?.setName(i18n.importer.logseq.nameEmbedBlockRefs())
			.setDesc(i18n.importer.logseq.descEmbedBlockRefs())
			.addToggle(toggle => toggle
				.setValue(this.options.alwaysEmbedBlockRefs)
				.onChange(value => this.options.alwaysEmbedBlockRefs = value));

		this.startGroup('options', i18n.importer.logseq.groupProperties());
		this.addSetting()
			?.setName(i18n.importer.logseq.nameDropPageProperties())
			.setDesc(i18n.importer.logseq.descDropPageProperties())
			.addText(text => text
				.setValue(this.options.dropPageProperties.join(', '))
				.onChange(value => this.options.dropPageProperties = this.listSetting(value)));
		this.addSetting()
			?.setName(i18n.importer.logseq.nameDropBlockProperties())
			.setDesc(i18n.importer.logseq.descDropBlockProperties())
			.addText(text => text
				.setValue(this.options.dropBlockProperties.join(', '))
				.onChange(value => this.options.dropBlockProperties = this.listSetting(value)));
		this.addSetting()
			?.setName(i18n.importer.logseq.nameBlockProperties())
			.setDesc(i18n.importer.logseq.descBlockProperties())
			.addDropdown(dropdown => dropdown
				.addOption('keep', i18n.importer.logseq.optionKeep())
				.addOption('wrap', i18n.importer.logseq.optionWrapProperties())
				.addOption('drop', i18n.importer.logseq.optionDrop())
				.setValue(this.options.blockProperties)
				.onChange(value => this.options.blockProperties = value as LogseqImportOptions['blockProperties']));
		this.addSetting()
			?.setName(i18n.importer.logseq.nameSnakeCasePages())
			.setDesc(i18n.importer.logseq.descSnakeCasePages())
			.addToggle(toggle => toggle
				.setValue(this.options.snakeCasePageProperties)
				.onChange(value => this.options.snakeCasePageProperties = value));
		this.addSetting()
			?.setName(i18n.importer.logseq.nameSnakeCaseBlocks())
			.setDesc(i18n.importer.logseq.descSnakeCaseBlocks())
			.addToggle(toggle => toggle
				.setValue(this.options.snakeCaseBlockProperties)
				.onChange(value => this.options.snakeCaseBlockProperties = value));

		this.startGroup('options', i18n.importer.logseq.groupCleanup());
		this.addSetting()
			?.setName(i18n.importer.logseq.nameKeepAltText())
			.setDesc(i18n.importer.logseq.descKeepAltText())
			.addToggle(toggle => toggle
				.setValue(this.options.keepAssetAltText)
				.onChange(value => this.options.keepAssetAltText = value));
		this.addSetting()
			?.setName(i18n.importer.logseq.nameNormalizeWhitespace())
			.setDesc(i18n.importer.logseq.descNormalizeWhitespace())
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
				.addOption('keep', i18n.importer.logseq.optionKeep())
				.addOption('drop', i18n.importer.logseq.optionDrop())
				.setValue(value)
				.onChange(next => changed(next as KeepOrDrop)));
	}

	private listSetting(value: string): string[] {
		return value.split(',').map(item => item.trim()).filter(Boolean);
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
		const configFile = byPath.get('logseq/config.edn');
		if (configFile) {
			try {
				config = parseLogseqConfig(await configFile.file.readText());
			}
			catch (error) {
				ctx.reportFailed(configFile.path, error);
			}
		}
		const whiteboardsPrefix = `${config.whiteboardsDirectory.toLowerCase()}/`;
		hasWhiteboards ||= files.some(entry => entry.path.toLowerCase().startsWith(whiteboardsPrefix));
		return { name: root.name, files, byPath, hasWhiteboards, config };
	}

	private noteEntries(graph: GraphSource): GraphFile[] {
		return graph.files.filter(entry => entry.file.extension === 'md' && (
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
			const sourceStem = withoutMarkdownExtension(journalPath);
			const iso = journalFilenameToISO(sourceStem, graph.config.journalFileNameFormat);
			logicalName = iso
				? moment(iso, ISO_FORMAT, true).format(this.options.journalDateFormat)
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
				? this.options.journalFolder.trim()
				: normalizePath([outputRoot, this.options.journalFolder.trim()].filter(Boolean).join('/'));
			const logicalParent = sanitizeFilePath(graphParent(logicalName), journalRoot);
			parent = normalizePath([journalRoot, logicalParent].filter(Boolean).join('/'));
		}
		else {
			logicalName = namespaceToPath(entry.file.basename, graph.config.filenameFormat);
			sourceNames = [logicalName];
			const pageRoot = normalizePath([outputRoot, this.options.pagesFolder.trim()].filter(Boolean).join('/'));
			const logicalParent = sanitizeFilePath(graphParent(logicalName), pageRoot);
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
				keepAltText: this.options.keepAssetAltText,
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
		body = rewritePlannedPageLinks(body, linkPlans, note.filenameFormat);
		if (note.kind === 'journal' ? this.options.deOutlineJournals : this.options.deOutlinePages) {
			body = deOutline(body);
		}
		if (isBodyEmpty(yaml, body)) {
			ctx.reportSkipped(note.path, i18n.importer.logseq.reasonEmptyPage());
			return null;
		}
		return yaml ? `${yaml}\n\n${body}\n` : `${body}\n`;
	}

	private applyLogseqOnly(body: string, hasQueries: boolean, name: string, ctx: ImportContext): string {
		if (hasQueries && this.options.queries === 'keep') {
			ctx.reportMessage(i18n.importer.logseq.msgKeptQueries({ name }));
		}
		if (/#card\b|\{\{cloze/i.test(body)) {
			if (this.options.flashcards === 'keep') {
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
		const relative = normalizedGraphPath(`${graphParent(notePath)}/${clean}`);
		return graph.byPath.get(relative.toLowerCase())
			?? graph.byPath.get(normalizedGraphPath(clean.replace(/^(\.\.\/)+/, '')).toLowerCase())
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
