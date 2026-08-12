import { ImportContext } from '../import-context';
import { normalizePath, Notice, requestUrl } from 'obsidian';
import { parseFilePath } from '../filesystem';
import { FormatImporter } from '../format-importer';
import { i18n } from '../i18n';
import { helpUrl } from '../constants';
import { sanitizeFileName } from '../util';
import { RoamPage } from './roam/models/roam-json';
import { RoamGraphConverter } from './roam/graph';
import { createBaseFile } from '../base';

const regex = /{{pdf:|{{\[\[pdf|{{\[\[audio|{{audio:|{{video:|{{\[\[video/;
const imageRegex = /https:\/\/firebasestorage(.*?)\?alt(.*?)\)/;
const binaryRegex = /https:\/\/firebasestorage(.*?)\?alt(.*?)/;

const HELP_PERMALINK = 'import/roam';

/** As much of Obsidian's internal plugin registry as the daily-note format needs. */
interface InternalPlugins {
	getPluginById(id: string): { instance?: { options?: { format?: string } } } | null;
}

export class RoamJSONImporter extends FormatImporter {
	static extensions = ['json'];

	interruption = 'pause' as const;

	downloadAttachments: boolean = false;
	progress: ImportContext;
	userDNPFormat: string;

	// YAML options
	fileDateYAML: boolean = false;
	titleYAML: boolean = false;

	// Shape and markup options
	deOutline: boolean = false;
	embedBlockReferences: boolean = false;
	dropUnresolvedReferences: boolean = false;
	keepAttributesInOutline: boolean = false;
	dropQueries: boolean = false;

	init() {
		this.addSetting('source')
			?.setName(i18n.common.nameExport())
			.setDesc(i18n.importer.roamJson.descExport())
			.addButton(button => button
				.setButtonText(i18n.common.buttonInstructions())
				.onClick(() => window.open(helpUrl(HELP_PERMALINK))));

		this.addFileChooserSetting(i18n.importer.roamJson.fileType(), RoamJSONImporter.extensions, false,
			i18n.importer.roamJson.descFiles());
		this.defaultOutputFolder = 'Roam';
		this.idProperty = 'roam-uid';
		this.idLabel = i18n.importer.roamJson.labelId();
		this.userDNPFormat = this.getUserDNPFormat();

		this.addSetting()
			?.setName(i18n.importer.roamJson.nameDownloadAttachments())
			.setDesc(i18n.importer.roamJson.descDownloadAttachments())
			.addToggle(toggle => {
				toggle.setValue(this.downloadAttachments);
				toggle.onChange(async (value) => {
					this.downloadAttachments = value;
				});
			});

		this.addSetting()
			?.setName(i18n.importer.roamJson.nameDateProperties())
			.setDesc(i18n.importer.roamJson.descDateProperties())
			.addToggle(toggle => {
				toggle.setValue(this.fileDateYAML);
				toggle.onChange(async (value) => {
					this.fileDateYAML = value;
				});
			});

		this.addSetting()
			?.setName(i18n.importer.roamJson.nameTitleProperty())
			.setDesc(i18n.importer.roamJson.descTitleProperty())
			.addToggle(toggle => {
				toggle.setValue(this.titleYAML);
				toggle.onChange(async (value) => {
					this.titleYAML = value;
				});
			});

		this.addSetting()
			?.setName(i18n.importer.roamJson.nameDeOutline())
			.setDesc(i18n.importer.roamJson.descDeOutline())
			.addToggle(toggle => toggle
				.setValue(this.deOutline)
				.onChange(value => this.deOutline = value));

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

		this.addSetting()
			?.setName(i18n.importer.roamJson.nameKeepAttributes())
			.setDesc(i18n.importer.roamJson.descKeepAttributes())
			.addToggle(toggle => toggle
				.setValue(this.keepAttributesInOutline)
				.onChange(value => this.keepAttributesInOutline = value));

		this.addSetting()
			?.setName(i18n.importer.roamJson.nameDropQueries())
			.setDesc(i18n.importer.roamJson.descDropQueries())
			.addToggle(toggle => toggle
				.setValue(this.dropQueries)
				.onChange(value => this.dropQueries = value));
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
			// The top of a vault has the path `/`, so joining it to the graph
			// name leaves a slash belonging to nothing at the front of every
			// link the graph goes on to generate (#276).
			const graphFolder = normalizePath(`${outputFolder.path}/${graphName}`);

			// create the base graph folders
			await this.createFolders(graphFolder);

			// read the graph
			const data = await file.readText();
			const allPages = JSON.parse(data) as RoamPage[];

			const { pages: markdownPages, uids: pageUids, attributeNames } = await this.newGraphConverter(graphFolder, progress).convert(allPages);

			// WRITE-PROCESS: create the actual pages //
			const totalCount = markdownPages.size;
			let index = 1;
			for (const [filename, markdownOutput] of markdownPages.entries()) {
				if (await progress.shouldStop()) {
					return;
				}

				try {
					//create folders for nested pages [[some/nested/subfolder/page]]
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

	/**
	 * A Base over the graph, showing every page by the attributes it carries.
	 *
	 * Roam's own `{{attr-table}}` is what this stands in for: attributes are the
	 * database-shaped part of a graph, and now that they arrive as properties a
	 * table view is what reads them (#180).
	 *
	 * A graph using no attributes gets no Base - an empty table over a thousand
	 * notes is not worth the file.
	 */
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
			// A graph that imported is worth keeping even when its Base will not.
			console.error('Failed to create Base file:', error);
		}
	}

	private getUserDNPFormat(): string {
		// Obsidian does not type its internal plugins, so what is read of the
		// daily-notes one is described here rather than reached for untyped.
		const app = this.app as { internalPlugins?: InternalPlugins };
		const dailyNotePluginInstance = app.internalPlugins?.getPluginById('daily-notes')?.instance;
		if (!dailyNotePluginInstance) {
			console.warn('Daily note plugin is not enabled. Roam import defaulting to "YYYY-MM-DD" format.');
			return 'YYYY-MM-DD';
		}

		return dailyNotePluginInstance.options?.format || 'YYYY-MM-DD';
	}

	private newGraphConverter(graphFolder: string, progress: ImportContext): RoamGraphConverter {
		return new RoamGraphConverter({
			graphFolder,
			userDNPFormat: this.userDNPFormat,
			fileDateYAML: this.fileDateYAML,
			titleYAML: this.titleYAML,
			downloadAttachments: this.downloadAttachments,
			deOutline: this.deOutline,
			embedBlockReferences: this.embedBlockReferences,
			dropUnresolvedReferences: this.dropUnresolvedReferences,
			keepAttributesInOutline: this.keepAttributesInOutline,
			dropQueries: this.dropQueries,
			downloadFirebaseFile: (blockText, folder) => this.downloadFirebaseFile(blockText, folder),
			// The attachment resolver needs the note's real parent for `.` and
			// `./subfolder` settings, including Roam titles that create folders.
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
				// I expect this to be a bare link which is typically a binary file
				link = line.match(binaryRegex);
				syntaxLink = line.match(/https:\/\/firebasestorage.*?alt=media&.*?(?=\s|$)/);
			}

			if (link && syntaxLink) {
				const firebaseShort = 'https://firebasestorage' + link[1];

				let filename = decodeURIComponent(firebaseShort.split('/').last() || '');
				if (!filename) {
					// If we can't find the filename, then generate one with a timestamp and the original extension.
					const timestamp = Math.floor(Date.now() / 1000);
					const extMatch = firebaseShort.slice(-5).match(/(.*?)\.(.+)/);
					if (!extMatch) {
						progress.reportSkipped(link[1], i18n.importer.roamJson.reasonUnexpectedExtension());
						return line;
					}

					filename = `${timestamp}.${extMatch[2]}`;
				}

				const newFilePath = await this.getAvailablePathForAttachment(filename, [], sourcePath);

				const existingFile = vault.getAbstractFileByPath(newFilePath);
				if (existingFile) {
					progress.reportSkipped(link[1], i18n.importer.roamJson.reasonFileExists());
					return line;
				}

				url = link[0].slice(0, -1);
				const data = (await requestUrl(url)).arrayBuffer;

				await vault.createBinary(newFilePath, data);

				progress.reportAttachmentSuccess(url);

				// const newLine = line.replace(link.input, newFilePath)
				return line.replace(syntaxLink[0], `![[${newFilePath}]]`);

			}
		}
		catch (error) {
			console.error(error);
			progress.reportFailed(url, error);
		}

		return line;
	}
}
