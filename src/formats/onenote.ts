import { DataWriteOptions, Notice, Setting, TFile, TFolder, htmlToMarkdown, ObsidianProtocolData, requestUrl, moment } from 'obsidian';
import { genUid, parseHTML } from '../util';
import { FormatImporter } from '../format-importer';
import { ATTACHMENT_EXTS, AUTH_REDIRECT_URI, ImportContext } from '../main';
import { AccessTokenResponse } from './onenote/models';
import { OnenotePage, SectionGroup, User, FileAttachment, PublicError, OnenoteEntityHierarchyModel, Notebook, OnenoteSection } from '@microsoft/microsoft-graph-types';

const GRAPH_CLIENT_ID: string = '66553851-08fa-44f2-8bb1-1436f121a73d';
const GRAPH_SCOPES: string[] = ['user.read', 'notes.read'];

export class OneNoteImporter extends FormatImporter {
	// Settings
	outputFolder: TFolder;
	useDefaultAttachmentFolder: boolean = true;
	importIncompatibleAttachments: boolean = false;
	// UI
	microsoftAccountSetting: Setting;
	contentArea: HTMLDivElement;
	// Internal
	attachmentQueue: FileAttachment[] = [];
	selectedIds: string[] = [];
	notebooks: Notebook[] = [];
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

			await this.showSectionPickerUI();
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

		// Fetch the sections & section groups directly under the notebook
		const params = new URLSearchParams({
		  $expand: 'sections($select=id,displayName),sectionGroups($expand=sections,sectionGroups)',
		  $select: 'id,displayName',
		  $orderby: 'createdDateTime'
		});
		const sectionsUrl = `${baseUrl}?${params.toString()}`;
		this.notebooks = (await this.fetchResource(sectionsUrl, 'json')).value;

		// Make sure the element is empty, in case the user signs in twice
		this.contentArea.empty();
		this.contentArea.createEl('h4', {
			text: 'Choose data to import',
		});

		for (const notebook of this.notebooks) {
			let sectionGroups: SectionGroup[] = [];

			// Check if there are any nested section groups, if so, fetch them
			if (notebook.sectionGroups?.length !== 0) {
				for (const sectionGroup of notebook.sectionGroups!) {
					sectionGroups.push(await this.fetchNestedSectionGroups(sectionGroup));
				}
			}

			notebook.sectionGroups = sectionGroups;

			let notebookDiv = this.contentArea.createDiv();

			new Setting(notebookDiv)
				.setName(notebook.displayName!)
				.setDesc(`Last edited on: ${(moment.utc(notebook.createdDateTime)).format('Do MMMM YYYY')}. Contains ${notebook.sections?.length} sections.`)
				.addButton((button) => button
					.setCta()
					.setButtonText('Select all')
					.onClick(() => {
						notebookDiv.querySelectorAll('input[type="checkbox"]').forEach((el: HTMLInputElement) => el.checked = true);
					}));
			this.renderHierarchy(notebook, notebookDiv);
		}
	}

	// Gets the content of a nested section group
	async fetchNestedSectionGroups(parentGroup: SectionGroup) : Promise<SectionGroup> {
		parentGroup.sectionGroups = (await this.fetchResource(parentGroup.sectionGroupsUrl + '?$expand=sectionGroups($expand=sections),sections', 'json')).value;

		if (parentGroup.sectionGroups) {
			for (let i = 0; i < parentGroup.sectionGroups.length; i++) {
				parentGroup!.sectionGroups[i] = await this.fetchNestedSectionGroups(parentGroup.sectionGroups[i]);
			}
		}

		return parentGroup;
	}

	// Renders a HTML list of all section groups and sections
	renderHierarchy(entity: OnenoteEntityHierarchyModel, parentEl: HTMLElement) {
		if ('sectionGroups' in entity) {
			for (const sectionGroup of entity.sectionGroups as SectionGroup[]) {
				let sectionGroupDiv = parentEl.createDiv(
					{
						attr: {
							style: 'padding-inline-start: 1em; padding-top: 8px'
						}
					});
				
				sectionGroupDiv.createEl('strong', {
					text: sectionGroup.displayName!,
				});

				this.renderHierarchy(sectionGroup, sectionGroupDiv);
			}
		}
	  
		if ('sections' in entity) {
			const sectionList = parentEl.createEl('ul', {
				attr: {
					style: 'padding-inline-start: 1em;',
				},
			});
			for (const section of entity.sections as OnenoteSection[]) {
				const listElement = sectionList.createEl('li', {
					cls: 'task-list-item',
				});
				let label = listElement.createEl('label');
				let checkbox = label.createEl('input');
				checkbox.type = 'checkbox';

				label.appendChild(document.createTextNode(section.displayName!));
				label.createEl('br');

				checkbox.addEventListener('change', () => {
					if (checkbox.checked) this.selectedIds.push(section.id!);
					else {
						const index = this.selectedIds.findIndex((sec) => sec === section.id);
						if (index !== -1) {
							this.selectedIds.splice(index, 1);
						}
					}
				});

				this.renderHierarchy(section, parentEl);				
			}
		}
	}

	async import(progress: ImportContext): Promise<void> {
		// Remove possible duplicates, eg. when the user selects "Select all" with existing selections
		this.selectedIds =  [...new Set(this.selectedIds)];
		
		let remainingSections = this.selectedIds.length;

		if (!await this.getOutputFolder()) {
			new Notice('Please select a location to export to.');
			return;
		}
		else this.outputFolder = (await this.getOutputFolder())!;

		progress.status('Starting OneNote import');

		for (let sectionId of this.selectedIds) {
			progress.reportProgress(0, remainingSections);
			remainingSections--;

			let pageCount: number = 0;

			const baseUrl = `https://graph.microsoft.com/v1.0/me/onenote/sections/${sectionId}/pages`;
			const params = new URLSearchParams({
			  $select: 'id,title,createdDateTime,lastModifiedDateTime,level,order',
			  $orderby: 'order',
			  pagelevel: 'true'
			});

			const pagesUrl = `${baseUrl}?${params.toString()}`;
	
			let pages: OnenotePage[] = ((await this.fetchResource(pagesUrl, 'json')).value).reverse();

			progress.reportProgress(0, pages.length);

			for (let i = 0; i < pages.length; i++) {
				const page = pages[i];
				if (!page.title) page.title = `Untitled-${moment().format('YYYYMMDDHHmmss')}`;

				try {
					pageCount++;
					progress.status(`Importing note ${page.title}`);

					// Every 50 items, do a few second break to prevent rate limiting
					if (i !== 0 && i % 50 === 0) {
						await new Promise(resolve => setTimeout(resolve, 5000));
					}

					this.processFile(progress,
						await this.fetchResource(`https://graph.microsoft.com/v1.0/me/onenote/pages/${page.id}/content?includeInkML=true`, 'text'),
						page);
					progress.reportProgress(pageCount, pages.length);

				}
				catch (e) {
					progress.reportFailed(page.title, e.toString());
				}
			}
		}
	}

	async processFile(progress: ImportContext, content: string, page: OnenotePage) {
		try {
			const splitContent = this.convertFormat(content);
			const outputPath = this.getEntityPath(page.id!, this.outputFolder.name)!;

			let pageFolder: TFolder;
			if (!await this.vault.adapter.exists(outputPath)) pageFolder = await this.vault.createFolder(outputPath);
			else pageFolder = this.vault.getAbstractFileByPath(outputPath) as TFolder;

			let parsedPage: HTMLElement = this.getAllAttachments(splitContent.html);
			parsedPage = this.styledElementToHTML(parsedPage);
			parsedPage = this.convertTags(parsedPage);
			parsedPage = await this.convertInternalLinks(parsedPage, pageFolder.name);
			parsedPage = this.convertDrawings(parsedPage);

			let mdContent = htmlToMarkdown(parsedPage).trim();
			const fileRef = await this.saveAsMarkdownFile(pageFolder, page.title!, mdContent);

			await this.fetchAttachmentQueue(progress, fileRef, this.outputFolder);

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
		catch (e) {
			progress.reportFailed(page.title!, e);
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
				// We need to use innerHTML in case an image was marked as TO-DO
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

	async convertInternalLinks(pageElement: HTMLElement, pageFolder: string): Promise<HTMLElement> {
		const links: HTMLAnchorElement[] = pageElement.findAll('a') as HTMLAnchorElement[];
		for (const link of links) {
			if (link.href.startsWith('onenote:')) {
				// OneNote links don't contain a normal ID, instead, they use 'oneNoteClientUrl'
				const linkId = link.href.split('page-id=')[1]?.split('}')[0];
				//const linkTitle = link.href.slice((link.href.indexOf('#') + 1), link.href.indexOf('&', (link.href.indexOf('#') + 1)));

				if (!await this.vault.adapter.exists(this.getEntityPath(linkId, this.outputFolder.name)!)) {
					// If the page we're linking to doesn't exist *yet*, create an placeholder one
					//this.vault.create(this.getEntityPath())
				}

				//const targetPagePath = this.vault.getAbstractFileByPath(this.outputFolder.name + '/' + '.md') as TFile;
				
				// Replace the link with a markdown link
				link.href = '';
				//link.textContent = this.app.fileManager.generateMarkdownLink(targetPagePath, pageFolder);
			}
		}
		return pageElement;
	}

	/**
	 * Returns a filesystem path for any OneNote entity like sections or notes
	 * Paths are returned in the following format:
	 * (Export folder)/Notebook/(possible section groups)/Section/(possible pages with a higher level) 
	 */
	getEntityPath(entityID: string, currentPath: string, parentEntity?: OnenoteEntityHierarchyModel | undefined): string | null {
		if (!parentEntity || parentEntity === undefined) {
			// TODO fix: the import process is broken because it only goes through the first notebook
			for (const notebook of this.notebooks) {
				const foundPath = this.getEntityPath(entityID, `${currentPath}/${notebook.displayName}`, notebook);
				if (foundPath !== null) return foundPath;
			}
			// If no path is found in any notebook, return null
			return null;
		}
		else {
			if ('pages' in parentEntity && parentEntity.pages) {
				const section = parentEntity as OnenoteSection;
				// Check if the target page is in the current entity's pages
				for (let i = 0; i < section.pages!.length; i++) {
					const page = section.pages![i];
					const pageContentID = page.contentUrl!.split('page-id=')[1]?.split('}')[0];
					if (page.id === entityID || pageContentID === entityID) {
						if (page.level === 0) {
							/* Checks if we have a page leveled below this one. 
							 * without this line, leveled notes are more scattered:
							 * ...Section/Example.md, *but* ...Section/Example/Lower level.md
							 * with this line both files are in one neat directory:
							 * ...Section/Example/Page.md and ...Section/Example/Lower level.md
							 */
							if (section.pages![i+1]?.level !== 0) return `${currentPath}/${page.title}`;
							else return currentPath;
						}
						else {
							// If the page is not level 0, it means we need to try to find its parent
							// TODO...
						}	
					}
				}
			}
		  
			if ('sectionGroups' in parentEntity && parentEntity.sectionGroups) {
				// Recursively search in section groups
				const sectionGroups: SectionGroup[] = parentEntity.sectionGroups as SectionGroup[];
				for (const sectionGroup of sectionGroups) {
					const foundPath = this.getEntityPath(entityID, `${currentPath}/${sectionGroup.displayName}`, sectionGroup);
					if (foundPath) return foundPath;
				}
			}
		  
			if ('sections' in parentEntity && parentEntity.sections) {
				// Recursively search in sections
				const sectionGroup = parentEntity as SectionGroup;
				for (const section of sectionGroup.sections!) {
					const foundPath = this.getEntityPath(entityID, `${currentPath}/${section.displayName}`, section);
					if (foundPath) return foundPath;
				}
			}	
		}
		return currentPath;
	}

	// This function gets all attachments and adds them to the queue, as well as adds embedding syntax for supported file formats
	getAllAttachments(pageHTML: string): HTMLElement {
		/* The OneNote API has a weird bug when you export with InkML - it doesn't close self-closing tags
		(like <object/> or <iframe/>) properly, so we need to fix them using Regex */
		const objectRegex = /<object([^>]*)\/>/g;
		const iframeRegex = /<iframe([^>]*)\/>/g;
		const pageElement = parseHTML(pageHTML.replace(objectRegex, '<object$1></object>').replace(iframeRegex, '<iframe$1></iframe>'));

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
	
	// Fetches an Microsoft Graph resource and automatically handles ratelimits/errors
	async fetchResource(url: string, returnType: 'text'): Promise<string>;
	async fetchResource(url: string, returnType: 'file'): Promise<ArrayBuffer>;
	async fetchResource(url: string, returnType: 'json'): Promise<any>;
	async fetchResource(url: string, returnType: 'text' | 'file' | 'json' = 'json'): Promise<string | ArrayBuffer | any> {
		try {
			let response = await fetch(url, { headers: { Authorization: `Bearer ${this.graphData.accessToken}` } });
			let responseBody;

			if (response.ok) {
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
			}
			else {
				const err: PublicError = await response.json();

				console.log('An error has occurred while fetching an resource:', err);
				// We're ratelimited - let's retry after the suggested amount of time
				if (err.code === '20166') {
					let retryTime = (+!response.headers.get('Retry-After') * 1000) || 5000;

					console.log(`Rate limit exceeded, waiting for: ${retryTime} ms`);

					if (response.status === 429 || response.status === 504) {
						setTimeout(() => {
							responseBody = this.fetchResource(url, returnType as any);
						}, retryTime);
					}
				}
			}
			return responseBody;
		}
		catch (e) {
			console.error(`An unexpected error occurred while trying to fetch '${url}'. Error details: `, e);

			throw e;
		}
	}
}
