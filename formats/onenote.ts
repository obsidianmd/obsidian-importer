import { FormatImporter } from 'format-importer';
import { ProgressReporter } from 'main';
import { DataWriteOptions, Notice, Setting, TFile, TFolder, htmlToMarkdown, requestUrl } from 'obsidian';
import { OnenotePage, OnenoteSection, Notebook, SectionGroup } from '@microsoft/microsoft-graph-types';
import { parseHTML } from '../util';
import { deviceCode, tokenResponse } from './onenote/models/device-code';

const GRAPH_CLIENT_ID: string = 'c1a20926-78a8-47c8-a2a4-650e482bd8d2'; // TODO: replace with an Obsidian team owned client_Id
const GRAPH_SCOPES: string[] = ['user.read', 'notes.read'];
// TODO: This array is used by a few other importers, so it could get moved into format-importer.ts to prevent duplication
const ATTACHMENT_EXTS = ['png', 'webp', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'mpg', 'm4a', 'webm', 'wav', 'ogv', '3gp', 'mov', 'mp4', 'mkv', 'pdf'];

export class OneNoteImporter extends FormatImporter {
	useDefaultAttachmentFolder: boolean = true;
	importIncompatibleAttachments: boolean;
	contentArea: HTMLDivElement;
	requestParams: RequestInit;
	attachmentQueue: {name: string, url: string } [] = [];
	selectedSections: OnenoteSection[] = [];

	init() {
		this.addOutputLocationSetting('OneNote');

		this.showUI();
	}

	async showUI() {
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
		// Create a wrapper for sign in related settings in order to hide them later
		this.contentArea.createEl('h3', {
			text: 'Sign in to your Microsoft Account',
			cls: 'modal-title',
		});
		let description = this.contentArea.createEl('p');
		// This could possibly use the version from DeviceCode.message, as it returns a string in the user's language?
		description.innerHTML = `Go to <a href="https://microsoft.com/devicelogin">microsoft.com/devicelogin</a> on your PC or phone and enter this code: <b>${await this.generateLoginCode()}</b>`;

		new Setting(this.contentArea)
			.setName('Custom user access token')
			.setDesc('If you are having troubles with the device code, use a custom access token from Microsoft Graph Explorer by going to the access token tab under the address bar.')
			.addText((text) => text.setPlaceholder('Paste token here')
				.onChange(async (e) => this.signIn(e)));
	}

	async generateLoginCode(): Promise<string> {
		const requestBody = new URLSearchParams({
			client_id: GRAPH_CLIENT_ID,
			scope: GRAPH_SCOPES.join(' '),
		});

		// Using requestUrl in order to prevent CORS issues
		const tokenResponse = await requestUrl(
			`https://login.microsoftonline.com/common/oauth2/v2.0/devicecode?${requestBody.toString()}`
		);

		const deviceCodeData: deviceCode = await tokenResponse.json;
		await this.pollForAccessToken(deviceCodeData);
		return deviceCodeData.user_code;
	}

	async pollForAccessToken(deviceCodeRequest: deviceCode) {
		const requestBody = new URLSearchParams({
			grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
			client_id: GRAPH_CLIENT_ID,
			device_code: deviceCodeRequest.device_code,
		});
		let intervalId = setInterval(async () => {
			try {
				const tokenResponse = await requestUrl({
					method: 'POST',
					url: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
					contentType: 'application/x-www-form-urlencoded',
					body: requestBody.toString(),
				});
				const tokenData: tokenResponse = tokenResponse.json;
				await this.signIn(tokenData.access_token);
				clearInterval(intervalId);
			}
			catch (e) {
				console.log(e);
			}
		}, deviceCodeRequest.interval * 1000); // Convert seconds into miliseconds
	}
	
	async signIn(accessToken: string) {
		this.requestParams = {
			headers: {
				Authorization: `Bearer ${accessToken}`,
			},
		};
		await this.showSectionPickerUI();
	}

	async showSectionPickerUI() {
		const response = await fetch(
			'https://graph.microsoft.com/v1.0/me/onenote/notebooks?$expand=sections($select=id,displayName)&$select=id,displayName&$orderby=createdDateTime',
			this.requestParams
		);
		const data = await response.json();
		const notebooks: Notebook[] = data.value;

		// Replace the sign in area to declutter the UI
		this.contentArea.empty();

		this.contentArea.createEl('h3', {
			text: 'Choose what to import',
			cls: 'modal-title',
		});
		this.contentArea.createEl('hr');

		notebooks.forEach((notebook) => {
			this.contentArea.createEl('h5', {
				text: notebook.displayName!,
				cls: 'modal-title',
			});

			let sections: OnenoteSection[] = notebook.sections!;
			// All notebooks have sections but not all notebooks have section groups
			let sectionGroups: SectionGroup[] | undefined | null = notebook?.sectionGroups;

			this.createSectionList(sections);
			sectionGroups?.forEach((sectionGroup) => {
				this.modal.contentEl.createEl('h6', {
					text: sectionGroup.displayName!,
				});
				this.createSectionList(sectionGroup.sections!);
			});
		});
	}

	createSectionList(sections: OnenoteSection[]) {
		sections?.forEach((section) => {
			let label = this.contentArea.createEl('label');
			let checkbox = label.createEl('input');
			label.appendChild(document.createTextNode(section.displayName!));
			checkbox.type = 'checkbox';
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

			let pages: OnenotePage[] = (await (await fetch(`
					https://graph.microsoft.com/v1.0/me/onenote/sections/${section.id}/pages?$select=id,title,createdDateTime,lastModifiedDateTime`,
			this.requestParams)).json()).value;

			pages.forEach(async (page) =>
				this.processFile(progress, sectionFolder, await (await fetch(
					`https://graph.microsoft.com/v1.0/me/onenote/pages/${page.id}/content?includeInkML=true`,
					this.requestParams)).text(), page));
		}
	}

	async processFile(progress: ProgressReporter, folder: TFolder, content: string, page: OnenotePage) {
		try {
			const splitContent = this.convertFormat(content);

			let parsedPage: HTMLElement = this.getAllAttachments(splitContent.html);
			parsedPage = this.convertInternalLinks(parsedPage);
			parsedPage = this.convertTags(parsedPage);

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
		catch (e) {
			progress.reportFailed(page.title!, e);
		}
	}

	// OneNote returns page data and inking data in one file, so we need to split them
	convertFormat(input: string): { html: string; inkml: string } {
		const output = { html: '', inkml: '' };
		const boundary = input.split('\n')[0];
		const parts = input.split(boundary);

		for (let part of parts) {
			if (part.trim() === '') continue;

			let contentTypeLine = part.split('\n').find((line) => line.includes('Content-Type'));

			let contentType = contentTypeLine!.split(';')[0].split(':')[1].trim();

			// Extract the value from the part by removing the first two lines and then splitting by the boundary delimiter
			let value = part
				.split('\n')
				.slice(2)
				.join('\n')
				.split(boundary)[0]
				.trim();

			if (contentType === 'text/html') {
				output.html = value;
			}
			else if (contentType === 'application/inkml+xml') {
				const lines = value.split('\n');
				lines.pop(); // Remove the last line
				output.inkml = lines.join('\n');
			}
		}
		return output;
	}

	convertTags(pageElement: HTMLElement): HTMLElement {
		const tagElements = pageElement.querySelectorAll('[data-tag]');

		tagElements.forEach((element) => {
			// If a TODO tag, then convert it into a Markdown to-do
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
					url: object.getAttribute('data')!,
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
				url: image.getAttribute('data-fullres-src')!,
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
				console.log(attachmentPath);
				this.vault.createFolder(attachmentPath);
			}
			catch (e) { }
	
			this.attachmentQueue.forEach(async attachment => {
				try {
					const data = await (await fetch(attachment.url, this.requestParams)).arrayBuffer();
					await this.app.vault.createBinary(attachmentPath + '/' + attachment.name, data);
		
					progress.reportAttachmentSuccess(attachment.name);	
				}
				catch (e) {
					progress.reportFailed(attachment.name, e);
				}
			});
	
			// Clear the attachment queue after every note
			this.attachmentQueue = [];		
		}
		else { }
	}
	
	// Convert OneNote styled elements to valid HTML for proper htmlToMarkdown conversion
	styledElementToHTML() {
		// All p/span with Consolas are preformatted text/code blocks

		// All spans with styles are text styles such as bold, italic, underline, strikethrough

		// For some reason cites/quotes are not converted into Markdown (possible htmlToMarkdown bug)
	}
}
