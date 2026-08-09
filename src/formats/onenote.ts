import { OnenotePage, SectionGroup, User, PublicError, Notebook, OnenoteSection } from '@microsoft/microsoft-graph-types';
import { ButtonComponent, DataWriteOptions, Notice, Setting, TFolder, ObsidianProtocolData, requestUrl, moment } from 'obsidian';
import { genUid, extractErrorMessage, parseHTML, plural, sanitizeFileName } from '../util';
import { FormatImporter } from '../format-importer';
import { selectedNodes } from '../tree';
import { TreePicker, ViewableNode } from '../tree-view';
import { ATTACHMENT_EXTS, AUTH_REDIRECT_URI } from '../constants';
import { ImportContext } from '../import-context';
import { AccessTokenResponse } from './onenote/models';
import { convertPageTags, pageToMarkdown } from './onenote/convert';
import { describeNotebookFailure } from './onenote/errors';
import { requestFailure } from '../request-failure';
import { accountType, accountTypeFromToken, authorizationUrl, graphScopes, tokenUrl } from './onenote/auth';
import type { MicrosoftAccountType } from './onenote/auth';
import { inkmlToSvg } from './onenote/inkml';

const ACCOUNT_SECRET_ID = 'onenote-importer';
const PREVIOUS_SECRET_ID = 'onenote-importer-refresh-token';
const ACCOUNT_TYPE_STORAGE_KEY = 'onenote-importer-account-type';
const SIGNED_OUT_HINT = 'Sign in to see your OneNote notebooks.';
const GRAPH_CLIENT_ID: string = '66553851-08fa-44f2-8bb1-1436f121a73d';
// Regex for fixing broken HTML returned by the OneNote API
const SELF_CLOSING_REGEX = /<(object|iframe)([^>]*)\/>/g;
// Maximum amount of request retries, before they're marked as failed. Does not include 429 backoff errors.
const MAX_RETRY_ATTEMPTS = 5;
// How much each throttled request slows attachment downloads, and how far that
// can go. One step is given back for every attachment that comes down cleanly.
const ATTACHMENT_SPACING_STEP_MS = 500;
const MAX_ATTACHMENT_SPACING_MS = 3_000;

const BASE64_REGEX = new RegExp(/^data:[\w\d]+\/[\w\d]+;base64,/);

type JSONWrappedResponse<T> = {
	value: T[];
} | {
	'@odata.nextLink': string;
	value: T[];
};

function assertUnreachable(x: never): never {
	throw new Error(`Didn't expect to get here`);
}

function worthRetrying(status: number): boolean {
	// OneNote sometimes returns transient bare 400s for page requests.
	return status !== 403 && status !== 404;
}

/**
 * A failure caused by one page's content rather than the import environment.
 * Only these are kept out of the consecutive-failure stop, which exists to
 * catch whatever is about to fail every remaining page the same way.
 */
class PageContentError extends Error {
	constructor(cause: unknown) {
		super(extractErrorMessage(cause) ?? String(cause));
	}

	static wrapping<T>(convert: () => T): T {
		try {
			return convert();
		}
		catch (e) {
			throw new PageContentError(e);
		}
	}
}

class GraphRefusal extends Error {
	readonly status: number;
	readonly code?: string;

	constructor(status: number, err: PublicError | null) {
		super(err?.message || `OneNote returned ${status}`);
		this.status = status;
		this.code = err?.code ?? undefined;
	}
}

function assertJSONWrappedResponse<T>(res: unknown): asserts res is JSONWrappedResponse<T> {
	if (res == null) {
		throw new Error(`response is nullish`);
	}
	if (typeof res !== 'object') {
		throw new Error(`response is not an object type`);
	}

	if ('@odata.nextLink' in res) {
		const link = (res as Record<string, unknown>)['@odata.nextLink']; // cast only required because TS version is old
		if (typeof link !== 'string') {
			throw new Error(`Link of unknown type: ${typeof link}`);
		}
	}

	if (!('value' in res)) {
		throw new Error(`Expected response to have a 'value' property`);
	}

	// cast only required because TS version is old
	if (!Array.isArray((res as Record<string, unknown>).value)) {
		throw new Error(`Expected response to have an error in 'value' property`);
	}
}

interface OneNoteTreeNode extends ViewableNode<OneNoteTreeNode> {
	id: string;
	type: 'notebook' | 'group' | 'section';
	collapsed: boolean;
	children: OneNoteTreeNode[];
}

export class OneNoteImporter extends FormatImporter {
	interruption = 'pause' as const;

	// Settings
	importIncompatibleAttachments: boolean = false;
	// UI
	accountSetting: Setting;
	private accountButton: ButtonComponent;
	private picker: TreePicker<OneNoteTreeNode>;
	// Internal
	selectedSections: OneNoteTreeNode[] = [];
	notebooks: Notebook[] = [];
	graphData = {
		state: genUid(32),
		accessToken: '',
	};
	/**
	 * How long to leave between attachment downloads, which is nothing until
	 * OneNote actually throttles. A fixed pause every few attachments spent the
	 * same minutes whether or not anything was rate limiting, and on a notebook
	 * with hundreds of attachments that was most of the import.
	 */
	private throttleSpacingMs = 0;
	/** Page lists read ahead of the import, by section id. */
	private readonly sectionPages = new Map<string, OnenotePage[]>();
	private prefetching: Promise<void> = Promise.resolve();
	refreshToken?: string;
	lastSuccessfulFetchTime: number = performance.now();

	private get signedIn(): boolean {
		return this.graphData.accessToken !== '';
	}

	get sourceReady(): boolean {
		return this.selectedSections.length > 0;
	}

	private get microsoftAccountType(): MicrosoftAccountType {
		return accountType(this.app.loadLocalStorage(ACCOUNT_TYPE_STORAGE_KEY));
	}

	private get knownAccountType(): MicrosoftAccountType | null {
		const stored: unknown = this.app.loadLocalStorage(ACCOUNT_TYPE_STORAGE_KEY);
		return stored === 'organization' || stored === 'personal' ? stored : null;
	}

	private set microsoftAccountType(value: MicrosoftAccountType) {
		this.app.saveLocalStorage(ACCOUNT_TYPE_STORAGE_KEY, value);
	}

	async init() {
		this.defaultOutputFolder = 'OneNote';
		this.idProperty = 'onenote-id';
		this.idLabel = 'OneNote ID';

		this.addSetting()
			?.setName('Import incompatible attachments')
			.setDesc('Imports incompatible attachments which cannot be embedded in Obsidian, such as .exe files.')
			.addToggle((toggle) => toggle
				.setValue(false)
				.onChange((value) => (this.importIncompatibleAttachments = value))
			);

		const contentEl = this.host.sourceEl;
		if (!contentEl) {
			await this.signInWithStoredToken();
			return;
		}

		this.accountSetting = new Setting(contentEl)
			.setName('Microsoft account')
			.addButton((button) => {
				this.accountButton = button;
				button.onClick(() => {
					if (this.signedIn) this.signOut();
					else this.signIn();
				});
			});

		this.drawSectionPicker(contentEl);

		this.showSignedOut();

		if (await this.signInWithStoredToken()) {
			await this.showSignedIn();
			await this.showSectionPickerUI();
		}
	}

	private async signInWithStoredToken(): Promise<boolean> {
		if (!this.retrieveRefreshToken()) return false;

		try {
			await this.updateAccessToken();
			return true;
		}
		catch {
			return false;
		}
	}

	async authenticateUser(protocolData: ObsidianProtocolData) {
		try {
			if (protocolData['state'] !== this.graphData.state) {
				throw new Error(`An incorrect state was returned.\nExpected state: ${this.graphData.state}\nReturned state: ${protocolData['state']}`);
			}

			await this.updateAccessToken(protocolData['code']);
			await this.showSignedIn();
			await this.showSectionPickerUI();
		}
		catch (e) {
			console.error('An error occurred while we were trying to sign you in. Error details: ', e);
			this.host.sourceEl?.createDiv({ text: 'An error occurred while trying to sign you in.' })
				.createEl('details', { text: String(e) })
				.createEl('summary', { text: 'Click here to show error details' });
		}
	}

	private showSignedOut() {
		this.accountSetting.setDesc(this.microsoftAccountType === 'organization'
			? 'Sign in to import your OneNote notebooks. A work or school account may need your organization to approve access.'
			: 'Sign in to import your OneNote notebooks.');
		this.accountButton.setButtonText('Sign in').setCta();
		this.accountButton.buttonEl.removeClass('mod-destructive');
	}

	async showSignedIn() {
		const userData = await this.fetchResource<User>('https://graph.microsoft.com/v1.0/me', 'json');
		this.accountSetting.setDesc(`Signed in as ${userData.displayName} (${userData.mail}).`);
		this.accountButton.setButtonText('Sign out').removeCta();

		this.accountButton.buttonEl.addClass('mod-destructive');
	}

	private signIn() {
		this.registerAuthCallback(data => void this.authenticateUser(data)
			.catch(e => console.error('Could not complete sign in', e)));

		window.open(authorizationUrl(
			this.microsoftAccountType,
			GRAPH_CLIENT_ID,
			AUTH_REDIRECT_URI,
			this.graphData.state,
		));
	}

	private signOut() {
		this.clearStoredRefreshToken();

		this.graphData.accessToken = '';
		this.refreshToken = undefined;

		// Whoever signs in next is not necessarily who these belong to.
		this.sectionPages.clear();

		this.picker.reset();

		this.showSignedOut();
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
			scope: 'offline_access ' + graphScopes(this.microsoftAccountType).join(' '),
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
			url: tokenUrl(),
			contentType: 'application/x-www-form-urlencoded',
			body: requestBody.toString(),
		}).json;

		if (!tokenResponse.access_token) {
			throw new Error(`Unexpected data was returned instead of an access token. Error details: ${JSON.stringify(tokenResponse)}`);
		}

		if (tokenResponse.refresh_token) {
			this.storeRefreshToken(tokenResponse.refresh_token);
		}

		const detected = accountTypeFromToken(tokenResponse.id_token ?? tokenResponse.access_token);
		if (detected) this.microsoftAccountType = detected;

		this.graphData.accessToken = tokenResponse.access_token;
		this.sourceChanged();
	}

	private storeRefreshToken(refreshToken: string) {
		this.refreshToken = refreshToken;
		this.app.secretStorage.setSecret(ACCOUNT_SECRET_ID, refreshToken);
	}

	private retrieveRefreshToken(): string | null {
		if (this.refreshToken) {
			return this.refreshToken;
		}

		const stored = this.app.secretStorage.getSecret(ACCOUNT_SECRET_ID);
		if (stored) return stored;

		const previous = this.app.secretStorage.getSecret(PREVIOUS_SECRET_ID);
		if (previous) {
			this.app.secretStorage.setSecret(ACCOUNT_SECRET_ID, previous);
			this.app.secretStorage.deleteSecret(PREVIOUS_SECRET_ID);
		}

		return previous;
	}

	private clearStoredRefreshToken() {
		this.app.secretStorage.deleteSecret(ACCOUNT_SECRET_ID);
	}
	async showSectionPickerUI(): Promise<void> {
		if (!this.signedIn) {
			new Notice(SIGNED_OUT_HINT);
			return;
		}

		try {
			await this.picker.load(() => this.readNotebooks());
		}
		catch (e) {
			// Personal accounts cannot consent to Notes.Read.All, so escalating
			// one leaves it unable to sign in at all.
			if (requestFailure(e).code === '40004' && this.knownAccountType !== 'personal') {
				this.microsoftAccountType = 'organization';
			}

			console.error('An error occurred while fetching your OneNote data: ', e);
		}
	}

	private async readNotebooks(): Promise<OneNoteTreeNode[]> {
		const baseUrl = 'https://graph.microsoft.com/v1.0/me/onenote/notebooks';

		// Fetch the sections & section groups directly under the notebook
		const params = new URLSearchParams({
			$expand: 'sections($select=id,displayName),sectionGroups($expand=sections,sectionGroups)',
			$select: 'id,displayName,lastModifiedDateTime',
			$orderby: 'lastModifiedDateTime DESC',
		});

		this.notebooks = (await this.fetchResource<Notebook>(`${baseUrl}?${params.toString()}`, 'json-wrapped')).value;

		for (const notebook of this.notebooks) {
			if (notebook.sectionGroups?.length !== 0) {
				for (const sectionGroup of notebook.sectionGroups!) {
					await this.fetchNestedSectionGroups(sectionGroup);
				}
			}
		}

		return this.notebooks.map(notebook => this.treeNode(
			notebook.id!, notebook.displayName!, 'notebook', this.childNodes(notebook)
		));
	}

	private drawSectionPicker(contentEl: HTMLElement): void {
		this.picker = new TreePicker<OneNoteTreeNode>(contentEl, {
			name: 'Sections to import',
			desc: 'Select a notebook, or sections within it.',
			hint: SIGNED_OUT_HINT,
			loading: 'Loading notebooks...',
			empty: 'No notebooks found.',
			failed: error => describeNotebookFailure(error),
			view: {
				icon: node => node.type === 'notebook' ? 'book' : node.type === 'group' ? 'folder' : 'file',
			},
			onChange: () => {
				this.selectedSections = selectedNodes(this.picker.nodes, node => node.type === 'section');
				this.prefetchSelectedPages();
				this.sourceChanged();
			},
		});

		this.picker.onLoad(() => void this.showSectionPickerUI());
	}

	private treeNode(id: string, title: string, type: OneNoteTreeNode['type'], children: OneNoteTreeNode[]): OneNoteTreeNode {
		return { id, title, type, selected: false, disabled: false, collapsed: false, children };
	}

	private childNodes(entity: Notebook | SectionGroup): OneNoteTreeNode[] {
		const groups = (entity.sectionGroups ?? []).map(group =>
			this.treeNode(group.id!, group.displayName!, 'group', this.childNodes(group)));

		const sections = (entity.sections ?? []).map(section =>
			this.treeNode(section.id!, section.displayName!, 'section', []));

		return [...groups, ...sections];
	}
	async fetchNestedSectionGroups(parentGroup: SectionGroup) {
		parentGroup.sectionGroups = (await this.fetchResource<SectionGroup>(parentGroup.sectionGroupsUrl + '?$expand=sectionGroups($expand=sections),sections', 'json-wrapped')).value;

		if (parentGroup.sectionGroups) {
			for (let i = 0; i < parentGroup.sectionGroups.length; i++) {
				await this.fetchNestedSectionGroups(parentGroup.sectionGroups[i]);
			}
		}
	}
	async import(progress: ImportContext): Promise<void> {
		const outputFolder = await this.getOutputFolder();
		if (!outputFolder) {
			new Notice('Please select a location to export to.');
			return;
		}

		if (!this.graphData.accessToken) {
			new Notice('Please sign in to your Microsoft account.');
			return;
		}

		progress.status('Finding notes to import');
		const queue = await this.readSelectedPages(progress);
		if (await progress.shouldStop()) return;

		const progressTotal = queue.length;
		progress.status(`Importing ${plural(progressTotal, 'note')}`);
		let progressCurrent = 0;
		let consecutiveFailureCount = 0;

		progress.reportProgress(0, progressTotal);

		for (let i = 0; i < queue.length; i++) {
			if (await progress.shouldStop()) {
				return;
			}

			const page = queue[i];
			if (!page.title) page.title = `Untitled-${moment().format('YYYYMMDDHHmmss')}`;

			progress.status(`Importing note ${page.title}`);

			let failure: unknown = null;
			try {
				const content = await this.fetchResource(`https://graph.microsoft.com/v1.0/me/onenote/pages/${page.id}/content?includeInkML=true`, 'text', progress);
				await this.processFile(progress, content, page);
			}
			catch (e) {
				failure = e;
				progress.reportFailed(page.title, String(e));
			}

			if (!failure) {
				consecutiveFailureCount = 0;
			}
			// Page-specific failures do not indicate a broken import environment.
			else if (!(failure instanceof PageContentError)) {
				consecutiveFailureCount++;

				if (consecutiveFailureCount > 5 || this.host.abortController.signal.aborted) {
					const e = failure;
					const status = this.host.abortController.signal.aborted
						// The import was aborted
						? extractErrorMessage(e) ?? String(e)
						// Hit a string of consecutive failures, so something is
						// wrong. This is NOT related to rate-limiting, as that
						// is handled by the retry logic.
						: 'Microsoft OneNote returned too many consecutive errors.';
					progress.status(status);

					// Report remaining pages as skipped
					for (let j = i + 1; j < queue.length; j++) {
						const remainingPage = queue[j];
						progress.reportSkipped(
							remainingPage.title ?? '<unknown>',
							'import was canceled (after too many pages failed to load)'
						);
					}

					// Report progress as complete
					progress.reportProgress(progressTotal, progressTotal);

					return;
				}
			}

			// report progress even if page import fails or is skipped
			progress.reportProgress(++progressCurrent, progressTotal);
		}
	}
	private async fetchSectionPages(sectionId: string, progress?: ImportContext): Promise<OnenotePage[]> {
		const params = new URLSearchParams({
			$select: 'id,title,createdDateTime,lastModifiedDateTime,level,order,contentUrl',
			$orderby: 'order',
			pagelevel: 'true',
			// OneNote sends 20 pages at a time unless asked otherwise, and caps
			// this at 100. A section of 500 is 5 requests rather than 25.
			$top: '100',
		});

		const url = `https://graph.microsoft.com/v1.0/me/onenote/sections/${sectionId}/pages?${params.toString()}`;
		return (await this.fetchResource<OnenotePage>(url, 'json-wrapped', progress)).value ?? [];
	}

	/**
	 * Start reading the page lists for whatever is selected, so that the wait
	 * happens while the output and options steps are being filled in rather
	 * than after Import is pressed. The import needs these lists regardless, so
	 * nothing here is speculative work — only work moved earlier.
	 *
	 * One section at a time, because a notebook selected all at once would
	 * otherwise open dozens of parallel requests at the API most likely to
	 * throttle them. Failures are left for the import to hit and report.
	 */
	private prefetchSelectedPages(): void {
		if (!this.signedIn) return;

		for (const section of this.selectedSections) {
			if (this.sectionPages.has(section.id)) continue;

			this.prefetching = this.prefetching.then(async () => {
				// Both may have changed while this waited its turn.
				if (this.sectionPages.has(section.id)) return;
				if (!this.selectedSections.some(selected => selected.id === section.id)) return;

				try {
					this.sectionPages.set(section.id, await this.fetchSectionPages(section.id));
				}
				catch {
					// Left uncached, so the import asks again and reports it there.
				}
			});
		}
	}

	/**
	 * Every page in every chosen section, read before any of them is imported.
	 *
	 * The same requests either way — one page list per section — but having
	 * them all is what lets the progress bar know the real total. Counting as
	 * it went meant the bar filled up on the first section and then jumped
	 * backwards each time another one was opened.
	 */
	private async readSelectedPages(progress: ImportContext): Promise<OnenotePage[]> {
		const queue: OnenotePage[] = [];

		// Anything still being read ahead is about to be needed.
		await this.prefetching;

		const sections = this.selectedSections;
		for (const [index, section] of sections.entries()) {
			if (await progress.shouldStop()) break;

			let pages = this.sectionPages.get(section.id);
			if (!pages) {
				const position = sections.length > 1 ? ` (section ${index + 1} of ${sections.length})` : '';
				progress.status(`Finding notes in ${section.title}${position}`);

				try {
					pages = await this.fetchSectionPages(section.id, progress);
				}
				catch (e) {
					console.error(`Failed to fetch pages for section ${section.id}, skipping to next section.`, e);
					progress.reportFailed(section.title, e);
					continue;
				}
			}

			if (!pages.length) continue;

			// Sub-page paths are worked out from the pages either side of one
			// within its section, so the section needs its whole list.
			this.insertPagesToSection(pages, section.id);
			queue.push(...pages);
		}

		return queue;
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
		const splitContent = PageContentError.wrapping(() => this.convertFormat(content));
		const outputFolder = await this.getOutputFolder();
		const outputPath = this.getEntityPathNoParent(page.id!, outputFolder!.name)!;

		let pageFolder: TFolder;
		if (!await this.vault.adapter.exists(outputPath)) {
			pageFolder = await this.vault.createFolder(outputPath);
		}
		else {
			const existing = this.vault.getAbstractFileByPath(outputPath);
			if (!(existing instanceof TFolder)) throw new Error(`${outputPath} is not a folder`);
			pageFolder = existing;
		}
		const notePath = `${pageFolder.path}/${sanitizeFileName(page.title)}.md`;

		let inkEmbedMarkdown = '';
		try {
			const svgContent = inkmlToSvg(splitContent.inkml);
			if (svgContent) {
				const svgFilename = `${page.title} - Ink.svg`;
				const svgPath = await this.getAvailablePathForAttachment(svgFilename, [], notePath);
				await this.vault.create(svgPath, svgContent);
				inkEmbedMarkdown = `\n\n![[${svgPath}]]\n`;
				progress.reportAttachmentSuccess(svgFilename);
			}
		}
		catch (e) {
			console.error('Failed to convert InkML to SVG in page:', page.title, e);
			progress.reportFailed(`${page.title} - Ink.svg`, e);
		}

		const html = await this.getAllAttachments(progress, convertPageTags(splitContent.html), notePath);
		let mdContent = PageContentError.wrapping(() => pageToMarkdown(html));

		if (inkEmbedMarkdown) mdContent += inkEmbedMarkdown;

		const lastModified = page?.lastModifiedDateTime ? Date.parse(page.lastModifiedDateTime) : null;
		const created = page?.createdDateTime ? Date.parse(page.createdDateTime) : null;
		const writeOptions: DataWriteOptions = {
			ctime: created ?? lastModified ?? Date.now(),
			mtime: lastModified ?? created ?? Date.now(),
		};
		const { written } = await this.writeNote(progress, pageFolder, page.title!, mdContent, { ...writeOptions, sourceId: page.id });
		if (written) progress.reportNoteSuccess(page.title!);
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

	getEntityPathNoParent(entityID: string, currentPath: string): string | null {
		for (const notebook of this.notebooks) {
			const sanitizedName = sanitizeFileName(notebook.displayName || 'Untitled Notebook');
			const path = this.getEntityPath(entityID, `${currentPath}/${sanitizedName}`, notebook);
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
						const sanitizedName = sanitizeFileName(page.title);
						returnPath = `${currentPath}/${sanitizedName}`;
					}
					else returnPath = currentPath;
				}
				else {
					returnPath = currentPath;

					// Iterate backward to find the parent page
					for (let i = section.pages!.indexOf(page) - 1; i >= 0; i--) {
						if (section.pages![i].level === page.level! - 1) {
							const sanitizedName = sanitizeFileName(section.pages![i].title);
							returnPath += '/' + sanitizedName;
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
			const sanitizedName = sanitizeFileName(sectionGroup.displayName);
			if (sectionGroup.id === entityID) returnPath = `${currentPath}/${sanitizedName}`;
			else {
				const foundPath = this.getEntityPath(entityID, `${currentPath}/${sanitizedName}`, sectionGroup);
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
		// Only keep word characters, digits, spaces, and basic punctuation.
		text = text.replace(/[^\w\d\s.,!?]/g, '');

		// Replace multiple spaces with single space and trim
		text = text.replace(/\s+/g, ' ').trim();

		// Truncate to a reasonable length
		if (text.length > 50) {
			text = text.substring(0, 50) + '...';
		}

		return text;
	}

	// Download all attachments and add embedding syntax for supported file formats.
	async getAllAttachments(progress: ImportContext, pageHTML: string, notePath: string): Promise<HTMLElement> {
		const pageElement = parseHTML(pageHTML.replace(SELF_CLOSING_REGEX, '<$1$2></$1>'));

		const objects: HTMLElement[] = pageElement.findAll('object');
		const images: HTMLImageElement[] = pageElement.findAll('img') as HTMLImageElement[];
		// Online videos are implemented as iframes, normal videos are just <object>s
		const videos: HTMLIFrameElement[] = pageElement.findAll('iframe') as HTMLIFrameElement[];

		for (const object of objects) {
			const next = object.nextSibling;
			while (object.firstChild) {
				object.parentNode?.insertBefore(object.firstChild, next);
			}

			const originalName = object.getAttribute('data-attachment');
			if (!originalName) {
				progress.reportFailed('OneNote attachment', 'the attachment did not say what it was called');
				continue;
			}

			const extension = originalName.split('.').pop()?.toLowerCase() ?? '';
			if (!ATTACHMENT_EXTS.contains(extension) && !this.importIncompatibleAttachments) {
				continue;
			}

			const contentLocation = object.getAttribute('data');
			if (!contentLocation) {
				progress.reportFailed(originalName, 'the attachment did not include a download URL');
				continue;
			}

			{
				const filename = await this.fetchAttachment(progress, originalName, contentLocation, notePath);
				if (!filename) continue;

				// Create a new <p> element with the Markdown-style link
				const markdownLink = createEl('p');
				markdownLink.innerText = `![[${filename}]]`;

				// Replace the <object> tag with the new <p> element
				object.parentNode?.replaceChild(markdownLink, object);
			}
		}

		for (let i = 0; i < images.length; i++) {
			const image = images[i];
			const contentLocation = image.getAttribute('data-fullres-src');
			if (!contentLocation) {
				progress.reportFailed('OneNote image', 'the image did not include a download URL');
				continue;
			}

			const extension = image.getAttribute('data-fullres-src-type')?.split('/')[1] ?? 'png';
			const currentDate = moment().format('YYYYMMDDHHmmss');
			const fileName: string = `Exported image ${currentDate}-${i}.${extension}`;
			const outputPath = await this.fetchAttachment(progress, fileName, contentLocation, notePath);
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
				const embedNode = video.doc.createTextNode(`![Embedded YouTube video](${video.src})`);
				video.parentNode?.replaceChild(embedNode, video);
			}
			else {
				// If it's any other website, convert to a basic link
				const linkNode = createEl('a');
				linkNode.href = video.src;
				video.parentNode?.replaceChild(linkNode, video);
			}
		}

		return pageElement;
	}

	async fetchAttachment(progress: ImportContext, filename: string, contentLocation: string, notePath: string): Promise<string | null> {
		if (this.throttleSpacingMs > 0) {
			await new Promise(resolve => window.setTimeout(resolve, this.throttleSpacingMs));
		}

		progress.status('Downloading attachment ' + filename);

		try {
			// We don't need to remember claimedPaths because we're writing the attachments immediately.
			const outputPath = await this.getAvailablePathForAttachment(filename, [], notePath);
			const data = (await this.fetchResource(contentLocation, 'file', progress));
			await this.app.vault.createBinary(outputPath, data);
			progress.reportAttachmentSuccess(filename);

			// Earn the speed back once it stops complaining.
			this.throttleSpacingMs = Math.max(0, this.throttleSpacingMs - ATTACHMENT_SPACING_STEP_MS);
			return outputPath;
		}
		catch (e) {
			progress.reportFailed(filename, e);
			console.error(e);
			return null;
		}
	}

	async fetchResource<T = string>(url: string, returnType: 'text', progress?: ImportContext, retryCount?: number, refreshed?: boolean): Promise<T>;
	async fetchResource<T = ArrayBuffer>(url: string, returnType: 'file', progress?: ImportContext, retryCount?: number, refreshed?: boolean): Promise<T>;
	async fetchResource<T>(url: string, returnType: 'json', progress?: ImportContext, retryCount?: number, refreshed?: boolean): Promise<T>;
	async fetchResource<T>(url: string, returnType: 'json-wrapped', progress?: ImportContext, retryCount?: number, refreshed?: boolean): Promise<JSONWrappedResponse<T>>;
	async fetchResource<T>(url: string, returnType: 'text' | 'file' | 'json' | 'json-wrapped', progress?: ImportContext, retryCount: number = 0, refreshed: boolean = false): Promise<string | ArrayBuffer | object | JSONWrappedResponse<T>> {
		// Check if we need to reject early WITHOUT retrying, outside the
		// try/catch block
		if (retryCount >= MAX_RETRY_ATTEMPTS) {
			// fail fetching this resource
			throw new Error('Exceeded maximum retry attempts');
		}

		const timeSinceLastFetch = performance.now() - this.lastSuccessfulFetchTime;
		const ninetyMinutesInMS = 1_000 * 60 * 90;
		if (timeSinceLastFetch > ninetyMinutesInMS) {
			// fail the entire import by aborting
			this.host.abortController.abort('stalled for >90 minutes');
		}

		if (this.host.abortController.signal.aborted) {
			const abortReason = this.host.abortController.signal.reason ?? 'no reason given';
			throw new Error(`The import was aborted (${abortReason})`);
		}

		try {
			// This request must be abortable; requestUrl has no AbortSignal support.
			let response = await fetch(
				url,
				{
					headers: { Authorization: `Bearer ${this.graphData.accessToken}` },
					signal: this.host.abortController.signal,
				}
			);

			if (response.ok) {
				let result: string | ArrayBuffer | object | JSONWrappedResponse<T>;

				switch (returnType) {
					case 'text':
						result = await response.text();
						break;
					case 'file':
						result = await response.arrayBuffer();
						break;
					case 'json':
						result = await response.json();
						break;
					case 'json-wrapped':
						result = await response.json();
						assertJSONWrappedResponse<T>(result);
						if ('@odata.nextLink' in result) {
							result.value.push(...(await this.fetchResource<T>(result['@odata.nextLink'], 'json-wrapped', progress)).value);
						}
						break;
					default:
						assertUnreachable(returnType);
				}

				this.lastSuccessfulFetchTime = performance.now();
				return result;
			}
			else {
				let err: PublicError | null = null;
				// Graph error bodies may be empty or non-JSON.
				const respJson: unknown = await response.json().catch(() => null);
				if (respJson && typeof respJson === 'object' && 'error' in respJson) {
					err = (respJson as { error: PublicError }).error;
				}
				console.error('An error has occurred while fetching an resource:', err ? err : respJson);

				// If our access token has expired, becomes invalid, or is
				// otherwise no longer authorized, then refresh it and try
				// again.
				const isNotAuthorized = err?.code === '40001'
					|| err?.code === 'InvalidAuthenticationToken'
					|| response.status === 401;
				if (isNotAuthorized) {
					if (refreshed) throw new GraphRefusal(response.status, err);

					await this.updateAccessToken();
					return this.fetchResource(url, returnType as any, progress, retryCount + 1, true);
				}

				// We're rate-limited - let's retry after the suggested amount of time
				if (err?.code === '20166' || response.status === 429) {
					this.throttleSpacingMs = Math.min(
						MAX_ATTACHMENT_SPACING_MS,
						this.throttleSpacingMs + ATTACHMENT_SPACING_STEP_MS,
					);

					// Imports can wait; picker loads should fail visibly.
					if (!progress) throw new GraphRefusal(429, err);

					const retryAfter = response.headers.get('Retry-After');
					// If we're rate-limited, the soonest we'll be able to make
					// the request again is the next minute, so wait either as
					// long as the API tells us to (with the Retry-After header)
					// or wait 1 minute. Note: the OneNote API does not
					// currently ever provide the Retry-After header. See
					// https://learn.microsoft.com/en-us/graph/throttling-limits#onenote-service-limits
					// for more info.
					let retryTimeSeconds = retryAfter ? (+retryAfter * 1) : 60;
					console.warn(`Rate limit exceeded, waiting for: ${retryTimeSeconds} seconds`);
					await this.backOff(
						retryTimeSeconds,
						'rate limited by OneNote',
						progress,
					);

					return this.fetchResource(
						url,
						returnType as any,
						progress,
						// don't increment the retryCount because we were told
						// to backoff, and we should infinitely retry on backoff
						// errors.
						retryCount,
						refreshed
					);
				}

				// A scope refusal will not change on retry.
				const settled = !worthRetrying(response.status) || err?.code === '40004';
				if (settled || retryCount + 1 >= MAX_RETRY_ATTEMPTS) {
					throw new GraphRefusal(response.status, err);
				}

				return this.fetchResource(url, returnType as any, progress, retryCount + 1, refreshed);
			}
		}
		catch (e) {
			if (e instanceof GraphRefusal) throw e;

			console.error(`An internal error occurred while trying to fetch '${url}'. Error details: `, e);

			// Attachments sometimes just fail to download
			// (`net::ERR_TIMED_OUT`) which will cause the `fetch` itself to
			// reject. Normally you would want to hard-fail (rethrow) in those
			// cases (e.g. the fetch itself must be bad in some way), but since
			// I'm seeing such failures in normal imports where I'm not noticing
			// any network instability on my end, let's retry those failures as
			// well.
			if (retryCount + 1 >= MAX_RETRY_ATTEMPTS) throw e;

			return this.fetchResource(url, returnType as any, progress, retryCount + 1, refreshed);
		}
	}
}
