import { DataWriteOptions, Notice, Setting, TFile, TFolder, htmlToMarkdown, ObsidianProtocolData, requestUrl, moment } from 'obsidian';
import { genUid, parseHTML } from '../util';
import { FormatImporter } from '../format-importer';
import { AUTH_REDIRECT_URI, ImportContext } from '../main';
import { AccessTokenResponse } from './onenote/models';
import { OnenotePage, OnenoteSection, Notebook, SectionGroup, User, FileAttachment } from '@microsoft/microsoft-graph-types';

const GRAPH_CLIENT_ID: string = '66553851-08fa-44f2-8bb1-1436f121a73d';
const GRAPH_SCOPES: string[] = ['user.read', 'notes.read'];
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
	graphData = {
		state: genUid(32),
		accessToken: '',
	};

	init() {
		this.addOutputLocationSetting('OneNote');

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
		// TODO: Add a setting for importDrawingsOnly when InkML support is complete
		this.microsoftAccountSetting =
			new Setting(this.modal.contentEl)
				.setName('Sign in with your Microsoft account')
				.setDesc('You need to sign in to import your OneNote data.')
				.addButton((button) => button
					.setCta()
					.setButtonText('Sign in')
					.onClick(() => {
						this.registerAuthCallback(this.authenticateUser.bind(this));

						const requestBody = new URLSearchParams({
							client_id: GRAPH_CLIENT_ID,
							scope: GRAPH_SCOPES.join(' '),
							response_type: 'code',
							redirect_uri: AUTH_REDIRECT_URI,
							response_mode: 'query',
							state: this.graphData.state,
						});
						window.open(`https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${requestBody.toString()}`);
					})
				);
		this.contentArea = this.modal.contentEl.createEl('div');
	}

	async authenticateUser(protocolData: ObsidianProtocolData) {
		try {
			if (protocolData['state'] !== this.graphData.state) {
				throw new Error(`An incorrect state was returned.\nExpected state: ${this.graphData.state}\nReturned state: ${protocolData['state']}`);
			}

			const requestBody = new URLSearchParams({
				client_id: GRAPH_CLIENT_ID,
				scope: GRAPH_SCOPES.join(' '),
				code: protocolData['code'],
				redirect_uri: AUTH_REDIRECT_URI,
				grant_type: 'authorization_code',
			});

			const tokenResponse: AccessTokenResponse = await requestUrl({
				method: 'POST',
				url: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
				contentType: 'application/x-www-form-urlencoded',
				body: requestBody.toString(),
			}).json;

			if (!tokenResponse.access_token) {
				throw new Error(`Unexpected data was returned instead of an access token. Error details: ${tokenResponse}`);
			}

			this.graphData.accessToken = tokenResponse.access_token;
			const userData: User = await this.fetchResource('https://graph.microsoft.com/v1.0/me', 'json');
			this.microsoftAccountSetting.setDesc(
				`Signed in as ${userData.displayName} (${userData.mail}). If that's not the correct account, sign in again.`
			);

			// Async
			this.showSectionPickerUI();
		}
		catch (e) {
			console.error('An error occurred while we were trying to sign you in. Error details: ', e);
			this.modal.contentEl.createEl('div', { text: 'An error occurred while trying to sign you in.' })
				.createEl('details', { text: e })
				.createEl('summary', { text: 'Click here to show error details' });
		}
	}

	async showSectionPickerUI() {
		const baseUrl = 'https://graph.microsoft.com/v1.0/me/onenote/notebooks';

		const params = new URLSearchParams({
		  $expand: 'sections($select=id,displayName),sectionGroups($expand=sections)',
		  $select: 'id,displayName',
		  $orderby: 'createdDateTime'
		});
		
		const sectionsUrl = `${baseUrl}?${params.toString()}`;
		const notebooks: Notebook[] = (await this.fetchResource(sectionsUrl, 'json')).value;

		// Make sure the element is empty, in case the user signs in twice
		this.contentArea.empty();

		this.contentArea.createEl('h4', {
			text: 'Choose data to import',
		});

		for (const notebook of notebooks) {
			let sections: OnenoteSection[] = notebook.sections || [];
			let sectionGroups: SectionGroup[] = notebook.sectionGroups || [];

			let notebookDiv = this.contentArea.createDiv();

			new Setting(notebookDiv)
				.setName(notebook.displayName!)
				.setDesc(`Last edited on: ${(moment.utc(notebook.createdDateTime)).format('Do MMMM YYYY')}. Contains ${notebook.sections?.length} sections.`)
				.addButton((button) => button
					.setCta()
					.setButtonText('Select all')
					.onClick(() => {
						notebookDiv.querySelectorAll('input[type="checkbox"]').forEach((el: HTMLInputElement) => el.checked = true);
						this.selectedSections.push(...notebook.sections!);
						this.selectedSections.push(...(notebook.sectionGroups || []).flatMap(element => element?.sections || []));
					}));

			if (sections) this.createSectionList(sections, notebookDiv);

			for (const sectionGroup of sectionGroups || []) {
				let sectionDiv = notebookDiv.createDiv();

				sectionDiv.createEl('strong', {
					text: sectionGroup.displayName!,
				});

				// Set the parent section group for neater folder structuring
				sectionGroup.sections?.forEach(section => section.parentSectionGroup = sectionGroup);
				this.createSectionList(sectionGroup.sections!, sectionDiv);
			}
		}
	}

	createSectionList(sections: OnenoteSection[], parentEl: HTMLDivElement) {
		const list = parentEl.createEl('ul', {
			attr: {
				style: 'padding-inline-start: 1em;',
			},
		});
		for (const section of sections) {
			const listElement = list.createEl('li', {
				cls: 'task-list-item',
			});
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
		}
	}

	async import(progress: ImportContext): Promise<void> {
		// Remove possible duplicates, eg. when the user selects "Select all" with existing selections.
		this.selectedSections = this.selectedSections.filter((item, index, array) => array.indexOf(item) === index);

		let outputFolder = await this.getOutputFolder();
		let remainingSections = this.selectedSections.length;

		if (!outputFolder) {
			new Notice('Please select a location to export to.');
			return;
		}

		progress.status('Starting OneNote import');

		for (let section of this.selectedSections) {
			progress.reportProgress(0, remainingSections);
			remainingSections--;

			let pageCount: number = 0;

			let sectionFolder: TFolder;
			if (section.parentSectionGroup) {
				let sectionGroupFolder: TFolder = await this.createFolders(outputFolder.path + '/' + section.parentSectionGroup.displayName);
				sectionFolder = await this.createFolders(sectionGroupFolder.path + '/' + section.displayName);
			}
			else sectionFolder = await this.createFolders(outputFolder.path + '/' + section.displayName);

			const pagesUrl = `https://graph.microsoft.com/v1.0/me/onenote/sections/${section.id}/pages?$select=id,title,createdDateTime,lastModifiedDateTime`;
			let pages: OnenotePage[] = (await this.fetchResource(pagesUrl, 'json')).value;

			progress.reportProgress(0, pages.length);

			for (let i = 0; i < pages.length; i++) {
				const page = pages[i];

				try {
					pageCount++;
					progress.status(`Importing note ${page.title || 'Untitled'}`);

					// Every 50 items, do a few second break to prevent rate limiting
					if (i !== 0 && i % 50 === 0) {
						await new Promise(resolve => setTimeout(resolve, 5000));
					}
					this.processFile(progress,
						sectionFolder,
						outputFolder,
						await this.fetchResource(`https://graph.microsoft.com/v1.0/me/onenote/pages/${page.id}/content?includeInkML=true`, 'text')
						, page);

					progress.reportProgress(pageCount, pages.length);

				}
				catch (e) {
					progress.reportFailed(page.title || 'Untitled note', e.toString());
				}
			}
		}
	}

	async processFile(progress: ImportContext, sectionFolder: TFolder, outputFolder: TFolder, content: string, page: OnenotePage) {
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
				const fileRef = await this.saveAsMarkdownFile(sectionFolder, page.title!, mdContent);

				await this.fetchAttachmentQueue(progress, fileRef, outputFolder);

				// Add the last modified and creation time metadata
				const writeOptions: DataWriteOptions = {
					ctime: page?.lastModifiedDateTime ? Date.parse(page.lastModifiedDateTime.toString()) :
						page?.createdDateTime ? Date.parse(page.createdDateTime.toString()) :
							Date.now(),
					mtime: page?.lastModifiedDateTime ? Date.parse(page.lastModifiedDateTime.toString()) :
						page?.createdDateTime ? Date.parse(page.createdDateTime.toString()) :
							Date.now(),
				};
				await this.vault.append(fileRef, '', writeOptions);
				progress.reportNoteSuccess(page.title!);
			}
		}
		catch (e) {
			progress.reportFailed(page.title || 'Untitled note', e);
		}
	}

	// OneNote returns page data and inking data in one file, so we need to split them
	convertFormat(input: string): { html: string, inkml: string } {
		const output = { html: '', inkml: '' };

		// HTML and InkML files are split by a boundary, which is defined in the first line of the input
		const boundary = input.split('\n', 1)[0];

		input.slice(0, -2); // Remove the last 2 characters of the input (as they break the InkML boundary) 
		const parts: string[] = input.split(boundary); // Split the file into 2 parts
		parts.shift(); // Remove the first array item as it's just an empty string

		if (parts.length === 2) {
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

		return output;
	}

	convertTags(pageElement: HTMLElement): HTMLElement {
		const tagElements = Array.from(pageElement.querySelectorAll('[data-tag]'));

		for (const element of tagElements) {
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
		}
		return pageElement;
	}

	// TODO: Dirty working hack, but do this the correct way using this.app.fileManager.generateMarkdownLink
	convertInternalLinks(pageElement: HTMLElement): HTMLElement {
		const links: HTMLAnchorElement[] = pageElement.findAll('a') as HTMLAnchorElement[];
		for (const link of links) {
			if (link.href.startsWith('onenote:')) {
				const startIdx = link.href.indexOf('#') + 1;
				const endIdx = link.href.indexOf('&', startIdx);
				link.href = link.href.slice(startIdx, endIdx);
			}
		}
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

		for (const object of objects) {
			let split: string[] = object.getAttribute('data-attachment')!.split('.');
			const extension: string = split[split.length - 1];

			// If the page contains an incompatible file and user doesn't want to import them, skip
			if (!ATTACHMENT_EXTS.contains(extension) && !this.importIncompatibleAttachments) {
				continue;
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
		}

		for (let i = 0; i < images.length; i++) {
			const image = images[i];

			let split: string[] = image.getAttribute('data-fullres-src-type')!.split('/');
			const extension: string = split[1];
			const currentDate = moment().format('YYYYMMDDHHmmss');
			const fileName: string = `Exported image ${currentDate}-${i}.${extension}`;

			this.attachmentQueue.push({
				name: fileName,
				contentLocation: image.getAttribute('data-fullres-src')!,
			});

			image.src = encodeURIComponent(fileName);
			if (!image.alt) image.alt = 'Exported image';
		}

		for (const video of videos) {
			// Obsidian only supports embedding YouTube videos, unlike OneNote
			if (video.src.contains('youtube.com') || video.src.contains('youtu.be')) {
				const embedNode = document.createTextNode(`![Embedded YouTube video](${video.src})`);
				video.parentNode?.replaceChild(embedNode, video);
			}
			else {
				// If it's any other website, convert to a basic link
				const linkNode = document.createElement('a');
				linkNode.href = video.src;
				video.parentNode?.replaceChild(linkNode, video);
			}
		}
		return pageElement;
	}

	// Downloads attachments from the attachmentQueue once the file has been created.
	async fetchAttachmentQueue(progress: ImportContext, currentFile: TFile, outputFolder: TFolder) {
		if (this.attachmentQueue.length >= 1) {
			let attachmentPath: string = outputFolder.path + '/OneNote Attachments';

			// @ts-ignore
			// Bug: This function always returns the path + "Note name.md" rather than just the path for some reason
			if (this.useDefaultAttachmentFolder) attachmentPath = await this.app.vault.getAvailablePathForAttachments(currentFile.basename, currentFile.extension, currentFile);

			// Create the attachment folder if it doesn't exist yet
			try {
				this.vault.createFolder(attachmentPath);
			}
			catch (e) { }
			for (let i = 0; i < this.attachmentQueue.length; i++) {
				const attachment = this.attachmentQueue[i];
				try {
					// Every 7 attachments, do a few second break to prevent rate limiting
					if (i !== 0 && i % 7 === 0) {
						await new Promise(resolve => setTimeout(resolve, 7500));
					}
					const data = (await this.fetchResource(attachment.contentLocation!, 'file')) as ArrayBuffer;
					await this.app.vault.createBinary(attachmentPath + '/' + attachment.name, data);

					progress.reportAttachmentSuccess(attachment.name!);
				}
				catch (e) {
					progress.reportFailed(attachment.name!, e);
				}
			}

			// Clear the attachment queue after every note
			this.attachmentQueue = [];
		}
		else { }
	}

	// Convert OneNote styled elements to valid HTML for proper htmlToMarkdown conversion
	styledElementToHTML(pageElement: HTMLElement): HTMLElement {
		// Map styles to their elements
		const styleMap: { [key: string]: string } = {
			'font-weight:bold': 'b',
			'font-style:italic': 'i',
			'text-decoration:underline': 'u',
			'text-decoration:line-through': 's',
			'background-color': 'mark',
		};
		// Cites/quotes are not converted into Markdown (possible htmlToMarkdown bug?), so we do it ourselves temporarily
		const cites = pageElement.findAll('cite');
		cites.forEach((cite) => cite.innerHTML = '> ' + cite.innerHTML + '<br>');
		
		// Convert preformatted text into code blocks
		let inCodeBlock: boolean = false;
		let codeElement: HTMLElement = document.createElement('pre');

		const elements = pageElement.querySelectorAll('*');
		elements.forEach(element => {
			const style = element.getAttribute('style') || '';
			const matchingStyle = Object.keys(styleMap).find(key => style.includes(key));

			if (style?.contains('font-family:Consolas')) {
				if (!inCodeBlock) {
					inCodeBlock = true;
					element.replaceWith(codeElement);
					codeElement.innerHTML = '```\n' + element.innerHTML + '\n```';
				}
				else {
					element.remove();
					// Append the content and add fences in case there's no next element
					codeElement.innerHTML = codeElement.innerHTML.slice(0, -3) + element.innerHTML + '\n```';
				}
			}
			else if (element.nodeName === 'BR' && inCodeBlock) {
				codeElement.innerHTML = codeElement.innerHTML.slice(0, -3) + '\n```';
				element.remove();
			}
			else {
				if (inCodeBlock) {
					inCodeBlock = false; 
					codeElement = document.createElement('pre');
				}

				if (matchingStyle) {
					const newElementTag = styleMap[matchingStyle];
					const newElement = document.createElement(newElementTag);
					newElement.innerHTML = element.innerHTML;
					element.replaceWith(newElement);
				}
			}
		});
		return pageElement;
	}

	convertDrawings(element: HTMLElement): HTMLElement {
		// TODO: Convert using InkML, this is a temporary notice for users to know drawings were skipped
		const walker = document.createTreeWalker(element, NodeFilter.SHOW_COMMENT);
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
	async fetchResource(url: string, returnType: 'text'): Promise<string>;
	async fetchResource(url: string, returnType: 'file'): Promise<ArrayBuffer>;
	async fetchResource(url: string, returnType: 'json'): Promise<any>;
	async fetchResource(url: string, returnType: 'text' | 'file' | 'json' = 'json'): Promise<string | ArrayBuffer | any> {
		try {
			let response = await fetch(url, { headers: { Authorization: `Bearer ${this.graphData.accessToken}` } });
			let responseBody;

			switch (returnType) {
				case 'text':
					responseBody = await response.text();
					break;
				case 'file':
					responseBody = await response.arrayBuffer();
					break;
				default:
					responseBody = await response.json();
					if ('@odata.nextLink' in responseBody) {
						responseBody.value.push(...(await this.fetchResource(responseBody['@odata.nextLink'], 'json')).value);
					}
					break;
			}

			return responseBody;
		}
		catch (e) {
			console.error(`An error occurred while trying to fetch '${url}'. Error details: `, e);

			throw e;
		}
	}
}
