/**
 * Pure DOM-transformation functions for converting OneNote HTML to Markdown-ready HTML.
 *
 * These functions mutate an HTMLElement in place and can be composed in a pipeline
 * before the final htmlToMarkdown() call.  They are extracted here so that they can
 * be unit-tested without requiring the full Obsidian runtime.
 *
 * OneNote HTML is produced by the Microsoft Graph API.  Relevant spec:
 * https://learn.microsoft.com/en-us/graph/onenote-input-output-html
 */

import { getSiblingsInSameCodeBlock, isFenceCodeBlock, isInlineCodeSpan, isBRElement, isParagraphWrappingOnlyCode } from './code';
import { MathMLToLaTeX } from 'mathml-to-latex';

function isHTMLElement(node: Node): node is HTMLElement {
	return node instanceof HTMLElement;
}

/**
 * Convert OneNote data-tag attributes to Markdown equivalents.
 *
 * The Microsoft Graph API encodes OneNote tags as `data-tag` attributes on
 * the containing element.  Two cases are handled:
 *
 *  • To-do tags (`data-tag="to-do"` / `data-tag="to-do:completed"`) on
 *    **top-level <p> elements** — the element is replaced with a
 *    `<ul><li><input type="checkbox">…</li></ul>` so that the GFM turndown
 *    rule emits `- [ ] ` (or `- [x] ` when completed) rather than injecting
 *    literal Markdown text that would be escaped.  These elements are flat
 *    in the API output regardless of visual indentation in the OneNote UI.
 *
 *  • To-do tags on elements **inside a <li>** — the <li> itself is rewritten
 *    as a task-list item by inserting an `<input type="checkbox">` node so
 *    that the GFM turndown rule can pick it up.  This preserves the nesting
 *    depth already encoded by the surrounding <ol>/<ul> structure.
 *
 *  • All other tags (e.g. `important`, `question`) are converted to Obsidian
 *    hashtag syntax and appended to the element content.
 */
export function convertTags(pageElement: HTMLElement): void {
	const tagElements = Array.from(pageElement.querySelectorAll('[data-tag]'));

	for (const element of tagElements) {
		const tag = element.getAttribute('data-tag') ?? '';

		if (tag.includes('to-do')) {
			const isChecked = tag === 'to-do:completed';

			// When the tagged element is inside a <li> (directly or via a <p>/<span>),
			// we rewrite the ancestor <li> as a task-list item instead of injecting
			// raw Markdown text into the element content.  The GFM turndown plugin
			// recognises <li> children that are <input type="checkbox"> elements and
			// emits "- [ ] " / "- [x] " accordingly.
			const closestLi = element.closest('li');
			if (closestLi) {
				const checkbox = pageElement.ownerDocument.createElement('input');
				checkbox.setAttribute('type', 'checkbox');
				if (isChecked) {
					// setAttribute ensures the 'checked' attribute is present in
					// the serialised HTML so that turndown's GFM taskListItems
					// rule can read node.checked correctly.
					checkbox.setAttribute('checked', '');
				}
				// Insert the checkbox as the very first child of the <li> so
				// that turndown's taskListItems rule finds it.
				closestLi.insertBefore(checkbox, closestLi.firstChild);
				// Remove the data-tag so we don't process this <li> twice
				// if it contains multiple tagged descendants.
				element.removeAttribute('data-tag');
			}
			else {
				// Top-level to-do paragraph: replace with a task-list item so
				// that the GFM turndown rule produces "- [ ] " / "- [x] "
				// instead of injecting literal Markdown text that would be
				// escaped by turndown.
				//
				// The OneNote API does not encode visual indentation for these
				// elements — they appear as flat <p> tags regardless of how
				// they look in the UI — so they are always emitted at the top
				// level.
				const ul = pageElement.ownerDocument.createElement('ul');
				const li = pageElement.ownerDocument.createElement('li');
				const checkbox = pageElement.ownerDocument.createElement('input');
				checkbox.setAttribute('type', 'checkbox');
				if (isChecked) {
					checkbox.setAttribute('checked', '');
				}
				li.appendChild(checkbox);
				// Preserve any inline children (images, formatted text, etc.)
				while (element.firstChild) {
					li.appendChild(element.firstChild);
				}
				ul.appendChild(li);
				element.replaceWith(ul);
			}
		}
		else {
			// All other OneNote tags map directly to Obsidian tag syntax.
			const tags = tag.split(',');
			tags.forEach((t) => {
				element.innerHTML = element.innerHTML + ` #${t.replace(':', '-')} `;
			});
		}
	}
}

/**
 * Given code blocks in separate paragraphs that are only separated by a
 * single newline (<br>), combine them into one block.
 */
export function combineCodeBlocksAsNecessary(pageElement: HTMLElement): void {
	const paragraphs = pageElement.querySelectorAll('p:has(+ br + p)');
	// querySelectorAll returns results in document order; combine in reverse
	// order so earlier nodes are still valid when we process them.
	Array.from(paragraphs).reverse().forEach((p) => {
		const firstParagraph = p;
		const lineBreak = p.nextElementSibling;
		if (!isBRElement(lineBreak)) {
			throw new Error(`Expected a <br> element after the paragraph, but found: ${lineBreak?.nodeName}`);
		}
		const secondParagraph = lineBreak.nextElementSibling;
		if (isParagraphWrappingOnlyCode(firstParagraph)
			&& isParagraphWrappingOnlyCode(secondParagraph)) {
			firstParagraph.appendChild(lineBreak);
			firstParagraph.appendChild(lineBreak.cloneNode());
			firstParagraph.insertAdjacentHTML('beforeend', secondParagraph.innerHTML);
			secondParagraph.remove();
		}
	});
}

/**
 * Convert OneNote styled elements to valid semantic HTML so that
 * htmlToMarkdown can handle them correctly.
 *
 * Inline styles such as `font-weight:bold` are replaced with the
 * corresponding semantic element (`<b>`, `<i>`, `<u>`, `<s>`, `<mark>`).
 * Preformatted Consolas spans are converted to `<code>` or fenced
 * ``` ``` ``` blocks.
 */
export function styledElementToHTML(pageElement: HTMLElement): void {
	const styleMap: { [key: string]: string } = {
		'font-weight:bold': 'b',
		'font-style:italic': 'i',
		'text-decoration:underline': 'u',
		'text-decoration:line-through': 's',
		'background-color': 'mark',
	};
	// Cites/quotes are not converted into Markdown by htmlToMarkdown, so we
	// do it ourselves here.
	const cites = Array.from(pageElement.querySelectorAll('cite'));
	cites.forEach((cite) => (cite as HTMLElement).innerHTML = '> ' + (cite as HTMLElement).innerHTML + '<br>');

	const elements = pageElement.querySelectorAll('*');
	elements.forEach(element => {
		if (!pageElement.contains(element)) {
			return;
		}

		if (isInlineCodeSpan(element)) {
			const codeElement = element.ownerDocument.createElement('code');
			codeElement.innerHTML = element.innerHTML;
			element.replaceWith(codeElement);
		}
		else if (isFenceCodeBlock(element)) {
			const codeBlockItems: string[] = [element.innerHTML];
			getSiblingsInSameCodeBlock(element).forEach(sibling => {
				codeBlockItems.push(
					isBRElement(sibling) ? '\n' : sibling.innerHTML
				);
				sibling.remove();
			});

			const codeElement = element.ownerDocument.createElement('pre');
			codeElement.innerHTML =
				'```\n' +
				codeBlockItems.join('') +
				'\n```';

			element.replaceWith(codeElement);
		}
		else {
			if (element.nodeName === 'TD') {
				element.removeAttribute('style');
				return;
			}
			else {
				const style = element.getAttribute('style') || '';
				const matchingStyle = Object.keys(styleMap).find(key => style.includes(key));
				if (matchingStyle) {
					const newElementTag = styleMap[matchingStyle];
					const newElement = element.ownerDocument.createElement(newElementTag);
					newElement.innerHTML = element.innerHTML;
					element.replaceWith(newElement);
				}
			}
		}
	});
}

/** Convert MathML elements to LaTeX format for Obsidian. */
export function convertMathML(pageElement: HTMLElement): void {
	const mathElements = Array.from(pageElement.querySelectorAll('math'));

	for (const mathElement of mathElements) {
		try {
			const mathMLString = mathElement.outerHTML;
			const latexString = MathMLToLaTeX.convert(mathMLString);
			// MathML exported from OneNote all include display="block", but
			// we convert to inline form ($…$) because the block form would
			// be wrapped in <br /> line breaks.
			const obsidianMath = `$${latexString}$`;
			const textNode = mathElement.ownerDocument.createTextNode(obsidianMath);
			mathElement.parentNode?.replaceChild(textNode, mathElement);
		}
		catch (error) {
			console.warn('Failed to convert MathML to LaTeX:', error);
			const fallbackText = mathElement.ownerDocument.createTextNode('[Math equation - conversion failed]');
			mathElement.parentNode?.replaceChild(fallbackText, mathElement);
		}
	}
}

/** Escape characters which will cause problems after converting to markdown. */
export function escapeTextNodes(node: ChildNode): void {
	if (node.nodeType === Node.TEXT_NODE && node.textContent) {
		if (isLatexMath(node.textContent)) {
			return;
		}
		node.textContent = node.textContent.replace(/([<>])/g, '\\$1');
	}
	else {
		for (let i = 0; i < node.childNodes.length; i++) {
			escapeTextNodes(node.childNodes[i]);
		}
	}
}

function isLatexMath(text: string): boolean {
	const trimmed = text.trim();
	return (trimmed.startsWith('$') && trimmed.endsWith('$')) || (trimmed.startsWith('$$') && trimmed.endsWith('$$'));
}

/**
 * Remove the extra, marginless paragraph that OneNote wraps around list item
 * text.  Without this, turndown adds extra blank lines inside list items,
 * which breaks nested list rendering.
 *
 * BEFORE:
 *   <ul>
 *     <li>
 *       <p style="margin-top:0pt;margin-bottom:0pt">Item text</p>
 *       <ul>
 *         <li style="list-style-type:circle">Nested item</li>
 *       </ul>
 *     </li>
 *   </ul>
 *
 * AFTER:
 *   <ul>
 *     <li>
 *       Item text
 *       <ul>
 *         <li style="list-style-type:circle">Nested item</li>
 *       </ul>
 *     </li>
 *   </ul>
 *
 * See https://github.com/obsidianmd/obsidian-importer/issues/363
 */
export function removeExtraListItemParagraphs(element: HTMLElement): void {
	// Match both `li > p:first-child` (normal case) and
	// `li > input:first-child + p` (when convertTags has inserted a checkbox
	// as the first child before the wrapping paragraph).
	element.querySelectorAll('li > p:first-child, li > input:first-child + p').forEach((p) => {
		if (
			isHTMLElement(p)
			&& p.style.marginBottom === '0pt' && p.style.marginTop === '0pt'
		) {
			p.replaceWith(...Array.from(p.childNodes));
		}
	});
}

/** Convert onenote: internal links to their page-id fragment form. */
export function convertInternalLinks(pageElement: HTMLElement): void {
	const links = Array.from(pageElement.querySelectorAll('a')) as HTMLAnchorElement[];
	for (const link of links) {
		if (link.href.startsWith('onenote:')) {
			const startIdx = link.href.indexOf('#') + 1;
			const endIdx = link.href.indexOf('&', startIdx);
			link.href = link.href.slice(startIdx, endIdx);
		}
	}
}
