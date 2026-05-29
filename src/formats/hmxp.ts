import { normalizePath, Notice, Platform, TFolder } from 'obsidian';
import { fs, fsPromises, nodeBufferToArrayBuffer, NodePickedFile, parseFilePath, path } from '../filesystem';
import { FormatImporter } from '../format-importer';
import { ImportContext } from '../main';
import { sanitizeFileName } from '../util';
import {
	convertHmxpTopicXml,
	HmxpTopic,
	HmxpTocNode,
	parseHmxpTocXml,
	renderHmxpKeywordsMarkdown,
	renderHmxpTocMarkdown,
} from './hmxp/convert';

interface HmxpTopicSource {
	id: string;
	filePath: string;
	relativePath: string;
	xml: string;
}

interface AttachmentOutput {
	sourcePath: string;
	outputPath: string;
}

export class HmxpImporter extends FormatImporter {
	init() {
		if (!Platform.isDesktopApp) {
			this.notAvailable = true;
			this.modal.contentEl.createEl('p', {
				text: 'Help+Manual HMXP projects can only be imported from the desktop app because they are folder-based exports.',
			});
			return;
		}

		this.addFileChooserSetting(
			'Help+Manual HMXP',
			['hmxp'],
			true,
			'Pick one or more .hmxp project files, or choose folders that contain .hmxp projects.',
		);
		this.addOutputLocationSetting('Help+Manual import');
	}

	async import(ctx: ImportContext): Promise<void> {
		const projectFiles = this.files.filter((file): file is NodePickedFile => file instanceof NodePickedFile && file.extension === 'hmxp');
		if (projectFiles.length === 0) {
			new Notice('Please pick a Help+Manual .hmxp project file or folder.');
			return;
		}

		const outputFolder = await this.getOutputFolder();
		if (!outputFolder) {
			new Notice('Please select a location to export to.');
			return;
		}

		for (const projectFile of projectFiles) {
			if (ctx.isCancelled()) return;
			await this.importProject(ctx, projectFile, outputFolder, projectFiles.length > 1);
		}
	}

	private async importProject(ctx: ImportContext, projectFile: NodePickedFile, outputFolder: TFolder, useProjectSubfolder: boolean) {
		const projectRoot = path.dirname(projectFile.filepath);
		const projectOutputFolder = useProjectSubfolder
			? await this.createFolders(`${outputFolder.path}/${projectFile.basename}`)
			: outputFolder;

		ctx.status(`Reading ${projectFile.name}`);
		let topicSources: HmxpTopicSource[];
		try {
			topicSources = await this.readTopicSources(projectRoot);
		}
		catch (error) {
			ctx.reportFailed(projectFile.name, error);
			return;
		}
		if (topicSources.length === 0) {
			ctx.reportFailed(projectFile.name, 'No XML topic files were found in the Topics folder.');
			return;
		}

		const topicIds = new Set(topicSources.map(topic => topic.id));
		const attachmentsFolder = await this.createFolders(`${projectOutputFolder.path}/Attachments`);
		const attachmentOutputs = new Map<string, AttachmentOutput>();
		const claimedAttachmentPaths = new Set<string>();
		const topics: HmxpTopic[] = [];

		ctx.reportProgress(0, topicSources.length);

		for (let i = 0; i < topicSources.length; i++) {
			if (ctx.isCancelled()) return;

			const source = topicSources[i];
			try {
				ctx.status(`Converting ${source.relativePath}`);
				const topic = convertHmxpTopicXml(source.xml, source.id, {
					topicIds,
					resolveAttachment: attachmentSource => this.resolveAttachment(
						projectRoot,
						source.filePath,
						attachmentSource,
						attachmentsFolder,
						attachmentOutputs,
						claimedAttachmentPaths,
					),
				});
				topics.push(topic);

				const relativeFolder = parseFilePath(source.relativePath).parent;
				const targetFolder = relativeFolder
					? await this.createFolders(`${projectOutputFolder.path}/${relativeFolder}`)
					: projectOutputFolder;
				await this.saveAsMarkdownFile(targetFolder, source.id, topic.markdown);
				ctx.reportNoteSuccess(source.relativePath);
			}
			catch (error) {
				ctx.reportFailed(source.relativePath, error);
			}

			ctx.reportProgress(i + 1, topicSources.length);
		}

		await this.writeGeneratedIndexes(projectRoot, projectOutputFolder, topics);
		await this.copyAttachments(ctx, attachmentOutputs);
	}

	private async readTopicSources(projectRoot: string): Promise<HmxpTopicSource[]> {
		const topicsRoot = path.join(projectRoot, 'Topics');
		const topicFiles = await this.collectXmlFiles(topicsRoot);
		const mapOrder = await this.readMapOrder(projectRoot);

		const sources: HmxpTopicSource[] = [];
		for (const filePath of topicFiles) {
			const relativePath = normalizePath(path.relative(topicsRoot, filePath));
			const { basename } = parseFilePath(relativePath);
			sources.push({
				id: basename,
				filePath,
				relativePath,
				xml: await fsPromises.readFile(filePath, 'utf8'),
			});
		}

		return sources.sort((a, b) => {
			const aOrder = mapOrder.get(a.id);
			const bOrder = mapOrder.get(b.id);
			if (aOrder !== undefined && bOrder !== undefined) {
				return aOrder - bOrder;
			}
			if (aOrder !== undefined) return -1;
			if (bOrder !== undefined) return 1;
			return a.relativePath.localeCompare(b.relativePath);
		});
	}

	private async collectXmlFiles(folderPath: string): Promise<string[]> {
		const entries = await fsPromises.readdir(folderPath, { withFileTypes: true });
		const files: string[] = [];
		for (const entry of entries) {
			const fullPath = path.join(folderPath, entry.name);
			if (entry.isDirectory()) {
				files.push(...await this.collectXmlFiles(fullPath));
			}
			else if (entry.isFile() && entry.name.toLowerCase().endsWith('.xml')) {
				files.push(fullPath);
			}
		}
		return files;
	}

	private async readMapOrder(projectRoot: string): Promise<Map<string, number>> {
		const mapPath = path.join(projectRoot, 'Maps', 'table_of_contents.xml');
		const order = new Map<string, number>();
		try {
			const tocXml = await fsPromises.readFile(mapPath, 'utf8');
			const toc = parseHmxpTocXml(tocXml);
			let index = 0;
			const visit = (nodes: HmxpTocNode[]) => {
				for (const node of nodes) {
					if (!order.has(node.id)) {
						order.set(node.id, index++);
					}
					visit(node.children);
				}
			};
			visit(toc);
		}
		catch {
			// HMXP projects can still be imported without a table of contents map.
		}
		return order;
	}

	private resolveAttachment(
		projectRoot: string,
		topicFilePath: string,
		attachmentSource: string,
		attachmentsFolder: TFolder,
		attachmentOutputs: Map<string, AttachmentOutput>,
		claimedAttachmentPaths: Set<string>,
	): string {
		const sourcePath = this.resolveAttachmentSourcePath(projectRoot, topicFilePath, attachmentSource);
		if (!sourcePath) {
			return attachmentSource;
		}

		const existing = attachmentOutputs.get(sourcePath);
		if (existing) {
			return existing.outputPath;
		}

		const outputPath = this.getAttachmentOutputPath(attachmentsFolder, attachmentSource, claimedAttachmentPaths);
		attachmentOutputs.set(sourcePath, { sourcePath, outputPath });
		return outputPath;
	}

	private resolveAttachmentSourcePath(projectRoot: string, topicFilePath: string, attachmentSource: string): string | null {
		if (/^[a-z][a-z\d+.-]*:/i.test(attachmentSource)) {
			return null;
		}

		const cleanSource = attachmentSource.split(/[?#]/)[0];
		const candidates = [
			path.resolve(path.dirname(topicFilePath), cleanSource),
			path.resolve(projectRoot, cleanSource),
		];

		for (const candidate of candidates) {
			if (this.isPathInside(projectRoot, candidate) && fs.existsSync(candidate)) {
				return candidate;
			}
		}

		return null;
	}

	private getAttachmentOutputPath(attachmentsFolder: TFolder, attachmentSource: string, claimedAttachmentPaths: Set<string>): string {
		const cleanSource = attachmentSource.split(/[?#]/)[0].replace(/\\/g, '/');
		const filename = cleanSource.split('/').filter(Boolean).pop() || 'image';
		const { basename, extension } = parseFilePath(filename);
		const safeBasename = sanitizeFileName(basename);
		const safeExtension = extension ? `.${extension}` : '';
		let outputPath = normalizePath(`${attachmentsFolder.path}/${safeBasename}${safeExtension}`);
		let index = 1;
		while (claimedAttachmentPaths.has(outputPath)) {
			outputPath = normalizePath(`${attachmentsFolder.path}/${safeBasename} ${index}${safeExtension}`);
			index++;
		}
		claimedAttachmentPaths.add(outputPath);
		return outputPath;
	}

	private async writeGeneratedIndexes(projectRoot: string, projectOutputFolder: TFolder, topics: HmxpTopic[]): Promise<void> {
		const keywords = renderHmxpKeywordsMarkdown(topics);
		if (keywords) {
			await this.saveAsMarkdownFile(projectOutputFolder, 'Keywords', keywords);
		}

		const mapPath = path.join(projectRoot, 'Maps', 'table_of_contents.xml');
		try {
			const tocXml = await fsPromises.readFile(mapPath, 'utf8');
			const toc = parseHmxpTocXml(tocXml);
			if (toc.length > 0) {
				await this.saveAsMarkdownFile(projectOutputFolder, 'Table of Contents', renderHmxpTocMarkdown(toc));
			}
		}
		catch {
			// Table of contents maps are optional.
		}
	}

	private async copyAttachments(ctx: ImportContext, attachmentOutputs: Map<string, AttachmentOutput>): Promise<void> {
		for (const attachment of attachmentOutputs.values()) {
			if (ctx.isCancelled()) return;

			try {
				ctx.status(`Copying ${path.basename(attachment.sourcePath)}`);
				const data = await fsPromises.readFile(attachment.sourcePath);
				if (this.vault.getAbstractFileByPath(attachment.outputPath)) {
					ctx.reportSkipped(attachment.outputPath, 'the file already exists.');
					continue;
				}
				await this.vault.createBinary(attachment.outputPath, nodeBufferToArrayBuffer(data));
				ctx.reportAttachmentSuccess(attachment.outputPath);
			}
			catch (error) {
				ctx.reportFailed(attachment.sourcePath, error);
			}
		}
	}

	private isPathInside(rootPath: string, candidatePath: string): boolean {
		const relative = path.relative(rootPath, candidatePath);
		return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
	}
}
