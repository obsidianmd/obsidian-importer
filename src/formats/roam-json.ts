import { ImportContext } from '../import-context';
import { normalizePath, Notice, requestUrl } from 'obsidian';
import { parseFilePath } from '../filesystem';
import { FormatImporter, NoteTemplateSample, TEMPLATE_PREVIEW_LIMIT } from '../format-importer';
import { i18n } from '../i18n';
import { sanitizeFileName } from '../util';
import { RoamPage } from './roam/models/roam-json';
import { RoamGraphConverter } from './roam/graph';
import { roamDefaults } from './roam/convert';
import { createBaseFile } from '../base';

const regex = /{{pdf:|{{\[\[pdf|{{\[\[audio|{{audio:|{{video:|{{\[\[video/;
const imageRegex = /https:\/\/firebasestorage(.*?)\?alt(.*?)\)/;
const binaryRegex = /https:\/\/firebasestorage(.*?)\?alt(.*?)/;


export class RoamJSONImporter extends FormatImporter {
	static extensions = ['json'];

	interruption = 'pause' as const;

	progress: ImportContext;
	userDNPFormat: string;


	deOutline: boolean = roamDefaults.deOutline;
	embedBlockReferences: boolean = roamDefaults.embedBlockReferences;
	dropUnresolvedReferences: boolean = roamDefaults.dropUnresolvedReferences;
	keepAttributesInOutline: boolean = roamDefaults.keepAttributesInOutline;
	dropQueries: boolean = roamDefaults.dropQueries;
	tagsAsLinks: boolean = roamDefaults.tagsAsLinks;

	get convertAttributesToProperties(): boolean {
		return !this.keepAttributesInOutline;
	}

	set convertAttributesToProperties(value: boolean) {
		this.keepAttributesInOutline = !value;
	}

	init() {
		this.addInstructions(this.addExportSetting(i18n.importer.roamJson.descExport()));

		this.addFileChooserSetting(i18n.importer.roamJson.fileType(), RoamJSONImporter.extensions, false,
			i18n.importer.roamJson.descFiles());
		this.defaultOutputFolder = 'Roam';
		this.idProperty = 'roam-uid';
		this.idLabel = i18n.importer.roamJson.labelId();
		this.userDNPFormat = this.getUserDNPFormat();

		this.addSetting('template')
			?.setName(i18n.outliner.nameFlattenOutlines())
			.setDesc(i18n.outliner.descFlattenOutlines())
			.addToggle(toggle => toggle
				.setValue(this.deOutline)
				.onChange(value => {
					this.deOutline = value;
					this.templateSettingsChanged();
				}));

		this.startGroup();

		this.addSetting()
			?.setName(i18n.importer.roamJson.nameEmbedBlockReferences())
			.setDesc(i18n.importer.roamJson.descEmbedBlockReferences())
			.addToggle(toggle => toggle
				.setValue(this.embedBlockReferences)
				.onChange(value => this.embedBlockReferences = value));

		this.addSetting()
			?.setName(i18n.importer.roamJson.nameDropUnresolvedReferences())
			.setDesc(i18n.importer.roamJson.descDropUnresolvedReferences())
			.addToggle(toggle => toggle
				.setValue(this.dropUnresolvedReferences)
				.onChange(value => this.dropUnresolvedReferences = value));

		this.startGroup();

		this.addSetting('template')
			?.setName(i18n.importer.roamJson.nameConvertAttributes())
			.setDesc(i18n.importer.roamJson.descConvertAttributes())
			.addToggle(toggle => toggle
				.setValue(this.convertAttributesToProperties)
				.onChange(value => {
					this.convertAttributesToProperties = value;
					this.templateSettingsChanged();
				}));

		this.addSetting()
			?.setName(i18n.importer.roamJson.nameTagsAsLinks())
			.setDesc(i18n.importer.roamJson.descTagsAsLinks())
			.addToggle(toggle => toggle
				.setValue(this.tagsAsLinks)
				.onChange(value => this.tagsAsLinks = value));

		this.addSetting()
			?.setName(i18n.importer.roamJson.nameDropQueries())
			.setDesc(i18n.importer.roamJson.descDropQueries())
			.addToggle(toggle => toggle
				.setValue(this.dropQueries)
				.onChange(value => this.dropQueries = value));
	}

	protected override async templatePreviewSamples(ctx: ImportContext): Promise<NoteTemplateSample[]> {
		const samples: NoteTemplateSample[] = [];
		for (const file of this.files) {
			if (samples.length >= TEMPLATE_PREVIEW_LIMIT || await ctx.shouldStop()) break;
			try {
				const pages = JSON.parse(await file.readText()) as RoamPage[];
				const graphName = sanitizeFileName(file.basename);
				const graphFolder = normalizePath(`${this.outputLocation}/${graphName}`);
				const converter = new RoamGraphConverter({
					graphFolder,
					userDNPFormat: this.userDNPFormat,
					deOutline: this.deOutline,
					embedBlockReferences: this.embedBlockReferences,
					dropUnresolvedReferences: this.dropUnresolvedReferences,
					keepAttributesInOutline: this.keepAttributesInOutline,
					dropQueries: this.dropQueries,
					tagsAsLinks: this.tagsAsLinks,
					emptyTitleReason: i18n.importer.roamJson.reasonEmptyTitle(),
					// Keep unresolved attachment links in the preview without writing files.
				});
				const remaining = TEMPLATE_PREVIEW_LIMIT - samples.length;
				const converted = await converter.convert(pages.slice(0, remaining));
				for (const [path, content] of converted.pages) {
					if (samples.length >= TEMPLATE_PREVIEW_LIMIT) break;
					samples.push({
						title: parseFilePath(path).basename,
						path,
						content,
						sourceId: converted.uids.get(path),
					});
				}
			}
			catch (error) {
				console.warn(`Could not preview Roam graph ${file.fullpath}`, error);
			}
		}
		return samples;
	}

	async import(progress: ImportContext) {
		this.progress = progress;
		let { files } = this;
		if (files.length === 0) {
			new Notice(i18n.common.msgPickFile());
			return;
		}

		let outputFolder = await this.getOutputFolder();
		if (!outputFolder) {
			new Notice(i18n.common.msgPickOutput());
			return;
		}

		for (let file of files) {
			if (await progress.shouldStop()) {
				return;
			}

			const graphName = sanitizeFileName(file.basename);
			const graphFolder = normalizePath(`${outputFolder.path}/${graphName}`);

			await this.createFolders(graphFolder);

			const data = await file.readText();
			const allPages = JSON.parse(data) as RoamPage[];

			const { pages: markdownPages, uids: pageUids, attributeNames } = await this.newGraphConverter(graphFolder, progress).convert(allPages);

			const totalCount = markdownPages.size;
			let index = 1;
			for (const [filename, markdownOutput] of markdownPages.entries()) {
				if (await progress.shouldStop()) {
					return;
				}

				try {
					const { parent, name } = parseFilePath(filename);
					const folder = await this.createFolders(parent);

					const { written } = await this.writeNote(progress, folder, name, markdownOutput, { sourceId: pageUids.get(filename) });
					if (written) progress.reportNoteSuccess(filename);
					progress.reportProgress(index, totalCount);
				}
				catch (error) {
					console.error('Error saving Markdown to file:', filename, error);
					progress.reportFailed(filename);
				}

				index++;
			}

			await this.writeGraphBase(graphFolder, graphName, attributeNames);
		}
	}

	private async writeGraphBase(graphFolder: string, graphName: string, attributeNames: string[]): Promise<void> {
		if (attributeNames.length === 0) return;

		try {
			const { parent } = parseFilePath(graphFolder);
			const folder = await this.createFolders(parent || '/');

			await createBaseFile(folder, graphName, {
				filters: `file.folder == "${graphFolder}"`,
				views: [{
					type: 'table',
					name: 'Table',
					order: ['file.name', ...attributeNames],
				}],
			}, this.vault);
		}
		catch (error) {
			console.error('Failed to create Base file:', error);
		}
	}

	private getUserDNPFormat(): string {
		const options = this.dailyNotesOptions();
		if (!options) {
			console.warn('Daily note plugin is not enabled. Roam import defaulting to "YYYY-MM-DD" format.');
			return 'YYYY-MM-DD';
		}

		return options.format || 'YYYY-MM-DD';
	}

	private newGraphConverter(graphFolder: string, progress: ImportContext): RoamGraphConverter {
		return new RoamGraphConverter({
			graphFolder,
			userDNPFormat: this.userDNPFormat,
			deOutline: this.deOutline,
			embedBlockReferences: this.embedBlockReferences,
			dropUnresolvedReferences: this.dropUnresolvedReferences,
			keepAttributesInOutline: this.keepAttributesInOutline,
			dropQueries: this.dropQueries,
			tagsAsLinks: this.tagsAsLinks,
			downloadFirebaseFile: (blockText, folder) => this.downloadFirebaseFile(blockText, folder),
			prepareNote: async filename => void await this.createFolders(parseFilePath(filename).parent),
			reportFailed: (id, reason) => progress.reportFailed(id, reason),
			emptyTitleReason: i18n.importer.roamJson.reasonEmptyTitle(),
		});
	}

	private async downloadFirebaseFile(line: string, sourcePath: string): Promise<string> {
		const { progress, vault } = this;

		let url = '';
		try {
			let link: RegExpMatchArray | null;
			let syntaxLink: RegExpMatchArray | null;
			if (regex.test(line)) {
				link = line.match(/https:\/\/firebasestorage(.*?)\?alt(.*?)\}/);
				syntaxLink = line.match(/{{.*https:\/\/firebasestorage.*?alt=media&.*?(?=\s|$)/);

			}
			else if (imageRegex.test(line)) {
				link = line.match(imageRegex);
				syntaxLink = line.match(/!\[.*https:\/\/firebasestorage.*?alt=media&.*?(?=\s|$)/);
			}
			else {
				link = line.match(binaryRegex);
				syntaxLink = line.match(/https:\/\/firebasestorage.*?alt=media&.*?(?=\s|$)/);
			}

			if (link && syntaxLink) {
				const firebaseShort = 'https://firebasestorage' + link[1];

				let filename = decodeURIComponent(firebaseShort.split('/').last() || '');
				if (!filename) {
					const timestamp = Math.floor(Date.now() / 1000);
					const extMatch = firebaseShort.slice(-5).match(/(.*?)\.(.+)/);
					if (!extMatch) {
						progress.reportSkipped(link[1], i18n.importer.roamJson.reasonUnexpectedExtension());
						return line;
					}

					filename = `${timestamp}.${extMatch[2]}`;
				}

				// Roam names an upload with a token of its own, unique to that
				// file, so a copy already under the name is the same attachment
				// from an earlier import rather than another one.
				const { path, reuse } = await this.placeAttachment(filename, sourcePath, () => 'same');

				if (!reuse) {
					url = link[0].slice(0, -1);
					const data = (await requestUrl(url)).arrayBuffer;

					await vault.createBinary(path, data);
					progress.reportAttachmentSuccess(url);
				}

				// Linked either way: a second import used to leave the raw Roam
				// markup where the first had written the embed.
				return line.replace(syntaxLink[0], `![[${path}]]`);

			}
		}
		catch (error) {
			console.error(error);
			progress.reportFailed(url, error);
		}

		return line;
	}
}
