import { OnenotePage, SectionGroup, User, PublicError, Notebook, OnenoteSection } from '@microsoft/microsoft-graph-types';
import { DataWriteOptions, Notice, Setting, TFolder, htmlToMarkdown, ObsidianProtocolData, requestUrl, moment } from 'obsidian';
import { genUid, parseHTML } from '../util';
import { FormatImporter } from '../format-importer';
import { ATTACHMENT_EXTS, AUTH_REDIRECT_URI, ImportContext } from '../main';
import { AccessTokenResponse } from './onenote/models';

const LOCAL_STORAGE_KEY = 'onenote-importer-refresh-token';
const GRAPH_CLIENT_ID: string = '66553851-08fa-44f2-8bb1-1436f121a73d';
const GRAPH_SCOPES: string[] = ['user.read', 'notes.read'];
// Regex for fixing broken HTML returned by the OneNote API
const SELF_CLOSING_REGEX = /<(object|iframe)([^>]*)\/>/g;
// Regex for fixing whitespace and paragraphs
const PARAGRAPH_REGEX = /(<\/p>)\s*(<p[^>]*>)|\n  \n/g;
// Maximum amount of request retries, before they're marked as failed
const MAX_RETRY_ATTEMPTS = 5;

const BASE64_REGEX = new RegExp(/^data:[\w\d]+\/[\w\d]+;base64,/);

export class OneNoteImporter extends FormatImporter {
	// Settings
	importPreviouslyImported: boolean = false;
	importIncompatibleAttachments: boolean = false;
	// UI
	microsoftAccountSetting: Setting;
	switchUserSetting: Setting;
	loadingArea: HTMLDivElement;
	contentArea: HTMLDivElement;
	// Internal
	selectedIds: string[] = [];
	notebooks: Notebook[] = [];
	graphData = {
		state: genUid(32),
		accessToken: '',
	};
	attachmentDownloadPauseCounter = 0;
	rememberMe = false;
	refreshToken?: string;

	async init() {
		this.addOutputLocationSetting('OneNote');

		new Setting(this.modal.contentEl)
			.setName('Import incompatible attachments')
			.setDesc('Imports incompatible attachments which cannot be embedded in Obsidian, such as .exe files.')
			.addToggle((toggle) => toggle
				.setValue(false)
				.onChange((value) => (this.importIncompatibleAttachments = value))
			);

		new Setting(this.modal.contentEl)
			.setName('Skip previously imported')
			.setDesc('If enabled, notes imported previously by this plugin will be skipped.')
			.addToggle((toggle) => toggle
				.setValue(true)
				.onChange((value) => (this.importPreviouslyImported = !value))
			);

		let authenticated = false;
		if (this.retrieveRefreshToken()) {
			try {
				await this.updateAccessToken();
				authenticated = true;
			}
			catch (e) {
				// Failed to auth with refresh token. Proceed with normal sign in flow.
			}
		}

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
							scope: 'offline_access ' + GRAPH_SCOPES.join(' '),
							response_type: 'code',
							redirect_uri: AUTH_REDIRECT_URI,
							response_mode: 'query',
							state: this.graphData.state,
						});
						window.open(`https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${requestBody.toString()}`);
					})
				);
		this.microsoftAccountSetting.settingEl.toggle(!authenticated);

		const rememberMeSetting = new Setting(this.modal.contentEl)
			.setName('Remember me')
			.setDesc('If checked, you will be automatically logged in for subsequent imports.')
			.addToggle((toggle) => {
				toggle.onChange((value) => {
					this.rememberMe = value;
					if (value && this.refreshToken) {
						this.storeRefreshToken(this.refreshToken);
					}
					else {
						this.clearStoredRefreshToken();
					}
				});
			});
		rememberMeSetting.settingEl.toggle(!authenticated);

		this.switchUserSetting = new Setting(this.modal.contentEl)
			.addButton((button) => button
				.setCta()
				.setButtonText('Switch user')
				.onClick(() => {
					this.microsoftAccountSetting.settingEl.show();
					rememberMeSetting.settingEl.show();
					this.clearStoredRefreshToken();
					this.switchUserSetting.settingEl.hide();
					this.contentArea.empty();
				})
			);

		this.loadingArea = this.modal.contentEl.createDiv({
			text: 'Loading notebooks...',
		});
		this.loadingArea.hide();
		this.contentArea = this.modal.contentEl.createDiv();
		this.contentArea.hide();

		if (authenticated) {
			await this.setSwitchUser();
			await this.showSectionPickerUI();
		}
		else {
			this.switchUserSetting.settingEl.hide();
		}
	}

	async authenticateUser(protocolData: ObsidianProtocolData) {
		try {
			if (protocolData['state'] !== this.graphData.state) {
				throw new Error(`An incorrect state was returned.\nExpected state: ${this.graphData.state}\nReturned state: ${protocolData['state']}`);
			}

			await this.updateAccessToken(protocolData['code']);
			await this.setSwitchUser();
			await this.showSectionPickerUI();
		}
		catch (e) {
			console.error('An error occurred while we were trying to sign you in. Error details: ', e);
			this.modal.contentEl.createEl('div', { text: 'An error occurred while trying to sign you in.' })
				.createEl('details', { text: e })
				.createEl('summary', { text: 'Click here to show error details' });
		}
	}

	async setSwitchUser() {
		const userData: User = await this.fetchResource('https://graph.microsoft.com/v1.0/me', 'json');
		this.switchUserSetting.setDesc(
			`Signed in as ${userData.displayName} (${userData.mail}). If that's not the correct account, sign in again.`
		);

		this.switchUserSetting.settingEl.show();
		this.microsoftAccountSetting.settingEl.hide();
	}

	/**
	 * Use the provided code if there is one to retrieve an access token. If
	 * no code is provided, attempt to use a stored refresh token.
	 */
	async updateAccessToken(code?: string) {
		// offline_access scope is requested so that we can retrieve refresh token, which can be
		// used if this import takes a long time, or for future imports.
		const requestBody = new URLSearchParams({
			client_id: GRAPH_CLIENT_ID,
			scope: 'offline_access ' + GRAPH_SCOPES.join(' '),
			redirect_uri: AUTH_REDIRECT_URI,
		});
		if (code) {
			requestBody.set('code', code);
			requestBody.set('grant_type', 'authorization_code');
		}
		else {
			const refreshToken = this.retrieveRefreshToken();
			if (!refreshToken) {
				throw new Error('Missing token required for authentication. Please try logging in again.');
			}
			requestBody.set('refresh_token', refreshToken);
			requestBody.set('grant_type', 'refresh_token');
		}

		const tokenResponse: AccessTokenResponse = await requestUrl({
			method: 'POST',
			url: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
			contentType: 'application/x-www-form-urlencoded',
			body: requestBody.toString(),
		}).json;

		if (!tokenResponse.access_token) {
			throw new Error(`Unexpected data was returned instead of an access token. Error details: ${tokenResponse}`);
		}

		if (tokenResponse.refresh_token) {
			this.storeRefreshToken(tokenResponse.refresh_token);
		}

		this.graphData.accessToken = tokenResponse.access_token;
	}

	private storeRefreshToken(refreshToken: string) {
		this.refreshToken = refreshToken;
		if (this.rememberMe) {
			localStorage.setItem(LOCAL_STORAGE_KEY, refreshToken);
		}
	}

	private retrieveRefreshToken(): string | null {
		if (this.refreshToken) {
			return this.refreshToken;
		}
		return localStorage.getItem(LOCAL_STORAGE_KEY);
	}

	private clearStoredRefreshToken() {
		localStorage.removeItem(LOCAL_STORAGE_KEY);
	}

	async showSectionPickerUI() {
		this.loadingArea.show();

		// Emptying, as the user may have leftover selections from previous sign-in attempt
		this.selectedIds = [];

		const baseUrl = 'https://graph.microsoft.com/v1.0/me/onenote/notebooks';

		// Fetch the sections & section groups directly under the notebook
		const params = new URLSearchParams({
			$expand: 'sections($select=id,displayName),sectionGroups($expand=sections,sectionGroups)',
			$select: 'id,displayName,lastModifiedDateTime',
			$orderby: 'lastModifiedDateTime DESC',
		});
		const sectionsUrl = `${baseUrl}?${params.toString()}`;
		try {
			this.notebooks = (await this.fetchResource(sectionsUrl, 'json')).value;

			// Make sure the element is empty, in case the user signs in twice
			this.contentArea.empty();
			this.contentArea.createEl('h4', {
				text: 'Choose data to import',
			});

			for (const notebook of this.notebooks) {
				// Check if there are any nested section groups, if so, fetch them
				if (notebook.sectionGroups?.length !== 0) {
					for (const sectionGroup of notebook.sectionGroups!) {
						await this.fetchNestedSectionGroups(sectionGroup);
					}
				}

				let notebookDiv = this.contentArea.createDiv();

				new Setting(notebookDiv)
					.setName(notebook.displayName!)
					.setDesc(`Last edited on: ${(moment.utc(notebook.lastModifiedDateTime)).format('Do MMMM YYYY')}. Contains ${notebook.sections?.length} sections.`)
					.addButton((button) => button
						.setCta()
						.setButtonText('Select all')
						.onClick(() => {
							notebookDiv.querySelectorAll('input[type="checkbox"]:not(:checked)').forEach((el: HTMLInputElement) => el.click());
						}));
				this.renderHierarchy(notebook, notebookDiv);
			}
		}
		catch {
			this.showContentAreaErrorMessage();
		}

		this.loadingArea.hide();
		this.contentArea.show();
	}

	// Gets the content of a nested section group
	async fetchNestedSectionGroups(parentGroup: SectionGroup) {
		parentGroup.sectionGroups = (await this.fetchResource(parentGroup.sectionGroupsUrl + '?$expand=sectionGroups($expand=sections),sections', 'json')).value;

		if (parentGroup.sectionGroups) {
			for (let i = 0; i < parentGroup.sectionGroups.length; i++) {
				await this.fetchNestedSectionGroups(parentGroup.sectionGroups[i]);
			}
		}
	}

	// Renders a HTML list of all section groups and sections
	renderHierarchy(entity: SectionGroup | Notebook, parentEl: HTMLElement) {
		if (entity.sectionGroups) {
			for (const sectionGroup of entity.sectionGroups) {
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

		if (entity.sections) {
			const sectionList = parentEl.createEl('ul', {
				attr: {
					style: 'padding-inline-start: 1em;',
				},
			});
			for (const section of entity.sections) {
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
			}
		}
	}

	showContentAreaErrorMessage() {
		this.contentArea.empty();
		this.contentArea.createEl('p', {
			text: 'Microsoft OneNote has limited how fast notes can be imported. Please try again in 30 minutes to continue importing.'
		});

		this.contentArea.show();
		this.loadingArea.hide();
	}

	async import(progress: ImportContext): Promise<void> {
		const previouslyImported = new Set<string>();
		const data = await this.modal.plugin.loadData();
		if (!data.importers.onenote) {
			data.importers.onenote = {
				previouslyImportedIDs: [],
			};
		}
		for (const id of data.importers.onenote.previouslyImportedIDs) {
			previouslyImported.add(id);
		}

		const outputFolder = await this.getOutputFolder();
		if (!outputFolder) {
			new Notice('Please select a location to export to.');
			return;
		}

		if (!this.graphData.accessToken) {
			new Notice('Please sign in to your Microsoft Account.');
			return;
		}

		progress.status('Starting OneNote import');
		let progressTotal = 0;
		let progressCurrent = 0;
		let consecutiveFailureCount = 0;

		for (let sectionId of this.selectedIds) {
			progress.reportProgress(progressCurrent, progressTotal);

			const baseUrl = `https://graph.microsoft.com/v1.0/me/onenote/sections/${sectionId}/pages`;
			const params = new URLSearchParams({
				$select: 'id,title,createdDateTime,lastModifiedDateTime,level,order,contentUrl',
				$orderby: 'order',
				pagelevel: 'true'
			});

			const pagesUrl = `${baseUrl}?${params.toString()}`;

			let pages: OnenotePage[] | null = null;
			try {
				pages = ((await this.fetchResource(pagesUrl, 'json')).value);
			}
			catch (e) {
				progress.status('Microsoft OneNote has limited how fast notes can be imported. Please try again in 30 minutes to continue importing.');
				return;
			}
			if (!pages) {
				continue;
			}
			progressTotal += pages.length;
			this.insertPagesToSection(pages, sectionId);

			progress.reportProgress(progressCurrent, progressTotal);

			for (let i = 0; i < pages.length; i++) {
				if (progress.isCancelled()) {
					return;
				}

				const page = pages[i];
				if (!page.title) page.title = `Untitled-${moment().format('YYYYMMDDHHmmss')}`;

				if (!this.importPreviouslyImported && page.id && previouslyImported.has(page.id)) {
					progress.reportSkipped(page.title, 'it was previously imported');
					continue;
				}

				try {
					progress.status(`Importing note ${page.title}`);

					await this.processFile(progress,
						await this.fetchResource(`https://graph.microsoft.com/v1.0/me/onenote/pages/${page.id}/content?includeInkML=true`, 'text'),
						page);

					if (page.id) {
						previouslyImported.add(page.id);
						data.importers.onenote.previouslyImportedIDs = Array.from(previouslyImported);
						await this.modal.plugin.saveData(data);
					}

					progressCurrent++;
					consecutiveFailureCount = 0;
				}
				catch (e) {
					consecutiveFailureCount++;
					progress.reportFailed(page.title, e.toString());

					if (consecutiveFailureCount > 5) {
						// Likely being rate limited.
						progress.status('Microsoft OneNote has limited how fast notes can be imported. Please try again in 30 minutes to continue importing.');
						return;
					}
				}
				progress.reportProgress(progressCurrent, progressTotal);
			}
		}
	}

	insertPagesToSection(pages: OnenotePage[], sectionId: string, parentEntity?: Notebook | SectionGroup) {
		if (!parentEntity) {
			for (const notebook of this.notebooks) {
				this.insertPagesToSection(pages, sectionId, notebook);
			}
			return;
		}

		if (parentEntity.sectionGroups) {
			// Recursively search in section groups
			const sectionGroups: SectionGroup[] = parentEntity.sectionGroups;
			for (const sectionGroup of sectionGroups) {
				this.insertPagesToSection(pages, sectionId, sectionGroup);
			}
		}

		if (parentEntity.sections) {
			// Recursively search in sections
			const sectionGroup = parentEntity;
			for (const section of sectionGroup.sections!) {
				if (section.id === sectionId) {
					section.pages = pages;
				}
			}
		}
	}

	async processFile(progress: ImportContext, content: string, page: OnenotePage) {
		try {
			const splitContent = this.convertFormat(content);
			const outputFolder = await this.getOutputFolder();
			const outputPath = this.getEntityPathNoParent(page.id!, outputFolder!.name)!;

			let pageFolder: TFolder;
			if (!await this.vault.adapter.exists(outputPath)) pageFolder = await this.vault.createFolder(outputPath);
			else pageFolder = this.vault.getAbstractFileByPath(outputPath) as TFolder;


			let taggedPage = this.convertTags(parseHTML(splitContent.html));
			let html = await this.getAllAttachments(progress, taggedPage.replace(PARAGRAPH_REGEX, '<br />'));
			let parsedPage = this.styledElementToHTML(html);
			parsedPage = this.convertInternalLinks(parsedPage);
			parsedPage = this.convertDrawings(parsedPage);
			this.escapeTextNodes(parsedPage);

			let mdContent = htmlToMarkdown(parsedPage).trim().replace(PARAGRAPH_REGEX, ' ');
			const fileRef = await this.saveAsMarkdownFile(pageFolder, page.title!, mdContent);

			// Add the last modified and creation time metadata
			const lastModified = page?.lastModifiedDateTime ? Date.parse(page.lastModifiedDateTime) : null;
			const created = page?.createdDateTime ? Date.parse(page.createdDateTime) : null;
			const writeOptions: DataWriteOptions = {
				ctime: created ?? lastModified ?? Date.now(),
				mtime: lastModified ?? created ?? Date.now(),
			};
			await this.vault.append(fileRef, '', writeOptions);
			progress.reportNoteSuccess(page.title!);
		}
		catch (e) {
			progress.reportFailed(page.title!, e);
		}
	}

	/** Escape characters which will cause problems after converting to markdown. */
	escapeTextNodes(node: ChildNode) {
		if (node.nodeType === Node.TEXT_NODE && node.textContent) {
			node.textContent = node.textContent
				.replace(/([<>])/g, '\\$1');
		}
		else {
			for (let i = 0; i < node.childNodes.length; i++) {
				this.escapeTextNodes(node.childNodes[i]);
			}
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

	convertTags(pageElement: HTMLElement): string {
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
		return pageElement.outerHTML;
	}

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

	getEntityPathNoParent(entityID: string, currentPath: string): string | null {
		for (const notebook of this.notebooks) {
			const path = this.getEntityPath(entityID, `${currentPath}/${notebook.displayName}`, notebook);
			if (path) return path;
		}
		return null;
	}

	/**
	 * Returns a filesystem path for any OneNote entity (e.g. sections or notes)
	 * Paths are returned in the following format:
	 * (Export folder)/Notebook/(possible section groups)/Section/(possible pages with a higher level)
	 */
	getEntityPath(entityID: string, currentPath: string, parentEntity: Notebook | SectionGroup | OnenoteSection): string | null {
		let returnPath: string | null = null;

		if ('sectionGroups' in parentEntity && parentEntity.sectionGroups) {
			const path = this.searchSectionGroups(entityID, currentPath, parentEntity.sectionGroups);
			if (path !== null) returnPath = path;
		}

		if ('sections' in parentEntity && parentEntity.sections) {
			const path = this.searchSectionGroups(entityID, currentPath, parentEntity.sections);
			if (path !== null) returnPath = path;
		}

		if ('pages' in parentEntity && parentEntity.pages) {
			const path = this.searchPages(entityID, currentPath, parentEntity);
			if (path !== null) returnPath = path;
		}

		if (returnPath) {
			returnPath = this.sanitizeFilePath(returnPath);
		}

		return returnPath;
	}

	private searchPages(entityID: string, currentPath: string, section: OnenoteSection): string | null {
		let returnPath: string | null = null;
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
					if (section.pages![i + 1] && section.pages![i + 1].level !== 0) {
						returnPath = `${currentPath}/${page.title}`;
					}
					else returnPath = currentPath;
				}
				else {
					returnPath = currentPath;

					// Iterate backward to find the parent page
					for (let i = section.pages!.indexOf(page) - 1; i >= 0; i--) {
						if (section.pages![i].level === page.level! - 1) {
							returnPath += '/' + section.pages![i].title;
							break;
						}
					}
				}
				break;
			}
		}
		return returnPath;
	}

	private searchSectionGroups(entityID: string, currentPath: string, sectionGroups: SectionGroup[] | OnenoteSection[]): string | null {
		// Recursively search in section groups
		let returnPath: string | null = null;
		for (const sectionGroup of sectionGroups) {
			if (sectionGroup.id === entityID) returnPath = `${currentPath}/${sectionGroup.displayName}`;
			else {
				const foundPath = this.getEntityPath(entityID, `${currentPath}/${sectionGroup.displayName}`, sectionGroup);
				if (foundPath) {
					returnPath = foundPath;
					break;
				}
			}
		}
		return returnPath;
	}

	// Helper function to sanitize OCR text for markdown
	private sanitizeOCRText(text: string): string {
		// Only keep word characters, digits, and spaces
		text = text.replace(/[^\w\d\s]/g, '');

		// Replace multiple spaces with single space and trim
		text = text.replace(/\s+/g, ' ').trim();

		// Truncate to a reasonable length
		if (text.length > 50) {
			text = text.substring(0, 50) + '...';
		}

		return text;
	}

	// Download all attachments and add embedding syntax for supported file formats.
	async getAllAttachments(progress: ImportContext, pageHTML: string): Promise<HTMLElement> {
		const pageElement = parseHTML(pageHTML.replace(SELF_CLOSING_REGEX, '<$1$2></$1>'));

		const objects: HTMLElement[] = pageElement.findAll('object');
		const images: HTMLImageElement[] = pageElement.findAll('img') as HTMLImageElement[];
		// Online videos are implemented as iframes, normal videos are just <object>s
		const videos: HTMLIFrameElement[] = pageElement.findAll('iframe') as HTMLIFrameElement[];

		for (const object of objects) {
			// Objects may contain child nodes which would be lost when the object is replaced by markdown.
			// To preserve these, move any child items to be siblings of the object
			while (object.firstChild) {
				object.parentNode?.insertBefore(object.firstChild, object.nextSibling);
			}

			let split: string[] = object.getAttribute('data-attachment')!.split('.');
			const extension: string = split[split.length - 1];

			// If the page contains an incompatible file and user doesn't want to import them, skip
			if (!ATTACHMENT_EXTS.contains(extension) && !this.importIncompatibleAttachments) {
				continue;
			}
			else {
				const originalName = object.getAttribute('data-attachment')!;
				const contentLocation = object.getAttribute('data')!;
				const filename = await this.fetchAttachment(progress, originalName, contentLocation);

				// Create a new <p> element with the Markdown-style link
				const markdownLink = document.createElement('p');
				markdownLink.innerText = `![[${filename}]]`;

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
			const contentLocation = image.getAttribute('data-fullres-src')!;
			const outputPath = await this.fetchAttachment(progress, fileName, contentLocation);
			if (outputPath) {
				image.src = encodeURI(outputPath);
				if (!image.alt || BASE64_REGEX.test(image.alt)) {
					image.alt = 'Exported image';
				}
				else {
					// Sanitize OCR text to ensure valid markdown
					image.alt = this.sanitizeOCRText(image.alt) || 'Exported image';
				}
			}
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

	async fetchAttachment(progress: ImportContext, filename: string, contentLocation: string) {
		// Every 7 attachments, do a few second break to prevent rate limiting
		if (this.attachmentDownloadPauseCounter === 7) {
			await new Promise(resolve => {
				progress.status('Pausing attachment download to avoid rate limiting.');
				this.attachmentDownloadPauseCounter = 0;
				setTimeout(resolve, 3000);
			});
		}
		this.attachmentDownloadPauseCounter++;

		progress.status('Downloading attachment ' + filename);

		try {
			// We don't need to remember claimedPaths because we're writing the attachments immediately.
			const outputPath = await this.getAvailablePathForAttachment(filename, []);
			const data = (await this.fetchResource(contentLocation, 'file')) as ArrayBuffer;
			await this.app.vault.createBinary(outputPath, data);
			progress.reportAttachmentSuccess(filename);
			return outputPath;
		}
		catch (e) {
			progress.reportFailed(filename);
			console.error(e);
		}
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
					// Append the content and add fences in case there's no next element
					codeElement.innerHTML = codeElement.innerHTML.slice(0, -3) + element.innerHTML + '\n```';
				}
			}
			else if (element.nodeName === 'BR' && inCodeBlock) {
				codeElement.innerHTML = codeElement.innerHTML.slice(0, -3) + '\n```';
			}
			else if (element.nodeName === 'TD') {
				// Do not replace table cells if they are styled.
				element.removeAttribute('style');
				return;
			}
			else {
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

	// Fetches an Microsoft Graph resource and automatically handles rate-limits/errors
	async fetchResource(url: string, returnType: 'text', retryCount?: number | undefined): Promise<string>;
	async fetchResource(url: string, returnType: 'file', retryCount?: number | undefined): Promise<ArrayBuffer>;
	async fetchResource(url: string, returnType: 'json', retryCount?: number | undefined): Promise<any>;
	async fetchResource(url: string, returnType: 'text' | 'file' | 'json' = 'json', retryCount: number = 0): Promise<string | ArrayBuffer | any> {
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
				let err: PublicError | null = null;
				const respJson = await response.json();
				if (respJson.hasOwnProperty('error')) {
					err = respJson.error;
				}
				if (!err) {
					console.log('An error has occurred while fetching an resource:', respJson);

					if (retryCount < MAX_RETRY_ATTEMPTS) {
						return this.fetchResource(url, returnType as any, retryCount + 1);
					}
					else {
						throw new Error('Unexpected error retrieving resource');
					}
				}

				console.log('An error has occurred while fetching an resource:', err);

				// If our access token has expired, then refresh it and we can try again.
				if (err.code === '40001' && retryCount < MAX_RETRY_ATTEMPTS) {
					await this.updateAccessToken();
					return this.fetchResource(url, returnType as any, retryCount + 1);
				}

				// We're rate-limited - let's retry after the suggested amount of time
				if (err.code === '20166') {
					let retryTime = (+!response.headers.get('Retry-After') * 1000) || 15000;
					console.log(`Rate limit exceeded, waiting for: ${retryTime} ms`);

					if (retryCount < MAX_RETRY_ATTEMPTS) {
						await new Promise(resolve => setTimeout(resolve, retryTime));
						return this.fetchResource(url, returnType as any, retryCount + 1);
					}
					else throw new Error('Exceeded maximum retry attempts');
				}
			}
			return responseBody;
		}
		catch (e) {
			console.error(`An internal error occurred while trying to fetch '${url}'. Error details: `, e);

			throw e;
		}
	}
}
