import { FormatImporter } from 'format-importer';
import { ProgressReporter } from 'main';
import { DataWriteOptions, Notice, Setting, TFile, TFolder, htmlToMarkdown, requestUrl } from 'obsidian';
import { OnenotePage, OnenoteSection, Notebook, SectionGroup } from '@microsoft/microsoft-graph-types';
import { parseHTML } from '../util';
import { DeviceCode, TokenResponse } from './onenote/models/device-code';

const GRAPH_CLIENT_ID: string = 'c1a20926-78a8-47c8-a2a4-650e482bd8d2'; // TODO: replace with an Obsidian team owned client_Id
const GRAPH_SCOPES: string[] = ['user.read', 'notes.read'];
const ATTACHMENT_EXTS: string[] = ['png','webp','jpg','jpeg','gif','bmp','svg','mpg','m4a','webm','wav','ogv','3gp','mov','mp4','mkv','pdf'];

export class OneNoteImporter extends FormatImporter {
	attachmentQueue: {name: string, url: string } [] = [];
	requestParams: RequestInit;
	useDefaultAttachmentFolder: boolean;
	importIncompatibleAttachments: boolean;
	selectedSections: OnenoteSection[] = [];

	init() {
		this.addOutputLocationSetting('OneNote');

		this.showUI();
	}

	async showUI() {
		new Setting(this.modal.contentEl)
			.setName('Use the default attachment folder')
			.setDesc('If disabled, attachments will be stored in the export folder in the OneNote Attachments folder.')
			.addToggle((toggle) => {
				toggle.setValue(true).onChange((value) => (this.useDefaultAttachmentFolder = value));
			});
		new Setting(this.modal.contentEl)
			.setName('Import incompatible attachments')
			.setDesc('Imports incompatible attachments which cannot be embedded in Obsidian, such as .exe files.')
			.addToggle((toggle) => {
				toggle.setValue(false);
				toggle.onChange((value) => (this.importIncompatibleAttachments = value));
			});

		// Create a wrapper for sign in related settings in order to hide them later
		const contentArea = this.modal.contentEl.createDiv({
			cls: 'contentArea',
		});
		contentArea.createEl('h3', {
			text: 'Sign in to your Microsoft Account',
			cls: 'modal-title',
		});
		let description = contentArea.createEl('p');
		// This could possibly use the version from DeviceCode.message, as it returns a string in the user's language?
		description.innerHTML = `Go to <a href="https://microsoft.com/devicelogin">microsoft.com/devicelogin</a> on your PC or phone and enter this code: <b>${await this.generateLoginCode()}</b>`;

		new Setting(contentArea)
			.setName('Custom user access token')
			.setDesc('If you are having troubles with the device code, use a custom access token from Microsoft Graph Explorer by going to the access token tab under the address bar.')
			.addText((text) => text.setPlaceholder('Paste token here').onChange(async (e) => this.signIn(e)));
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

		const deviceCodeData: DeviceCode = await tokenResponse.json;
		await this.pollForAccessToken(deviceCodeData);
		return deviceCodeData.user_code;
	}

	async pollForAccessToken(deviceCodeRequest: DeviceCode) {
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
				const tokenData: TokenResponse = tokenResponse.json;
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
		const contentArea: HTMLDivElement = this.modal.contentEl.querySelector('.contentArea')!;
		contentArea.innerHTML = '';
		contentArea.createEl('h3', {
			text: 'Choose what to import',
			cls: 'modal-title',
		});
		contentArea.createEl('hr');

		notebooks.forEach((notebook) => {
			contentArea.createEl('h5', {
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
		const contentArea: HTMLDivElement = this.modal.contentEl.querySelector('.contentArea')!;

		sections?.forEach((section) => {
			let label = contentArea.createEl('label');
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
			let notebookFolder: TFolder = await this.createFolders(outputFolder.path + '/' + section.parentNotebook?.displayName);
			let sectionFolder: TFolder = await this.createFolders(notebookFolder.path + '/' + section.displayName);

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

			let parsedPage = parseHTML(splitContent.html);
			parsedPage = this.convertInternalLinks(parsedPage);
			parsedPage = this.convertTags(parsedPage);
			parsedPage = this.getAllAttachments(parsedPage);

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
				element.textContent = `- ${check} ${element.textContent}\n`;
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

	// This function gets all attachments and adds them to the queue, as well as adds embedding syntax for supported file format
	getAllAttachments(pageHTML: HTMLElement): HTMLElement {
		try {
			const objects: HTMLElement[] = pageHTML.findAll('object');
			const images: HTMLElement[] = pageHTML.findAll('img');

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

					// The OneNote API has a weird bug when you export with InkML - it doesn't close the <object> tag properly,
					// so we need to first get everything out of it and then replace it with the Markdown style link
					const parentElement = object.parentNode as HTMLElement;
			
					// Add the content of the <object> tag to its parent node's innerHTML
					parentElement.innerHTML += object.innerHTML;
			
					// Create a new <p> element with the Markdown-style link
					const markdownLink = document.createElement('p');
					markdownLink.innerText = `![[${object.getAttribute('data-attachment') || ''}]]`;
			
					// Replace the <object> tag with the new <p> element
					parentElement.replaceChild(markdownLink, object);
				}
			});
		}
		catch (e) {
			console.log('OneNote attachment import error:', e);
		}
		return pageHTML;
	}

	// Downloads attachments from the attachmentQueue once the file has been created.
	async fetchAttachmentQueue(progress: ProgressReporter, currentFile: TFile) {
		//@ts-ignore
		let attachmentPath: string = await this.app.vault.getAvailablePathForAttachments(currentFile.basename, currentFile.extension, currentFile);
		if (!this.useDefaultAttachmentFolder) attachmentPath = (await this.getOutputFolder())!.path + '/OneNote Attachments';

		this.attachmentQueue.forEach(async attachment => {
			console.log(attachmentPath);

			const data = await (await fetch(attachment.url, this.requestParams)).arrayBuffer();
			await this.app.vault.createBinary(attachmentPath + '/' + attachment.name, data);
			progress.reportAttachmentSuccess(attachment.name);	
		});

		this.attachmentQueue = [];
	}
}
