import { FormatImporter } from 'format-importer';
import { ProgressReporter } from 'main';
import { DataWriteOptions, Notice, Setting, TFile, TFolder, htmlToMarkdown } from 'obsidian';
import { parseHTML } from '../util';
import { MicrosoftGraphHelper } from './onenote/graph-helper';
import { OnenotePage, OnenoteSection, Notebook, SectionGroup, User, FileAttachment } from '@microsoft/microsoft-graph-types';

// TODO: This array is used by a few other importers, so it could get moved into format-importer.ts to prevent duplication
const ATTACHMENT_EXTS = ['png', 'webp', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'mpg', 'm4a', 'webm', 'wav', 'ogv', '3gp', 'mov', 'mp4', 'mkv', 'pdf'];

export class OneNoteImporter extends FormatImporter {
	useDefaultAttachmentFolder: boolean = true;
	importIncompatibleAttachments: boolean = false;
	// In the future, enabling this option will only import InkML files.
	// It would be useful for existing OneNote imports or users whose notes are mainly drawings.
	importDrawingsOnly: boolean = false;
	microsoftAccountSetting: Setting;
	contentArea: HTMLDivElement;

	attachmentQueue: FileAttachment[] = [];
	selectedSections: OnenoteSection[] = [];

	graphHelper: MicrosoftGraphHelper = new MicrosoftGraphHelper();

	init() {
		this.addOutputLocationSetting('OneNote');
		this.showUI();
		// Required for the OAuth sign in flow
		this.modal.plugin.registerObsidianProtocolHandler('importer-onenote-signin', (data) => {
			try {
				this.graphHelper.requestAccessToken(data);
			}
			catch (e) {
				this.modal.contentEl.createEl('div', { text: 'An error occurred while trying to sign you in.' })
					.createEl('details', { text: e })
					.createEl('summary', { text: 'Click here to show error details' });
			}
		});
	}

	showUI() {
		new Setting(this.modal.contentEl)
			.setName('Use the default attachment folder')
			.setDesc('If disabled, attachments will be stored in the export folder in the OneNote Attachments folder.')
			.addToggle((toggle) => toggle
				.setValue(true)
				.onChange((value) => (this.useDefaultAttachmentFolder = value))
			);
		new Setting(this.modal.contentEl)
			.setName('Import incompatible attachments')
			.setDesc('Imports incompatible attachments which cannot be embedded in Obsidian, such as .exe files.')
			.addToggle((toggle) => toggle
				.setValue(false)
				.onChange((value) => (this.importIncompatibleAttachments = value))
			);
		this.contentArea = this.modal.contentEl.createEl('div');
		// TODO: Add a setting for importDrawingsOnly when InkML support is complete
		this.microsoftAccountSetting =
		new Setting(this.modal.contentEl)
			.setName('Sign in with your Microsoft Account')
			.setDesc('You need to sign in in order to import your OneNote data.')
			.addButton((button) => button
				.setCta()
				.setButtonText('Sign in')
				.onClick(() => {
					this.graphHelper.openOAuthPage();

					document.addEventListener('graphSignedIn', async () => {
						const userData: User = await this.graphHelper.requestUrl('https://graph.microsoft.com/v1.0/me');
						this.microsoftAccountSetting.setDesc(
							`Signed in as ${userData.displayName} (${userData.mail}). If that's not the correct account, sign in again.`
						);

						await this.showSectionPickerUI();
					});
				})
			);
	}

	async showSectionPickerUI() {
		const sectionsUrl = 'https://graph.microsoft.com/v1.0/me/onenote/notebooks?$expand=sections($select=id,displayName)&$select=id,displayName&$orderby=createdDateTime';
		const notebooks: Notebook[] = (await this.graphHelper.requestUrl(sectionsUrl)).value;

		this.contentArea.createEl('h3', {
			text: 'Choose what to import',
			cls: 'modal-title',
		});

		notebooks.forEach((notebook) => {
			this.contentArea.createEl('h5', {
				text: notebook.displayName!,
				cls: 'modal-title',
			});

			let sections: OnenoteSection[] | undefined | null = notebook?.sections;
			let sectionGroups: SectionGroup[] | undefined | null = notebook?.sectionGroups;

			if (sections) this.createSectionList(sections);

			sectionGroups?.forEach((sectionGroup) => {
				this.contentArea.createEl('h6', {
					text: sectionGroup.displayName!,
				});
				this.createSectionList(sectionGroup.sections!);
			});
		});
	}

	createSectionList(sections: OnenoteSection[]) {
		const list = this.contentArea.createEl('ul');

		sections?.forEach((section) => {
			const listElement = list.createEl('li');
			let label = listElement.createEl('label');
			let checkbox = label.createEl('input');
			checkbox.type = 'checkbox';

			label.appendChild(document.createTextNode(section.displayName!));
			label.createEl('br');

			// Add/remove a section from this.selectedSections
			checkbox.addEventListener('change', () => {
				if (checkbox.checked) this.selectedSections.push(section);
				else {
					const index = this.selectedSections.findIndex((sec) => sec.id === section.id);
					if (index !== -1) {
						this.selectedSections.splice(index, 1);
					}
				}
			});
		});
	}

	async import(progress: ProgressReporter): Promise<void> {
		let outputFolder = await this.getOutputFolder();

		if (!outputFolder) {
			new Notice('Please select a location to export to.');
			return;
		}

		for (let section of this.selectedSections) {
			let sectionFolder: TFolder = await this.createFolders(outputFolder.path + '/' + section.displayName);

			const pagesUrl = `https://graph.microsoft.com/v1.0/me/onenote/sections/${section.id}/pages?$select=id,title,createdDateTime,lastModifiedDateTime`;
			let pages: OnenotePage[] = (await this.graphHelper.requestUrl(pagesUrl)).value;

			pages.forEach(async (page) => {
				try {
					this.processFile(progress,
						sectionFolder,
						await this.graphHelper.requestUrl(`https://graph.microsoft.com/v1.0/me/onenote/pages/${page.id}/content?includeInkML=true`, 'text')
						,page);
				}
				catch (e) {
					progress.reportFailed(page.title!, e.toString());
				}
			});
		}
	}

	async processFile(progress: ProgressReporter, folder: TFolder, content: string, page: OnenotePage) {
		try {
			const splitContent = this.convertFormat(content);

			if (this.importDrawingsOnly) {
				// TODO, when InkML support is added
			}
			else {
				let parsedPage: HTMLElement = this.getAllAttachments(splitContent.html);
				parsedPage = this.styledElementToHTML(parsedPage);
				parsedPage = this.convertTags(parsedPage);
				parsedPage = this.convertInternalLinks(parsedPage);
				parsedPage = this.convertDrawings(parsedPage);

				let mdContent = htmlToMarkdown(parsedPage).trim();
				const fileRef = await this.saveAsMarkdownFile(folder, page.title!, mdContent);

				await this.fetchAttachmentQueue(progress, fileRef);

				// Add the last modified and creation time metadata
				const writeOptions: DataWriteOptions = {
					ctime: Date.parse(page.createdDateTime!.toString()) ||
						Date.parse(page.lastModifiedDateTime!.toString()) ||
						Date.now(),
					mtime: Date.parse(page?.lastModifiedDateTime!.toString()) ||
						Date.parse(page?.createdDateTime!.toString()) ||
						Date.now(),
				};
				await this.vault.append(fileRef, '', writeOptions);
				progress.reportNoteSuccess(page.title!);
			}
		}
		catch (e) {
			progress.reportFailed(page.title!, e);
		}
	}

	// OneNote returns page data and inking data in one file, so we need to split them
	convertFormat(input: string): { html: string; inkml: string } {
		const output = { html: '', inkml: '' };

		// HTML and InkML files are split by a boundary, which is defined in the first line of the input
		const boundary = input.split('\n', 1)[0];

		input.slice(0, -2); // Remove the last 2 characters of the input (as they break the InkML boundary) 
		const parts: string[] = input.split(boundary); // Split the file into 2 parts
		parts.shift(); // Remove the first array item as it's just an empty string

		if (parts?.length === 2) {
			for (let part of parts) {
				let contentTypeLine = part.split('\n').find((line) => line.includes('Content-Type'));
				let contentType = contentTypeLine!
					.split(';')[0]
					.split(':')[1]
					.trim();

				// Extract the value from the part by removing the first two lines
				let value = part.split('\n').slice(2).join('\n').trim();					

				if (contentType === 'text/html') output.html = value;
				else if (contentType === 'application/inkml+xml') output.inkml = value;
			}
		}
		else {
			throw new Error('The input string is incorrect and may be missing data. Inputted string: ' + input);
		}
		console.log(output.html);
		return output;
	}

	convertTags(pageElement: HTMLElement): HTMLElement {
		const tagElements = pageElement.querySelectorAll('[data-tag]');

		tagElements.forEach((element) => {
			// If a to-do tag, then convert it into a Markdown task list
			if (element.getAttribute('data-tag')?.contains('to-do')) {
				const isChecked = element.getAttribute('data-tag') === 'to-do:completed';
				const check = isChecked ? '[x]' : '[ ]';
				// We need to use innerHTML in case an image was marked as TODO
				element.innerHTML = `- ${check} ${element.innerHTML}`;
			}
			// All other OneNote tags are already in the Obsidian tag format ;)
			else {
				const tags = element.getAttribute('data-tag')?.split(',');
				tags?.forEach((tag) => {
					element.innerHTML = element.innerHTML + ` #${tag.replace(':', '-')} `;
				});
			}
		});
		return pageElement;
	}

	// TODO: Dirty working hack, but do this the correct way using this.app.fileManager.generateMarkdownLink
	convertInternalLinks(pageElement: HTMLElement): HTMLElement {
		const links: HTMLElement[] = pageElement.findAll('a');

		links.forEach((link: HTMLAnchorElement) => {
			if (link.href.startsWith('onenote:')) {
				const startIdx = link.href.indexOf('#') + 1;
				const endIdx = link.href.indexOf('&', startIdx);
				link.href = link.href.slice(startIdx, endIdx);
			}
		});
		return pageElement;
	}

	// This function gets all attachments and adds them to the queue, as well as adds embedding syntax for supported file formats
	getAllAttachments(pageHTML: string): HTMLElement {
		// The OneNote API has a weird bug when you export with InkML - it doesn't close <object> tags properly,
		// so we need to close them using regex
		const regex = /<object([^>]*)\/>/g;
		const pageElement = parseHTML(pageHTML.replace(regex, '<object$1></object>'));

		const objects: HTMLElement[] = pageElement.findAll('object');
		const images: HTMLImageElement[] = pageElement.findAll('img') as HTMLImageElement[];
		// Online videos are implemented as iframes, normal videos are just <object>s
		const videos: HTMLIFrameElement[] = pageElement.findAll('iframe') as HTMLIFrameElement[];

		objects.forEach(async (object) => {
			let split: string[] = object.getAttribute('data-attachment')!.split('.');
			const extension: string = split[split.length - 1];

			// If the page contains an incompatible file and user doesn't want to import them, skip
			if (!ATTACHMENT_EXTS.contains(extension) && !this.importIncompatibleAttachments) {
				return;
			}
			else {
				this.attachmentQueue.push({
					name: object.getAttribute('data-attachment')!,
					contentLocation: object.getAttribute('data')!,
				});
		
				// Create a new <p> element with the Markdown-style link
				const markdownLink = document.createElement('p');
				markdownLink.innerText = `![[${object.getAttribute('data-attachment')}]]`;
		
				// Replace the <object> tag with the new <p> element
				object.parentNode?.replaceChild(markdownLink, object);
			}
		});

		images.forEach(async (image) => {
			let split: string[] = image.getAttribute('data-fullres-src-type')!.split('/');
			const extension: string = split[1];
			// TODO: there may be a similar function in the Obsidian API but I couldn't find it
			const currentDate = (new Date).toISOString().replace(/[-:.TZ]/g, '').substring(0, 14);
			const fileName: string = `Exported image ${currentDate}.${extension}`;

			this.attachmentQueue.push({
				name: fileName,
				contentLocation: image.getAttribute('data-fullres-src')!,
			});

			image.src = encodeURIComponent(fileName);
			if(!image.alt) image.alt = 'Exported image';
		});

		videos.forEach(async (video) => {
			// Obsidian only supports embedding YouTube videos, unlike OneNote
			if(video.src.contains('youtube.com') || video.src.contains('youtu.be')) {
				const embedNode = document.createTextNode(`![Embedded YouTube video](${video.src})`);
				video.parentNode?.replaceChild(embedNode, video);
			}
			else {
				// If it's any other website, convert to a basic link
				const linkNode = document.createElement('a');
				linkNode.href = video.src;
				video.parentNode?.replaceChild(linkNode, video);
			}
		});
		return pageElement;
	}

	// Downloads attachments from the attachmentQueue once the file has been created.
	async fetchAttachmentQueue(progress: ProgressReporter, currentFile: TFile) {
		if (this.attachmentQueue.length >= 1) {
			let attachmentPath: string = (await this.getOutputFolder())!.path + '/OneNote Attachments';

			// @ts-ignore
			// Bug: This function always returns the path + "Note name.md" rather than just the path for some reason
			if (this.useDefaultAttachmentFolder) attachmentPath = await this.app.vault.getAvailablePathForAttachments(currentFile.basename, currentFile.extension, currentFile);
	
			// Create the attachment folder if it doesn't exist yet
			try {
				this.vault.createFolder(attachmentPath);
			}
			catch (e) { }
	
			this.attachmentQueue.forEach(async attachment => {
				try {
					const data = (await this.graphHelper.requestUrl(attachment.contentLocation!, 'file')) as ArrayBuffer;
					await this.app.vault.createBinary(attachmentPath + '/' + attachment.name, data);
		
					progress.reportAttachmentSuccess(attachment.name!);	
				}
				catch (e) {
					progress.reportFailed(attachment.name!, e);
				}
			});
	
			// Clear the attachment queue after every note
			this.attachmentQueue = [];		
		}
		else { }
	}
	
	// Convert OneNote styled elements to valid HTML for proper htmlToMarkdown conversion
	styledElementToHTML(pageElement: HTMLElement): HTMLElement {
		const styledElements = pageElement.querySelectorAll('[style]');
		
		// For some reason cites/quotes are not converted into Markdown (possible htmlToMarkdown bug), so we do it ourselves temporarily
		const cites = pageElement.findAll('cite');
		cites.forEach((cite) => cite.innerHTML = '> ' + cite.innerHTML + '<br>');

		// Map styles to their elements
		const styleMap: { [key: string]: string } = {
			'font-weight:bold': 'b',
			'font-style:italic': 'i',
			'text-decoration:underline': 'u',
			'text-decoration:line-through': 's',
			'background-color': 'mark',
			'font-family:Consolas': 'pre',
		};

		styledElements.forEach(element => {
			const style = element.getAttribute('style') || '';
			const matchingStyle = Object.keys(styleMap).find(key => style.includes(key));
	
			if (matchingStyle) {
				const newElementTag = styleMap[matchingStyle];
				const newElement = document.createElement(newElementTag);

				if (newElementTag === 'pre') {
					const code = newElement.createEl('code');
					code.textContent = element.textContent;
				}

				else newElement.innerHTML = element.innerHTML;
				element.replaceWith(newElement);
			}
		});

		return pageElement;
	}
	
	/* Commented out for possible future use. As of now, it seems like it's htmlToMarkdown's fault rather than OneNote's
		fixTables(pageElement: HTMLElement): HTMLElement {
			const tables = pageElement.querySelectorAll('table');
	
			tables.forEach(table => {
				if (table.rows.length > 1) table.deleteRow(0); 
			});
			
			return pageElement;
		}
	*/

	convertDrawings(element: HTMLElement, currentFile: TFile | undefined = undefined): HTMLElement {
		// TODO: Convert using InkML, this is a temporary notice for users to know drawings were skipped
		const walker = document.createTreeWalker(element, NodeFilter.SHOW_COMMENT, null);
		let hasDrawings: boolean = false;

		while (walker.nextNode()) {
		  const commentNode = walker.currentNode as Comment;
		  if (commentNode.nodeValue?.trim() === 'InkNode is not supported') hasDrawings = true;
		}

		if (hasDrawings) {
			const textNode = document.createTextNode('> [!caution] This page contained a drawing which was not converted.');
			// Insert the notice at the top of the page
			element.insertBefore(textNode, element.firstChild);	
		}
		else {
			for (let i = 0; i < element.children.length; i++) {
				const child = element.children[i];
				if (child instanceof HTMLElement) {
					this.convertDrawings(child);
				}
			}
		}
		return element;
	}
}