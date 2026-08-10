import { OnenotePage, SectionGroup, User, PublicError, Notebook, OnenoteSection } from '@microsoft/microsoft-graph-types';
import { ButtonComponent, DataWriteOptions, Notice, Setting, TFile, TFolder, ObsidianProtocolData, requestUrl, moment } from 'obsidian';
import { genUid, extractErrorMessage, parseHTML, sanitizeFileName } from '../util';
import { DuplicateHandling, FormatImporter } from '../format-importer';
import { selectedNodes } from '../tree';
import { TreePicker, ViewableNode } from '../tree-view';
import { ATTACHMENT_EXTS, AUTH_REDIRECT_URI } from '../constants';
import { ImportContext } from '../import-context';
import { i18n } from '../i18n';
import { AccessTokenResponse } from './onenote/models';
import { convertPageTags, pageToMarkdown } from './onenote/convert';
import { describeNotebookFailure, SCOPE_REFUSED, THROTTLED } from './onenote/errors';
import { requestFailure } from '../request-failure';
import { accountTypeFromToken, authorizationUrl, graphScopes, storedAccountType, TOKEN_URL } from './onenote/auth';
import type { MicrosoftAccountType } from './onenote/auth';
import { inkmlToSvg } from './onenote/inkml';
import { parseFilePath, splitext } from '../filesystem';
import { extensionForMime } from '../mime';

const ACCOUNT_SECRET_ID = 'onenote-importer';
const PREVIOUS_SECRET_ID = 'onenote-importer-refresh-token';
const ACCOUNT_TYPE_STORAGE_KEY = 'onenote-importer-account-type';
function signedOutHint(): string {
	return i18n.importer.onenote.msgSignedOut();
}
const GRAPH_CLIENT_ID: string = '66553851-08fa-44f2-8bb1-1436f121a73d';
// Regex for fixing broken HTML returned by the OneNote API
const SELF_CLOSING_REGEX = /<(object|iframe)([^>]*)\/>/g;
// Maximum amount of request retries, before they're marked as failed. Does not include 429 backoff errors.
const MAX_RETRY_ATTEMPTS = 5;
// Increase spacing after throttling and reduce it after successful downloads.
const ATTACHMENT_SPACING_STEP_MS = 500;
const MAX_ATTACHMENT_SPACING_MS = 3_000;

const BASE64_REGEX = new RegExp(/^data:[\w\d]+\/[\w\d]+;base64,/);

type JSONWrappedResponse<T> = {
	value: T[];
} | {
	'@odata.nextLink': string;
	value: T[];
};

type ResourceType = 'text' | 'file' | 'json' | 'json-wrapped';

type FetchedResource<T> = string | ArrayBuffer | object | JSONWrappedResponse<T>;

function resourceId(contentLocation: string): string {
	try {
		const parts = new URL(contentLocation).pathname.split('/');
		const resources = parts.lastIndexOf('resources');
		return resources >= 0 && parts[resources + 1]
			? decodeURIComponent(parts[resources + 1])
			: contentLocation;
	}
	catch {
		return contentLocation;
	}
}

async function resourceKey(contentLocation: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(resourceId(contentLocation)));
	return Array.from(new Uint8Array(digest).slice(0, 8), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function resourceFilename(filename: string, contentLocation: string): Promise<string> {
	const { basename, extension } = parseFilePath(filename);
	return `${basename} ${await resourceKey(contentLocation)}${extension ? `.${extension}` : ''}`;
}

function sameBytes(left: ArrayBuffer, right: ArrayBuffer): boolean {
	if (left.byteLength !== right.byteLength) return false;

	const a = new Uint8Array(left);
	const b = new Uint8Array(right);
	return a.every((byte, index) => byte === b[index]);
}

function assertUnreachable(x: never): never {
	throw new Error(`Didn't expect to get here`);
}

export function findingNotes(title: string, index: number, sections: number): string {
	return sections > 1
		? i18n.importer.onenote.statusFindingInSection({ section: title, index: index + 1, total: sections })
		: i18n.importer.onenote.statusFindingIn({ section: title });
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
	private organizationButton?: ButtonComponent;
	private picker: TreePicker<OneNoteTreeNode>;
	// Internal
	selectedSections: OneNoteTreeNode[] = [];
	notebooks: Notebook[] = [];
	graphData = {
		state: genUid(32),
		accessToken: '',
	};
	private throttleSpacingMs = 0;
	private readonly sectionPages = new Map<string, OnenotePage[]>();
	private readonly readingAhead = new Map<string, Promise<void>>();
	private readAheadQueue: Promise<void> = Promise.resolve();
	/** Bumped to disown reads that were started against an earlier listing. */
	private pagesGeneration = 0;
	private authenticatingAccountType: MicrosoftAccountType | null = null;
	private attachmentPaths!: Map<string, string>;
	private attachmentOwners!: Map<string, string>;
	private attachmentPathsChanged!: boolean;
	refreshToken?: string;
	lastSuccessfulFetchTime: number = performance.now();

	private get signedIn(): boolean {
		return this.graphData.accessToken !== '';
	}

	get sourceReady(): boolean {
		return this.selectedSections.length > 0;
	}

	private get microsoftAccountType(): MicrosoftAccountType | null {
		return storedAccountType(this.app.loadLocalStorage(ACCOUNT_TYPE_STORAGE_KEY));
	}

	private set microsoftAccountType(value: MicrosoftAccountType | null) {
		this.app.saveLocalStorage(ACCOUNT_TYPE_STORAGE_KEY, value);
	}

	async init() {
		this.attachmentPaths = new Map();
		this.attachmentOwners = new Map();
		this.attachmentPathsChanged = false;

		if (this.host.plugin) {
			const data = await this.host.plugin.loadData();
			for (const [key, path] of Object.entries(data.onenoteAttachments ?? {})) {
				const file = this.vault.getAbstractFileByPath(path);
				const resource = this.attachmentResource(key);
				const owner = file instanceof TFile ? this.attachmentOwner(file.path) : null;
				if (!(file instanceof TFile) || (owner !== null && owner !== resource)) {
					this.attachmentPathsChanged = true;
					continue;
				}

				this.attachmentPaths.set(key, file.path);
				this.attachmentOwners.set(this.attachmentPathKey(file.path), resource);
			}
		}

		this.defaultOutputFolder = 'OneNote';
		this.idProperty = 'onenote-id';
		this.idLabel = i18n.importer.onenote.labelId();

		this.addSetting()
			?.setName(i18n.importer.onenote.nameIncompatible())
			.setDesc(i18n.importer.onenote.descIncompatible())
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
			.setName(i18n.importer.onenote.nameAccount())
			.addButton(button => {
				this.organizationButton = button;
				button
					.setButtonText(i18n.importer.onenote.buttonWorkAccount())
					.onClick(() => {
						this.signOut();
						this.signIn('organization');
					});
				button.buttonEl.hide();
			})
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
		catch (error) {
			const { status, code } = requestFailure(error);
			if (status === 400 || status === 401 || code === 'invalid_grant') {
				this.clearStoredRefreshToken();
				this.refreshToken = undefined;
				this.microsoftAccountType = null;
			}
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
			this.authenticatingAccountType = null;
			console.error('An error occurred while we were trying to sign you in. Error details: ', e);
			this.host.sourceEl?.createDiv({ text: i18n.importer.onenote.msgSignInFailed() })
				.createEl('details', { text: String(e) })
				.createEl('summary', { text: i18n.importer.onenote.msgSignInDetails() });
		}
	}

	private showSignedOut() {
		this.organizationButton?.buttonEl.hide();
		this.accountSetting.setDesc(this.microsoftAccountType === 'organization'
			? i18n.importer.onenote.descSignInOrganization()
			: i18n.importer.onenote.descSignIn());
		this.accountButton.setButtonText(i18n.importer.onenote.buttonSignIn()).setCta();
		this.accountButton.buttonEl.removeClass('mod-destructive');
	}

	async showSignedIn() {
		this.organizationButton?.buttonEl.hide();
		const userData = await this.fetchResource<User>('https://graph.microsoft.com/v1.0/me', 'json');
		this.accountSetting.setDesc(i18n.importer.onenote.descSignedIn({
			name: String(userData.displayName),
			email: String(userData.mail),
		}));
		this.accountButton.setButtonText(i18n.importer.onenote.buttonSignOut()).removeCta();

		this.accountButton.buttonEl.addClass('mod-destructive');
	}

	private signIn(accountType: MicrosoftAccountType = this.microsoftAccountType ?? 'personal') {
		this.registerAuthCallback(data => void this.authenticateUser(data)
			.catch(e => console.error('Could not complete sign in', e)));
		this.authenticatingAccountType = accountType;

		window.open(authorizationUrl(
			this.authenticatingAccountType,
			GRAPH_CLIENT_ID,
			AUTH_REDIRECT_URI,
			this.graphData.state,
		));
	}

	private signOut() {
		this.clearStoredRefreshToken();

		this.graphData.accessToken = '';
		this.refreshToken = undefined;
		this.authenticatingAccountType = null;

		// Whoever signs in next is not necessarily who these belong to, and
		// asking a personal account for the scopes an organization needs is
		// refused before a token comes back to say which kind it was.
		this.microsoftAccountType = null;
		this.forgetSectionPages();

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
			scope: 'offline_access ' + graphScopes(
				code ? this.authenticatingAccountType ?? 'personal' : this.microsoftAccountType ?? 'personal'
			).join(' '),
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
			url: TOKEN_URL,
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
		this.authenticatingAccountType = null;

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
	/** Page lists read against an earlier listing no longer describe the source. */
	private forgetSectionPages(): void {
		this.pagesGeneration++;
		this.sectionPages.clear();
		this.readingAhead.clear();
	}

	async showSectionPickerUI(): Promise<void> {
		if (!this.signedIn) {
			new Notice(signedOutHint());
			return;
		}

		// Reloading the notebooks is the user asking to be told again.
		this.forgetSectionPages();

		try {
			await this.picker.load(() => this.readNotebooks());
		}
		catch (e) {
			// Personal accounts cannot consent to Notes.Read.All, so escalating
			// one leaves it unable to sign in at all.
			if (requestFailure(e).code === SCOPE_REFUSED && this.microsoftAccountType !== 'personal') {
				this.organizationButton?.buttonEl.show();
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
			name: i18n.importer.onenote.nameSections(),
			desc: i18n.importer.onenote.descSections(),
			hint: signedOutHint(),
			loading: i18n.importer.onenote.msgLoadingNotebooks(),
			empty: i18n.importer.onenote.msgNoNotebooks(),
			failed: describeNotebookFailure,
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
			new Notice(i18n.common.msgPickOutput());
			return;
		}

		if (!this.graphData.accessToken) {
			new Notice(i18n.importer.onenote.msgPleaseSignIn());
			return;
		}

		progress.status(i18n.importer.onenote.statusFinding());
		const queue = await this.readSelectedPages(progress);
		if (await progress.shouldStop()) return;

		const progressTotal = queue.length;
		progress.status(i18n.importer.onenote.statusImportingNotes({
			notes: i18n.nouns.noteWithCount({ count: progressTotal }),
		}));
		let progressCurrent = 0;
		let consecutiveFailureCount = 0;

		progress.reportProgress(0, progressTotal);

		for (let i = 0; i < queue.length; i++) {
			if (await progress.shouldStop()) {
				return;
			}

			const page = queue[i];
			if (!page.title) page.title = `Untitled-${moment().format('YYYYMMDDHHmmss')}`;

			progress.status(i18n.common.statusImportingNote({ name: page.title }));

			try {
				const content = await this.fetchResource(`https://graph.microsoft.com/v1.0/me/onenote/pages/${page.id}/content?includeInkML=true`, 'text', progress);
				await this.processFile(progress, content, page);
				consecutiveFailureCount = 0;
			}
			catch (e) {
				progress.reportFailed(page.title, String(e));

				// Page-specific failures do not indicate a broken import environment.
				if (!(e instanceof PageContentError)
					&& (++consecutiveFailureCount > 5 || this.host.abortController.signal.aborted)) {
					progress.status(this.host.abortController.signal.aborted
						? extractErrorMessage(e) ?? String(e)
						: i18n.importer.onenote.msgTooManyErrors());

					for (const remaining of queue.slice(i + 1)) {
						progress.reportSkipped(
							remaining.title ?? i18n.importer.onenote.labelUnknownPage(),
							i18n.importer.onenote.reasonTooManyFailures()
						);
					}

					progress.reportProgress(progressTotal, progressTotal);

					return;
				}
			}

			progress.reportProgress(++progressCurrent, progressTotal);
		}
	}
	private async fetchSectionPages(sectionId: string, progress?: ImportContext): Promise<OnenotePage[]> {
		const params = new URLSearchParams({
			$select: 'id,title,createdDateTime,lastModifiedDateTime,level,order,contentUrl',
			$orderby: 'order',
			pagelevel: 'true',
			// Graph defaults to 20 pages and caps $top at 100.
			$top: '100',
		});

		const url = `https://graph.microsoft.com/v1.0/me/onenote/sections/${sectionId}/pages?${params.toString()}`;
		return (await this.fetchResource<OnenotePage>(url, 'json-wrapped', progress)).value ?? [];
	}

	/** Read selected page lists serially while the remaining settings are completed. */
	private prefetchSelectedPages(): void {
		if (!this.signedIn) return;

		for (const section of this.selectedSections) {
			if (this.sectionPages.has(section.id) || this.readingAhead.has(section.id)) continue;

			const generation = this.pagesGeneration;
			const current = () => generation === this.pagesGeneration;

			const reading = this.readAheadQueue.then(async () => {
				// Recheck after earlier queued reads finish.
				if (!current() || this.sectionPages.has(section.id)) return;
				if (!this.selectedSections.some(selected => selected.id === section.id)) return;

				try {
					const pages = await this.fetchSectionPages(section.id);
					if (current()) this.sectionPages.set(section.id, pages);
				}
				catch {
					// Let the import retry and report the failure.
				}
			});

			this.readAheadQueue = reading;
			// A reload has already emptied the map; deleting would drop its entry.
			this.readingAhead.set(section.id, reading.finally(() => {
				if (current()) this.readingAhead.delete(section.id);
			}));
		}
	}

	/** Read every selected page list before importing so the total stays fixed. */
	private async readSelectedPages(progress: ImportContext): Promise<OnenotePage[]> {
		const queue: OnenotePage[] = [];

		const sections = this.selectedSections;
		for (const [index, section] of sections.entries()) {
			if (await progress.shouldStop()) break;

			progress.status(findingNotes(section.title, index, sections.length));

			await this.readingAhead.get(section.id);
			let pages = this.sectionPages.get(section.id);

			if (!pages) {
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

			this.insertPagesToSection(pages, section.id);
			queue.push(...pages);

			// Grow the remaining total before importing.
			progress.reportProgress(0, queue.length);
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
		const lastModified = page.lastModifiedDateTime ? Date.parse(page.lastModifiedDateTime) : null;
		const created = page.createdDateTime ? Date.parse(page.createdDateTime) : null;
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
				// The drawing was built here, so what is on disk can be compared
				// against it outright rather than guessed at from its name.
				const { path: svgPath, reuse } = await this.placeAttachment(svgFilename, notePath,
					async existing => await this.vault.read(existing) === svgContent ? 'same' : 'another');

				if (reuse) {
					inkEmbedMarkdown = `\n\n![[${reuse.path}]]\n`;
				}
				else {
					await this.writeAttachment(svgPath, svgContent);
					inkEmbedMarkdown = `\n\n![[${svgPath}]]\n`;
					progress.reportAttachmentSuccess(svgFilename);
				}
			}
		}
		catch (e) {
			console.error('Failed to convert InkML to SVG in page:', page.title, e);
			progress.reportFailed(i18n.importer.onenote.labelInk({ page: String(page.title) }), e);
		}

		const html = await this.getAllAttachments(
			progress, convertPageTags(splitContent.html), notePath, lastModified ?? undefined);
		let mdContent = PageContentError.wrapping(() => pageToMarkdown(html));

		if (inkEmbedMarkdown) mdContent += inkEmbedMarkdown;

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
	async getAllAttachments(
		progress: ImportContext, pageHTML: string, notePath: string, sourceMtime?: number
	): Promise<HTMLElement> {
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
				progress.reportFailed(
					i18n.importer.onenote.labelAttachment(),
					i18n.importer.onenote.reasonNoAttachmentName()
				);
				continue;
			}

			const [, extension] = splitext(originalName);
			if (!ATTACHMENT_EXTS.contains(extension) && !this.importIncompatibleAttachments) {
				continue;
			}

			const contentLocation = object.getAttribute('data');
			if (!contentLocation) {
				progress.reportFailed(originalName, i18n.importer.onenote.reasonNoAttachmentUrl());
				continue;
			}

			const filename = await this.fetchAttachment(
				progress, originalName, contentLocation, notePath, sourceMtime);
			if (!filename) continue;

			// Create a new <p> element with the Markdown-style link
			const markdownLink = createEl('p');
			markdownLink.innerText = `![[${filename}]]`;

			// Replace the <object> tag with the new <p> element
			object.parentNode?.replaceChild(markdownLink, object);
		}

		for (let i = 0; i < images.length; i++) {
			const image = images[i];
			const contentLocation = image.getAttribute('data-fullres-src');
			if (!contentLocation) {
				progress.reportFailed(i18n.importer.onenote.labelImage(), i18n.importer.onenote.reasonNoImageUrl());
				continue;
			}

			const extension = extensionForMime(image.getAttribute('data-fullres-src-type') ?? '') || 'png';
			const fileName = `${parseFilePath(notePath).basename} image.${extension}`;
			const outputPath = await this.fetchAttachment(
				progress, fileName, contentLocation, notePath, sourceMtime, true);
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

	async fetchAttachment(
		progress: ImportContext,
		filename: string,
		contentLocation: string,
		notePath: string,
		sourceMtime?: number,
		stableName = false,
	): Promise<string | null> {
		try {
			const outputName = stableName ? await resourceFilename(filename, contentLocation) : filename;
			const attachmentKey = this.attachmentKey(contentLocation, notePath);
			const attachmentResource = resourceId(contentLocation);
			let data: ArrayBuffer | null = null;
			const download = async (): Promise<ArrayBuffer> => {
				if (data !== null) return data;

				if (this.throttleSpacingMs > 0) {
					await new Promise(resolve => window.setTimeout(resolve, this.throttleSpacingMs));
				}

				progress.status(i18n.importer.onenote.statusDownloading({ name: filename }));
				const fetched = await this.fetchResource(contentLocation, 'file', progress);
				data = fetched;
				this.throttleSpacingMs = Math.max(0, this.throttleSpacingMs - ATTACHMENT_SPACING_STEP_MS);
				return fetched;
			};

			if (this.duplicateHandling !== DuplicateHandling.CreateCopy) {
				const mappedPath = this.attachmentPaths.get(attachmentKey);
				if (mappedPath) {
					const mapped = this.vault.getAbstractFileByPath(mappedPath);
					if (mapped instanceof TFile && this.attachmentOwner(mapped.path) === attachmentResource) {
						this.claimPath(mapped.path);
						const stale = sourceMtime !== undefined && sourceMtime > mapped.stat.mtime;
						if (!stale || this.duplicateHandling === DuplicateHandling.Skip) {
							progress.reportSkipped(filename, i18n.reason.alreadyInVault());
							return mapped.path;
						}

						await this.writeAttachment(mapped.path, await download(), { mtime: sourceMtime });
						progress.reportAttachmentSuccess(filename);
						return mapped.path;
					}

					this.forgetAttachment(attachmentKey);
				}
			}

			const { path: outputPath, reuse } = await this.placeAttachment(outputName, notePath, async existing => {
				const owner = this.attachmentOwner(existing.path);
				if (owner && owner !== attachmentResource) return 'another';

				if (stableName && sourceMtime !== undefined) {
					return sourceMtime > existing.stat.mtime ? 'stale' : 'same';
				}

				const downloaded = await download();
				if (downloaded.byteLength !== existing.stat.size) return stableName ? 'stale' : 'another';
				if (sameBytes(await this.vault.readBinary(existing), downloaded)) return 'same';
				return stableName ? 'stale' : 'another';
			});

			if (reuse) {
				this.rememberAttachment(attachmentKey, reuse.path);
				progress.reportSkipped(filename, i18n.reason.alreadyInVault());
				return reuse.path;
			}

			await this.writeAttachment(
				outputPath, await download(), sourceMtime === undefined ? undefined : { mtime: sourceMtime });
			this.rememberAttachment(attachmentKey, outputPath);
			progress.reportAttachmentSuccess(filename);
			return outputPath;
		}
		catch (e) {
			progress.reportFailed(filename, e);
			console.error(e);
			return null;
		}
	}

	private attachmentKey(contentLocation: string, notePath: string): string {
		const { mode, path } = this.attachmentLocation;
		const note = mode === 'note' || mode === 'subfolder' ? notePath : '';
		return [resourceId(contentLocation), mode, path, note].join('\n');
	}

	private attachmentResource(key: string): string {
		const separator = key.indexOf('\n');
		return separator < 0 ? key : key.slice(0, separator);
	}

	private attachmentPathKey(path: string): string {
		return path.toLowerCase();
	}

	private attachmentOwner(path: string): string | null {
		return this.attachmentOwners.get(this.attachmentPathKey(path)) ?? null;
	}

	private forgetAttachment(key: string): void {
		const path = this.attachmentPaths.get(key);
		if (!path) return;

		this.attachmentPaths.delete(key);
		const pathKey = this.attachmentPathKey(path);
		if (![...this.attachmentPaths.values()].some(other => this.attachmentPathKey(other) === pathKey)) {
			this.attachmentOwners.delete(pathKey);
		}
		this.attachmentPathsChanged = true;
	}

	private rememberAttachment(key: string, path: string): void {
		const resource = this.attachmentResource(key);
		const owner = this.attachmentOwner(path);
		if (this.attachmentPaths.get(key) === path && owner === resource) return;
		if (owner && owner !== resource) {
			throw new Error(`Attachment path is already owned by another OneNote resource: ${path}`);
		}

		this.forgetAttachment(key);
		this.attachmentPaths.set(key, path);
		this.attachmentOwners.set(this.attachmentPathKey(path), resource);
		this.attachmentPathsChanged = true;
	}

	async finalizeMarkdownOutput(ctx?: ImportContext): Promise<void> {
		await super.finalizeMarkdownOutput(ctx);
		if (!this.attachmentPathsChanged || !this.host.plugin) return;

		try {
			const data = await this.host.plugin.loadData();
			data.onenoteAttachments = Object.fromEntries(this.attachmentPaths);
			await this.host.plugin.saveData(data);
			this.attachmentPathsChanged = false;
		}
		catch (error) {
			console.error('Could not save OneNote attachment identities', error);
		}
	}

	async fetchResource<T = string>(url: string, returnType: 'text', progress?: ImportContext): Promise<T>;
	async fetchResource<T = ArrayBuffer>(url: string, returnType: 'file', progress?: ImportContext): Promise<T>;
	async fetchResource<T>(url: string, returnType: 'json', progress?: ImportContext): Promise<T>;
	async fetchResource<T>(url: string, returnType: 'json-wrapped', progress?: ImportContext): Promise<JSONWrappedResponse<T>>;
	async fetchResource<T>(url: string, returnType: ResourceType, progress?: ImportContext): Promise<FetchedResource<T>> {
		return this.fetchWithRetry<T>(url, returnType, progress, 0, false);
	}

	/** `retryCount` and `refreshed` are what one attempt hands the next. */
	private async fetchWithRetry<T>(url: string, returnType: ResourceType, progress: ImportContext | undefined, retryCount: number, refreshed: boolean): Promise<FetchedResource<T>> {
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
					headers: {
						Authorization: `Bearer ${this.graphData.accessToken}`,
					},
					signal: this.host.abortController.signal,
				}
			);

			if (response.ok) {
				let result: FetchedResource<T>;

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
					return this.fetchWithRetry<T>(url, returnType, progress, retryCount + 1, true);
				}

				// We're rate-limited - let's retry after the suggested amount of time
				if (err?.code === THROTTLED || response.status === 429) {
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

					return this.fetchWithRetry<T>(
						url,
						returnType,
						progress,
						// don't increment the retryCount because we were told
						// to backoff, and we should infinitely retry on backoff
						// errors.
						retryCount,
						refreshed
					);
				}

				// A refusal, or a refused scope, will not change on retry — but
				// OneNote does return transient bare 400s for page requests.
				const settled = response.status === 403 || response.status === 404
					|| err?.code === SCOPE_REFUSED;
				if (settled || retryCount + 1 >= MAX_RETRY_ATTEMPTS) {
					throw new GraphRefusal(response.status, err);
				}

				return this.fetchWithRetry<T>(url, returnType, progress, retryCount + 1, refreshed);
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

			return this.fetchWithRetry<T>(url, returnType, progress, retryCount + 1, refreshed);
		}
	}
}
