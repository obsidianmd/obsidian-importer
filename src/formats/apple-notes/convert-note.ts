import { ScanConverter } from './convert-scan';
import { TableConverter } from './convert-table';
import {
	ANContext,
	ANAlignment,
	ANAttachment,
	ANAttributeRun,
	ANBaseline,
	ANConverter,
	ANDocument,
	ANEmphasisColor,
	ANFontWeight,
	ANFragmentPair,
	ANMultiRun,
	ANNote,
	ANStyleType,
	ANTableObject
} from './models';

const FRAGMENT_SPLIT = /(^\s+|(?:\s+)?\n(?:\s+)?|\s+$)/;
/** What Shift-Return puts in the text: a line separator, not a paragraph end. */
const SOFT_RETURN = '\u2028';
const NOTE_URI = /applenotes:note\/([-0-9a-f]+)(?:\?ownerIdentifier=.*)?/;

const DEFAULT_EMOJI = '.AppleColorEmojiUI';

/**
 * Obsidian takes a highlight's colour from an emoji leading its content, and has no
 * pink or mint of its own, so those go to the nearest it does have. An unmarked
 * highlight is already yellow, which is the colour Apple leaves unset.
 */
const EMPHASIS_MARKERS: Record<ANEmphasisColor, string> = {
	[ANEmphasisColor.Purple]: '🟣',
	[ANEmphasisColor.Pink]: '🔴',
	[ANEmphasisColor.Orange]: '🟠',
	[ANEmphasisColor.Mint]: '🟢',
	[ANEmphasisColor.Blue]: '🔵'
};

/** Keep generated file names within practical filesystem limits. */
const TITLE_LIMIT = 200;

const URL_LINE = /^https?:\/\/\S+$/;

/**
 * Return the first line with text on it, which Apple displays as the note
 * title. A line holding only attachments is not one, and a soft return within
 * the line is a space rather than a character no file name should carry.
 */
export function firstLine(noteText: string): string {
	return noteText
		.split('\n')
		.map(line => line.replace(/\uFFFC/g, '').replace(/[\u2028\u2029]/g, ' ').trim())
		.find(line => line !== '') ?? '';
}

/**
 * Derive a title from the note text because Apple truncates ZTITLE1 at roughly
 * 80 characters (#541). Fall back to ZTITLE1 for attachment-only notes.
 */
export function noteTitle(noteText: string, stored: string): string {
	const line = firstLine(noteText ?? '');
	if (!line) return stored;

	return line.length > TITLE_LIMIT ? line.slice(0, TITLE_LIMIT).trimEnd() : line;
}

const LIST_STYLES = [
	ANStyleType.DottedList, ANStyleType.DashedList, ANStyleType.NumberedList, ANStyleType.Checkbox
];

export class NoteConverter extends ANConverter {
	note: ANNote;

	listNumber = 0;
	listIndent = 0;
	multiRun = ANMultiRun.None;
	/** The alignment of the block being written, if one is open. */
	alignment: ANAlignment | undefined;

	static protobufType = 'ciofecaforensics.Document';

	constructor(ctx: ANContext, document: ANDocument | ANTableObject) {
		super(ctx);
		this.note = document.note;
	}

	parseTokens(): ANFragmentPair[] {
		let i = 0;
		let offsetStart = 0;
		let offsetEnd = 0;
		let tokens = [];

		while (i < this.note.attributeRun.length) {
			let attr: ANAttributeRun;
			let attrText = '';
			let nextIsSame = true;

			/* First, merge tokens with the same attributes */
			do {
				attr = this.note.attributeRun[i];
				offsetEnd = offsetEnd + attr.length;
				attrText += this.note.noteText.substring(offsetStart, offsetEnd);

				offsetStart = offsetEnd;
				nextIsSame = (i == this.note.attributeRun.length - 1)
					? false
					: attrEquals(attr, this.note.attributeRun[i + 1]);

				i++;
			}
			while (nextIsSame);

			/* Then, since Obsidian doesn't like formatting crossing new lines or 
			starting/ending at spaces, divide tokens based on that */
			for (let fragment of attrText.split(FRAGMENT_SPLIT)) {
				if (!fragment) continue;
				tokens.push({ attr, fragment });
			}
		}

		return tokens;
	}

	async format(table = false, parentNotePath = ''): Promise<string> {
		let fragments = this.parseTokens();
		// Keep URL-only titles in the body because sanitising them for a file name
		// would destroy the working URL (#591).
		let firstLineSkip = !table && this.ctx.omitFirstLine
			&& this.note.noteText.contains('\n')
			&& !URL_LINE.test(firstLine(this.note.noteText));
		let converted = '';
		let titleStarted = false;

		for (let j = 0; j < fragments.length; j++) {
			let { attr, fragment } = fragments[j];

			if (firstLineSkip) {
				// Do not treat an attachment as part of the title.
				if (attr.attachmentInfo) {
					firstLineSkip = false;
				}
				else if (!titleStarted && /\S/.test(fragment) && this.leadsNestedList(fragments, j)) {
					firstLineSkip = false;
				}
				else {
					// Skip through leading blank lines, then stop after the first
					// non-blank line so the title is not repeated in the body.
					if (/\S/.test(fragment)) titleStarted = true;
					if (titleStarted && fragment.contains('\n')) firstLineSkip = false;
					continue;
				}
			}

			attr.fragment = fragment;
			attr.atLineStart = j == 0 ? true : fragments[j - 1]?.fragment.contains('\n');

			converted += this.formatMultiRun(attr);

			if (attr.fragment.contains(SOFT_RETURN)) {
				attr.fragment = this.expandSoftReturns(attr, converted);
			}

			if (!/\S/.test(attr.fragment) || this.multiRun == ANMultiRun.Monospaced) {
				converted += attr.fragment;
			}
			else if (attr.attachmentInfo) {
				attr.fragment = await this.formatAttachment(attr, parentNotePath);

				// An inline attachment can be the first content in a list item and
				// must receive that item's prefix. Block attachments stand alone.
				converted += attr.atLineStart && !isBlockAttachment(attr)
					? this.formatParagraph(attr)
					: attr.fragment;
			}
			else if (attr.superscript || attr.underlined || attr.font || this.multiRun == ANMultiRun.Alignment) {
				converted += await this.formatHtmlAttr(attr);
			}
			else {
				converted += await this.formatAttr(attr);
			}
		}

		if (this.multiRun != ANMultiRun.None) converted += this.formatMultiRun({} as ANAttributeRun);
		converted = converted.trim();

		// Inside a table cell, raw newlines end the row and raw pipes start a new
		// cell. Remove hard-break spaces before replacing the newline.
		if (table) {
			converted = converted.replace(/ *\n/g, '<br>').replace(/\|/g, '&#124;');
		}

		return converted;
	}

	/**
	 * Convert a fragment's soft returns to Markdown line breaks.
	 *
	 * Strict line breaks require two trailing spaces. List continuations also
	 * require indentation, except after an empty line where indentation would
	 * create a code block. Inside one, a newline is already the break.
	 */
	expandSoftReturns(attr: ANAttributeRun, converted: string): string {
		const style = attr.paragraphStyle;
		const inCode = this.multiRun == ANMultiRun.Monospaced;
		let indent = this.ctx.strictLineBreaks && !inCode ? '  \n' : '\n';

		if (!inCode && style?.styleType !== undefined && LIST_STYLES.includes(style.styleType)) {
			indent += '\t'.repeat((style.indentAmount ?? 0) + 1);
		}

		let onALine = /\S/.test(converted.slice(converted.lastIndexOf('\n') + 1));
		let out = '';

		for (const char of attr.fragment) {
			if (char == SOFT_RETURN) {
				out += onALine ? indent : '\n';
				onALine = false;
			}
			else {
				out += char;
				onALine = char == '\n' ? false : onALine || /\S/.test(char);
			}
		}

		return out;
	}

	/**
	 * Whether the fragment at `from` is the parent of a nested list. Removing a
	 * parent used as the title would orphan its children and leave an empty item.
	 */
	leadsNestedList(fragments: ANFragmentPair[], from: number): boolean {
		const style = fragments[from].attr.paragraphStyle;
		if (style?.styleType === undefined || !LIST_STYLES.includes(style.styleType)) return false;

		const indent = style.indentAmount ?? 0;

		for (let k = from + 1; k < fragments.length; k++) {
			if (!/\S/.test(fragments[k].fragment)) continue;
			return (fragments[k].attr.paragraphStyle?.indentAmount ?? 0) > indent;
		}

		return false;
	}

	/** Format things that cover multiple ANAttributeRuns. */
	formatMultiRun(attr: ANAttributeRun): string {
		const styleType = attr.paragraphStyle?.styleType;
		let prefix = '';

		switch (this.multiRun) {
			case ANMultiRun.List:
				if (
					(attr.paragraphStyle?.indentAmount == 0 &&
						!LIST_STYLES.includes(styleType!)) ||
					isBlockAttachment(attr)
				) {
					this.multiRun = ANMultiRun.None;
				}
				break;

			case ANMultiRun.Monospaced:
				if (styleType != ANStyleType.Monospaced) {
					this.multiRun = ANMultiRun.None;
					prefix += '```\n';
				}
				break;

			case ANMultiRun.Alignment:
				// A different alignment needs a block of its own. Only checking
				// for the absence of one left a right-aligned paragraph inside
				// the centred block before it.
				if (attr.paragraphStyle?.alignment !== this.alignment) {
					this.multiRun = ANMultiRun.None;
					this.alignment = undefined;
					prefix += '</p>\n';
				}
				break;
		}

		// Separate since one may end and another start immediately
		if (this.multiRun == ANMultiRun.None) {
			if (styleType == ANStyleType.Monospaced) {
				this.multiRun = ANMultiRun.Monospaced;
				prefix += '\n```\n';
			}
			else if (LIST_STYLES.includes(styleType as ANStyleType)) {
				this.multiRun = ANMultiRun.List;

				// Apple Notes lets users start a list as indented, so add a initial non-indented bit to those
				if (attr.paragraphStyle?.indentAmount) prefix += '\n- &nbsp;\n';
			}
			else if (attr.paragraphStyle?.alignment) {
				this.multiRun = ANMultiRun.Alignment;
				this.alignment = attr.paragraphStyle.alignment;
				const val = this.convertAlign(attr.paragraphStyle.alignment);
				prefix += `\n<p style="text-align:${val};margin:0">`;
			}
		}

		return prefix;
	}

	/** Since putting markdown inside inline html tags is currentlyproblematic in Live Preview, this is a separate
	 parser for those that is activated when HTML-only stuff (eg underline, font size) is needed */
	async formatHtmlAttr(attr: ANAttributeRun): Promise<string> {
		if (attr.strikethrough) attr.fragment = `<s>${attr.fragment}</s>`;
		if (attr.underlined) attr.fragment = `<u>${attr.fragment}</u>`;

		if (attr.superscript == ANBaseline.Super) attr.fragment = `<sup>${attr.fragment}</sup>`;
		if (attr.superscript == ANBaseline.Sub) attr.fragment = `<sub>${attr.fragment}</sub>`;

		let style = '';

		switch (attr.fontWeight) {
			case ANFontWeight.Bold:
				attr.fragment = `<b>${attr.fragment}</b>`;
				break;
			case ANFontWeight.Italic:
				attr.fragment = `<i>${attr.fragment}</i>`;
				break;
			case ANFontWeight.BoldItalic:
				attr.fragment = `<b><i>${attr.fragment}</i></b>`;
				break;
		}

		if (attr.font?.fontName && attr.font.fontName !== DEFAULT_EMOJI) {
			style += `font-family:${attr.font.fontName};`;
		}

		if (attr.font?.pointSize) style += `font-size:${attr.font.pointSize}pt;`;

		if (attr.link && !NOTE_URI.test(attr.link)) {
			if (style) style = ` style="${style}"`;

			attr.fragment =
				`<a href="${attr.link}" rel="noopener" class="external-link"` +
				` target="_blank"${style}>${attr.fragment}</a>`;
		}
		else if (style) {
			if (attr.link) attr.fragment = await this.getInternalLink(attr.link, attr.fragment);

			attr.fragment = `<span style="${style}">${attr.fragment}</span>`;
		}

		attr.fragment = emphasise(attr);

		if (attr.atLineStart) {
			return this.formatParagraph(attr);
		}
		else {
			return attr.fragment;
		}
	}

	async formatAttr(attr: ANAttributeRun): Promise<string> {
		// Escape square brackets.
		attr.fragment = attr.fragment.replace(/([[\]])/g, '\\$1');

		// Apple represents real tags as attachments. Escape tag-shaped hashes that
		// remain in plain text so Obsidian does not reinterpret them (#471).
		//
		// Limit this to a hash at a word boundary followed by at least one
		// non-digit tag character. This preserves C#, F#, and Markdown headings.
		attr.fragment = attr.fragment.replace(/(^|\s)#(?=[\w/-]*[A-Za-z_/-])/g, '$1\\#');

		switch (attr.fontWeight) {
			case ANFontWeight.Bold:
				attr.fragment = `**${attr.fragment}**`;
				break;
			case ANFontWeight.Italic:
				attr.fragment = `*${attr.fragment}*`;
				break;
			case ANFontWeight.BoldItalic:
				attr.fragment = `***${attr.fragment}***`;
				break;
		}

		if (attr.strikethrough) attr.fragment = `~~${attr.fragment}~~`;
		if (attr.link && attr.link != attr.fragment) {
			if (NOTE_URI.test(attr.link)) {
				attr.fragment = await this.getInternalLink(attr.link, attr.fragment);
			}
			else {
				attr.fragment = `[${attr.fragment}](${attr.link})`;
			}
		}

		attr.fragment = emphasise(attr);

		if (attr.atLineStart) {
			return this.formatParagraph(attr);
		}
		else {
			return attr.fragment;
		}
	}

	formatParagraph(attr: ANAttributeRun): string {
		const indent = '\t'.repeat(attr.paragraphStyle?.indentAmount || 0);
		const styleType = attr.paragraphStyle?.styleType;
		let prelude = attr.paragraphStyle?.blockquote ? '> ' : '';

		if (
			this.listNumber != 0 &&
			(styleType !== ANStyleType.NumberedList ||
				this.listIndent !== attr.paragraphStyle?.indentAmount)
		) {
			this.listIndent = attr.paragraphStyle?.indentAmount || 0;
			this.listNumber = 0;
		}

		switch (styleType) {
			case ANStyleType.Title:
				return `${prelude}# ${attr.fragment}`;

			case ANStyleType.Heading:
				return `${prelude}## ${attr.fragment}`;

			case ANStyleType.Subheading:
				return `${prelude}### ${attr.fragment}`;

			case ANStyleType.DashedList:
			case ANStyleType.DottedList:
				return `${prelude}${indent}- ${attr.fragment}`;

			case ANStyleType.NumberedList:
				this.listNumber++;
				return `${prelude}${indent}${this.listNumber}. ${attr.fragment}`;

			case ANStyleType.Checkbox: {
				const box = attr.paragraphStyle!.checklist?.done ? '[x]' : '[ ]';
				return `${prelude}${indent}- ${box} ${attr.fragment}`;
			}
		}

		// Not a list but indented in line with one
		if (this.multiRun == ANMultiRun.List) prelude += indent;

		return `${prelude}${attr.fragment}`;
	}

	async formatAttachment(attr: ANAttributeRun, parentNotePath: string): Promise<string> {
		let row, id, converter;

		switch (attr.attachmentInfo?.typeUti) {
			case ANAttachment.Hashtag:
			case ANAttachment.Mention:
				row = await this.ctx.database.get`
					SELECT zalttext FROM ziccloudsyncingobject 
					WHERE zidentifier = ${attr.attachmentInfo.attachmentIdentifier}`;

				return row.ZALTTEXT;

			case ANAttachment.InternalLink:
				row = await this.ctx.database.get`
					SELECT ztokencontentidentifier FROM ziccloudsyncingobject 
					WHERE zidentifier = ${attr.attachmentInfo.attachmentIdentifier}`;

				return await this.getInternalLink(row.ZTOKENCONTENTIDENTIFIER, undefined, parentNotePath);

			case ANAttachment.Table:
				row = await this.ctx.database.get`
					SELECT hex(zmergeabledata1) as zhexdata FROM ziccloudsyncingobject 
					WHERE zidentifier = ${attr.attachmentInfo.attachmentIdentifier}`;

				converter = this.ctx.decodeData(row.zhexdata, TableConverter);
				return await converter.format();

			case ANAttachment.UrlCard:
				row = await this.ctx.database.get`
					SELECT ztitle, zurlstring FROM ziccloudsyncingobject 
					WHERE zidentifier = ${attr.attachmentInfo.attachmentIdentifier}`;

				return `[**${row.ZTITLE}**](${row.ZURLSTRING})`;

			case ANAttachment.Scan:
				row = await this.ctx.database.get`
					SELECT hex(zmergeabledata1) as zhexdata FROM ziccloudsyncingobject 
					WHERE zidentifier = ${attr.attachmentInfo.attachmentIdentifier}`;

				converter = this.ctx.decodeData(row.zhexdata, ScanConverter);
				return await converter.format(false, parentNotePath);

			case ANAttachment.ModifiedScan:
			case ANAttachment.DrawingLegacy:
			case ANAttachment.DrawingLegacy2:
			case ANAttachment.Drawing:
				row = await this.ctx.database.get`
					SELECT z_pk, zhandwritingsummary 
					FROM (SELECT *, NULL AS zhandwritingsummary FROM ziccloudsyncingobject) 
					WHERE zidentifier = ${attr.attachmentInfo.attachmentIdentifier}`;

				id = row?.Z_PK;
				break;

			// Actual file on disk (eg image, audio, video, pdf, vcard)
			// Hundreds of different utis so not in the enum
			default:
				row = await this.ctx.database.get`
					SELECT zmedia FROM ziccloudsyncingobject 
					WHERE zidentifier = ${attr.attachmentInfo?.attachmentIdentifier}`;

				id = row?.ZMEDIA;
				break;
		}

		if (!id) {
			// Doesn't have an associated file, so unknown
			return ` **(unknown attachment: ${attr.attachmentInfo?.typeUti})** `;
		}

		const attachment = await this.ctx.resolveAttachment(id, attr.attachmentInfo!.typeUti);
		let link = attachment
			? `\n!${this.ctx.linkTo(attachment, parentNotePath)}\n` 
			: ` **(error reading attachment)**`;
		
		if (this.ctx.includeHandwriting && row.ZHANDWRITINGSUMMARY) {
			link = `\n> [!Handwriting]-\n> ${row.ZHANDWRITINGSUMMARY.replace('\n', '\n> ')}${link}`;
		}
		
		return link;
	}

	async getInternalLink(uri: string, name: string | undefined = undefined, parentNotePath = ''): Promise<string> {
		const identifier = uri.match(NOTE_URI)![1];

		const row = await this.ctx.database.get`
			SELECT z_pk FROM ziccloudsyncingobject 
			WHERE zidentifier = ${identifier.toUpperCase()}`;

		let file = await this.ctx.resolveNote(row.Z_PK);
		if (!file) return '(unknown file link)';

		return this.ctx.linkTo(file, parentNotePath, undefined, name);
	}

	convertAlign(alignment: ANAlignment): string {
		switch (alignment) {
			default:
				return 'left';
			case ANAlignment.Centre:
				return 'center';
			case ANAlignment.Right:
				return 'right';
			case ANAlignment.Justify:
				return 'justify';
		}
	}
}

/** Wrap a highlighted run, colouring it by the marker Obsidian reads. */
function emphasise(attr: ANAttributeRun): string {
	if (!attr.emphasisColor) return attr.fragment;
	return `==${EMPHASIS_MARKERS[attr.emphasisColor] ?? ''}${attr.fragment}==`;
}

function isBlockAttachment(attr: ANAttributeRun) {
	if (!attr.attachmentInfo) return false;
	return !attr.attachmentInfo.typeUti.includes('com.apple.notes.inlinetextattachment');
}

function attrEquals(a: ANAttributeRun, b: ANAttributeRun): boolean {
	if (!b || a.$type != b.$type) return false;

	for (let field of a.$type.fieldsArray) {
		if (field.name == 'length') continue;

		if (a[field.name]?.$type && b[field.name]?.$type) {
			// Is a child ANAttributeRun
			if (!attrEquals(a[field.name], b[field.name])) return false;
		}
		else {
			if (a[field.name] != b[field.name]) return false;
		}
	}

	return true;
}
