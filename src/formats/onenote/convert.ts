/**
 * The OneNote page conversion: the API's HTML in, markdown out.
 *
 * Fetching an attachment and asking the vault where it goes is the importer's,
 * and it happens in the middle of the conversion, so this comes in two halves:
 * what a page needs before its attachments are downloaded, and what turns the
 * result into markdown.
 */
import { htmlToMarkdown } from 'obsidian';
import { MathMLToLaTeX } from 'mathml-to-latex';
import { parseHTML } from '../../util';
import { getSiblingsInSameCodeBlock, isBRElement, isFenceCodeBlock, isInlineCodeSpan, isParagraphWrappingOnlyCode } from './code';

// Regex for fixing whitespace and paragraphs
const PARAGRAPH_REGEX = /(<\/p>)\s*(<p[^>]*>)|\n {2}\n/g;

function isHTMLElement(node: Node): node is HTMLElement {
	return node.instanceOf(HTMLElement);
}

/** A page's own content: its tags converted, its paragraphs joined. */
export function convertPageTags(html: string): string {
	return convertTags(parseHTML(html)).replace(PARAGRAPH_REGEX, '<br />');
}

/** The rest of the conversion, once the attachments are in the page. */
export function pageToMarkdown(pageElement: HTMLElement): string {
	combineCodeBlocksAsNecessary(pageElement);
	styledElementToHTML(pageElement);
	convertInternalLinks(pageElement);
	convertMathML(pageElement); // Convert MathML to LaTeX before text escaping
	removeExtraListItemParagraphs(pageElement);
	escapeTextNodes(pageElement);

	return htmlToMarkdown(pageElement).trim().replace(PARAGRAPH_REGEX, ' ');
}

/**
 * Whether a tag is on the list item itself rather than somewhere in its text.
 *
 * OneNote marks a to-do on the item, or on the paragraph or span the item
 * starts with, so anything from the item down to the tag has to be the first
 * thing there - a tag halfway through the text is part of the text.
 */
function startsListItem(element: Element): boolean {
	if (element.tagName === 'LI') return true;

	let node: Node = element;
	for (let parent = element.parentElement; parent; parent = parent.parentElement) {
		if (!startsContent(node, parent)) return false;
		if (parent.tagName === 'LI') return true;
		node = parent;
	}

	return false;
}

/** Whether a node is the first thing in its parent, whitespace aside. */
function startsContent(node: Node, parent: Element): boolean {
	for (const child of Array.from(parent.childNodes)) {
		if (child === node) return true;
		if (child.nodeType !== Node.TEXT_NODE || child.textContent?.trim()) return false;
	}

	return false;
}

export function convertTags(pageElement: HTMLElement): string {
	const tagElements = Array.from(pageElement.querySelectorAll('[data-tag]'));

	for (const element of tagElements) {
		// If a to-do tag, then convert it into a Markdown task list
		if (element.getAttribute('data-tag')?.contains('to-do')) {
			const isChecked = element.getAttribute('data-tag') === 'to-do:completed';
			const check = isChecked ? '[x]' : '[ ]';
			// A list writes the bullet or the number itself, so a to-do that
			// starts one of its items brings only the checkbox. Anywhere else
			// there is no list to belong to, and it brings a bullet of its own.
			const bullet = startsListItem(element) ? '' : '- ';
			// Prepend a text node so any nested elements (e.g. an image marked as TO-DO) are preserved
			element.prepend(`${bullet}${check} `);
		}
		// All other OneNote tags are already in the Obsidian tag format ;)
		else {
			const tags = element.getAttribute('data-tag')?.split(',');
			tags?.forEach((tag) => {
				element.append(` #${tag.replace(':', '-')} `);
			});
		}
	}
	return pageElement.outerHTML;
}

/** Convert MathML elements to LaTeX format for Obsidian */
export function convertMathML(pageElement: HTMLElement): void {
	const mathElements = Array.from(pageElement.querySelectorAll('math'));

	for (const mathElement of mathElements) {
		try {
			// Get the MathML as a string
			const mathMLString = mathElement.outerHTML;

			// Convert MathML to LaTeX using mathml2latex
			const latexString = MathMLToLaTeX.convert(mathMLString);

			// Create the appropriate LaTeX syntax for Obsidian.
			//
			// MathML exported from OneNote all include the attribute display="block",
			// but we can safely convert them to inline form, as the block form would
			// be wrapped in <br /> line breaks.
			let obsidianMath = `$${latexString}$`;

			// Create a text node with the LaTeX
			const textNode = mathElement.doc.createTextNode(obsidianMath);

			// Replace the MathML element with the LaTeX text node
			mathElement.parentNode?.replaceChild(textNode, mathElement);
		}
		catch (error) {
			console.warn('Failed to convert MathML to LaTeX:', error);
			// If conversion fails, keep the original MathML or replace with a placeholder
			const fallbackText = mathElement.doc.createTextNode('[Math equation - conversion failed]');
			mathElement.parentNode?.replaceChild(fallbackText, mathElement);
		}
	}
}

export function isLatexMath(text: string): boolean {
	const trimmed = text.trim();
	return (trimmed.startsWith('$') && trimmed.endsWith('$')) || (trimmed.startsWith('$$') && trimmed.endsWith('$$'));
}

/** Escape characters which will cause problems after converting to markdown. */
export function escapeTextNodes(node: ChildNode): void {
	if (node.nodeType === Node.TEXT_NODE && node.textContent) {
		// Don't escape text that contains LaTeX math expressions
		if (isLatexMath(node.textContent)) {
			return;
		}

		node.textContent = node.textContent
			.replace(/([<>])/g, '\\$1');
	}
	else {
		for (let i = 0; i < node.childNodes.length; i++) {
			escapeTextNodes(node.childNodes[i]);
		}
	}
}

export function convertInternalLinks(pageElement: HTMLElement): void {
	const links: HTMLAnchorElement[] = pageElement.findAll('a') as HTMLAnchorElement[];
	for (const link of links) {
		if (link.href.startsWith('onenote:')) {
			const startIdx = link.href.indexOf('#') + 1;
			const endIdx = link.href.indexOf('&', startIdx);
			link.href = link.href.slice(startIdx, endIdx);
		}
	}
}

/**
 * Given code blocks in separate paragraphs that are only separated by a
 * single newline (br), combine them.
 */
export function combineCodeBlocksAsNecessary(pageElement: HTMLElement): void {
	const paragraphs = pageElement.querySelectorAll('p:has(+ br + p)');
	// querySelectorAll must return results in document order, so we should combine nodes in reverse order
	Array.from(paragraphs).reverse().forEach((p) => {
		const firstParagraph = p;
		const lineBreak = p.nextElementSibling;
		if (!isBRElement(lineBreak)) {
			throw new Error(`Expected a <br> element after the paragraph, but found: ${lineBreak?.nodeName}`);
		}
		const secondParagraph = lineBreak.nextElementSibling;
		if (isParagraphWrappingOnlyCode(firstParagraph)
			&& isParagraphWrappingOnlyCode(secondParagraph)) {
			// move the line break ...
			firstParagraph.appendChild(lineBreak);
			// .. and add another line break to capture the newline between
			// the two paragraphs
			firstParagraph.appendChild(lineBreak.cloneNode());
			// ... and clone second paragraph's children into the first paragraph
			firstParagraph.append(...Array.from(secondParagraph.childNodes));
			// clean-up the DOM (linebreak was moved, second paragraph wasn't)
			secondParagraph.remove();
		}
	});
}

// Convert OneNote styled elements to valid HTML for proper htmlToMarkdown conversion
export function styledElementToHTML(pageElement: HTMLElement): void {
	// Map styles to their elements
	const styleMap: { [key: string]: keyof HTMLElementTagNameMap } = {
		'font-weight:bold': 'b',
		'font-style:italic': 'i',
		'text-decoration:underline': 'u',
		'text-decoration:line-through': 's',
		'background-color': 'mark',
	};
	// Cites/quotes are not converted into Markdown (possible htmlToMarkdown bug?), so we do it ourselves temporarily
	const cites = pageElement.findAll('cite');
	cites.forEach((cite) => {
		cite.prepend('> ');
		cite.append(createEl('br'));
	});

	const elements = pageElement.querySelectorAll('*');
	elements.forEach(element => {
		if (!pageElement.contains(element)) {
			// already processed and removed, can skip
			return;
		}

		if (isInlineCodeSpan(element)) {
			// Convert preformatted text into an inline code span
			const codeElement = createEl('code');
			codeElement.append(...Array.from(element.childNodes));
			element.replaceWith(codeElement);
		}
		else if (isFenceCodeBlock(element)) {
			// Convert preformatted text into a code fence wrapped in a pre element
			const codeElement = createEl('pre');
			codeElement.append('```\n');
			codeElement.append(...Array.from(element.childNodes));
			getSiblingsInSameCodeBlock(element).forEach(sibling => {
				if (isBRElement(sibling)) {
					codeElement.append('\n');
				}
				else {
					codeElement.append(...Array.from(sibling.childNodes));
				}
				sibling.remove();
			});
			codeElement.append('\n```');

			// replace the original node with the pre element
			element.replaceWith(codeElement);
		}
		else {
			if (element.nodeName === 'TD') {
				// Do not replace table cells if they are styled.
				element.removeAttribute('style');
				return;
			}
			else {
				const style = element.getAttribute('style') || '';
				const matchingStyle = Object.keys(styleMap).find(key => style.includes(key));
				if (matchingStyle) {
					const newElementTag = styleMap[matchingStyle];
					const newElement = createEl(newElementTag);
					newElement.append(...Array.from(element.childNodes));
					element.replaceWith(newElement);
				}
			}
		}
	});
}

// OneNote wraps list items in an extra, marginless paragraph. Remove these
// as they result in turndown adding extra newlines, which is particularly
// bad when dealing with nested bulletted lists.
//
// BEFORE:
// 	<ul>
//		<li>
//			<p style="margin-top:0pt;margin-bottom:0pt">List Item 1</p>
//			<ul>
//				<li style="list-style-type:circle">List Item 1.a</li>
//			</ul>
//		</li>
//	</ul>
//
// AFTER:
// 	<ul>
//		<li>
//			List Item 1
//			<ul>
//				<li style="list-style-type:circle">List Item 1.a</li>
//			</ul>
//		</li>
//	</ul>
//
// https://github.com/obsidianmd/obsidian-importer/issues/363
export function removeExtraListItemParagraphs(element: HTMLElement): void {
	// if the first list item child is a paragraph
	element.querySelectorAll('li > p:first-child').forEach((p) => {
		if (
			isHTMLElement(p)
			// and it has 0 margin (this is really just to sanity check that this isn't meant to create newlines, visually)
			&& p.style.marginBottom === '0pt' && p.style.marginTop === '0pt'
		) {
			// then unwrap the paragraph (move its children up to its parent, so there is no paragraph)
			p.replaceWith(...Array.from(p.childNodes));
		}
	});
}
