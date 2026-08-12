/**
 * Obsidian's additions to Node, Element and Document.
 *
 * The app adds these to the DOM's own prototypes, so conversion code uses them
 * as if they were standard. Anything hosting that code outside Obsidian has to
 * put them back: a test on top of linkedom, and the website on top of the
 * browser's own DOM.
 *
 * Every patch here is guarded, so a host that already has the real thing keeps
 * it. That matters in a browser, where innerText, rows and cells exist and
 * behave better than anything reproduced here would - the guards check the
 * prototype the DOM actually puts them on, not Element, which is where these
 * land when nothing else provides them.
 *
 * Only the ones the conversion path uses. instanceOf is Obsidian's
 * cross-window instanceof; with one window it is the plain check.
 */

type ElementInfo = { text?: string, cls?: string, attr?: Record<string, unknown> };
type Win = any;

export interface DomHost {
	/**
	 * Obsidian exposes turndown on window, and the Evernote conversion reads it
	 * from there. Handed in rather than imported because a test has to load it
	 * after its DOM exists.
	 */
	turndown?: unknown;
	/**
	 * A blank document to assemble output into, for a host whose DOM has no
	 * DOMImplementation. A browser has one and this goes unused.
	 */
	createHTMLDocument?: () => unknown;
}

function define(proto: any, name: string, value: unknown) {
	if (!(name in proto)) Object.defineProperty(proto, name, { value, writable: true, configurable: true });
}

/**
 * Whether the DOM leaves `name` for us, asked of an element that would carry it.
 *
 * Asked of an element rather than of a constructor's prototype, because
 * linkedom hands every element the plain HTMLElement prototype however many
 * specialised constructors it also exports - so HTMLTableRowElement having
 * `cells` says nothing about whether a <tr> from this document does.
 */
function absent(window: Win, tag: string, name: string): boolean {
	return !(name in window.document.createElement(tag));
}

/** Whether assigning `name` on such an element would take, rather than be dropped. */
function settable(window: Win, tag: string, name: string): boolean {
	for (let proto = Object.getPrototypeOf(window.document.createElement(tag)); proto; proto = Object.getPrototypeOf(proto)) {
		const descriptor = Object.getOwnPropertyDescriptor(proto, name);
		if (descriptor) return !!descriptor.set || 'value' in descriptor;
	}
	return false;
}

/** Install them into `window`, and return it. */
export function installDomExtensions(window: Win, host: DomHost = {}): Win {
	const globals = globalThis as unknown as Record<string, unknown>;

	if (window.NodeFilter === undefined) {
		window.NodeFilter = globals.NodeFilter = {
			SHOW_ALL: 0xFFFFFFFF, SHOW_ELEMENT: 1, SHOW_ATTRIBUTE: 2, SHOW_TEXT: 4,
			SHOW_CDATA_SECTION: 8, SHOW_COMMENT: 128, SHOW_DOCUMENT: 256,
			SHOW_DOCUMENT_FRAGMENT: 1024,
			FILTER_ACCEPT: 1, FILTER_REJECT: 2, FILTER_SKIP: 3,
		};
	}

	if (window.requestAnimationFrame === undefined) {
		define(window, 'requestAnimationFrame', (callback: (time: number) => void) => setTimeout(() => callback(0), 0));
	}

	if (host.turndown !== undefined) window.TurndownService = host.turndown;

	// Obsidian's handle on the document of whichever window has focus. There is
	// only ever the one here.
	globals.activeDocument = window.document;

	/**
	 * linkedom has no DOMImplementation, and a conversion that assembles its
	 * output into a fresh document needs one to assemble into.
	 */
	if (window.document.implementation === undefined && host.createHTMLDocument) {
		const { createHTMLDocument } = host;
		Object.defineProperty(window.document, 'implementation', {
			value: { createHTMLDocument: () => createHTMLDocument() },
			configurable: true,
		});
	}

	const nodeProto = window.Node.prototype;
	const elementProto = window.Element.prototype;
	const documentProto = window.Document.prototype;

	define(nodeProto, 'instanceOf', function (this: any, type: any) { return this instanceof type; });
	if (!('doc' in nodeProto)) {
		Object.defineProperty(nodeProto, 'doc', {
			get(this: any) { return this.ownerDocument ?? window.document; },
			configurable: true,
		});
	}
	if (!('win' in nodeProto)) {
		Object.defineProperty(nodeProto, 'win', { get() { return window; }, configurable: true });
	}

	define(elementProto, 'find', function (this: any, selector: string) { return this.querySelector(selector); });
	define(elementProto, 'findAll', function (this: any, selector: string) { return Array.from(this.querySelectorAll(selector)); });
	// Obsidian adds these methods to Node, including DocumentFragment.
	define(nodeProto, 'appendText', function (this: any, text: string) {
		this.appendChild((this.ownerDocument ?? this.doc ?? window.document).createTextNode(text));
	});
	define(elementProto, 'empty', function (this: any) { while (this.firstChild) this.removeChild(this.firstChild); });

	/**
	 * linkedom exposes innerText read-only; browsers and Obsidian let you assign
	 * it, and the conversion code does. Backed by textContent, which is what
	 * linkedom's own getter reads.
	 */
	if (!settable(window, 'div', 'innerText')) {
		Object.defineProperty(elementProto, 'innerText', {
			get(this: any) { return this.textContent; },
			set(this: any, value: string) { this.textContent = value; },
			configurable: true,
		});
	}

	define(elementProto, 'setText', function (this: any, text: unknown) {
		if (text && typeof text === 'object' && 'nodeType' in (text as object)) {
			this.textContent = '';
			this.appendChild(text);
		}
		else this.textContent = String(text);
	});
	define(elementProto, 'hide', function (this: any) { this.style.display = 'none'; });
	define(elementProto, 'show', function (this: any) { this.style.removeProperty('display'); });
	define(elementProto, 'toggle', function (this: any, shown: boolean) {
		if (shown) this.show();
		else this.hide();
	});
	define(elementProto, 'toggleClass', function (this: any, classes: string | string[], value: boolean) {
		for (const cls of Array.isArray(classes) ? classes : [classes]) this.classList.toggle(cls, value);
	});

	define(elementProto, 'getAttr', function (this: any, name: string) { return this.getAttribute(name); });
	define(elementProto, 'setAttr', function (this: any, name: string, value: string) { this.setAttribute(name, String(value)); });

	/**
	 * rows and cells, which linkedom has neither of.
	 *
	 * The Notion conversion reads a page's property table through them - the
	 * rows of the <tbody>, then each row's cells - so without them the whole
	 * property-to-frontmatter path throws before it converts anything.
	 *
	 * linkedom gives every element the plain HTMLElement prototype, so these
	 * land on Element rather than on HTMLTableSectionElement and
	 * HTMLTableRowElement where the DOM puts them. turndown's GFM table rules
	 * read .rows as well, so <table> has to gather the rows of its sections
	 * rather than only its own children, or those rules see an empty table.
	 *
	 * Document order, where the DOM hoists thead first and sinks tfoot last. No
	 * export here writes either, and guessing at more would be inventing rather
	 * than matching.
	 */
	function childElements(el: any, tags: string[]): any[] {
		return (Array.from(el.children) as any[]).filter(child => tags.includes(child.tagName));
	}

	if (absent(window, 'table', 'rows') && !('rows' in elementProto)) {
		Object.defineProperty(elementProto, 'rows', {
			get(this: any) {
				if (this.tagName !== 'TABLE') return childElements(this, ['TR']);

				const rows: any[] = [];
				for (const child of Array.from(this.children) as any[]) {
					if (child.tagName === 'TR') rows.push(child);
					else if (child.tagName === 'THEAD' || child.tagName === 'TBODY' || child.tagName === 'TFOOT') {
						rows.push(...childElements(child, ['TR']));
					}
				}
				return rows;
			},
			configurable: true,
		});
	}

	if (absent(window, 'tr', 'cells') && !('cells' in elementProto)) {
		Object.defineProperty(elementProto, 'cells', {
			get(this: any) { return childElements(this, ['TD', 'TH']); },
			configurable: true,
		});
	}

	define(documentProto, 'find', function (this: any, selector: string) { return this.querySelector(selector); });
	define(documentProto, 'findAll', function (this: any, selector: string) { return Array.from(this.querySelectorAll(selector)); });

	function elementInfo(options?: ElementInfo | string): ElementInfo | undefined {
		return typeof options === 'string' ? { cls: options } : options;
	}

	/** Detached equivalent of Obsidian's createEl. */
	function createEl(tag: string, info?: ElementInfo | string, build?: (el: any) => void) {
		const options = elementInfo(info);
		const el = window.document.createElement(tag);
		if (options?.text) el.textContent = options.text;
		if (options?.cls) el.className = options.cls;
		for (const [name, value] of Object.entries(options?.attr ?? {})) {
			// null leaves the attribute off; undefined does not, which is
			// Obsidian's behaviour rather than an oversight here.
			if (value === null) continue;
			el.setAttribute(name, String(value));
		}
		build?.(el);
		return el;
	}

	/**
	 * The element methods append; the globals below do not. That difference is
	 * Obsidian's, and code here relies on both.
	 */
	define(nodeProto, 'createEl', function (this: any, tag: string, options?: ElementInfo | string, build?: (el: any) => void) {
		const child = createEl(tag, options, build);
		this.appendChild(child);
		return child;
	});
	define(nodeProto, 'createDiv', function (this: any, options?: ElementInfo | string, build?: (el: any) => void) {
		return this.createEl('div', options, build);
	});
	define(nodeProto, 'createSpan', function (this: any, options?: ElementInfo | string, build?: (el: any) => void) {
		return this.createEl('span', options, build);
	});

	globals.createEl = createEl;
	globals.createDiv = (options?: ElementInfo | string, build?: (el: any) => void) => createEl('div', options, build);
	globals.createSpan = (options?: ElementInfo | string, build?: (el: any) => void) => createEl('span', options, build);
	globals.createFragment = () => window.document.createDocumentFragment();
	define(window, 'createEl', createEl);

	return window;
}
