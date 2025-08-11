import { AppleNotesImporter } from '../apple-notes';
import { ScanConverter } from './convert-scan';
import { TableConverter } from './convert-table';
import {
	ANAlignment,
	ANAttachment,
	ANAttributeRun,
	ANBaseline,
	ANColor,
	ANConverter,
	ANDocument,
	ANFontWeight,
	ANFragmentPair,
	ANMultiRun,
	ANNote,
	ANStyleType,
	ANTableObject
} from './models';

const FRAGMENT_SPLIT = /(^\s+|(?:\s+)?\n(?:\s+)?|\s+$)/;
const NOTE_URI = /applenotes:note\/([-0-9a-f]+)(?:\?ownerIdentifier=.*)?/;

const DEFAULT_EMOJI = '.AppleColorEmojiUI';
const LIST_STYLES = [
	ANStyleType.DottedList, ANStyleType.DashedList, ANStyleType.NumberedList, ANStyleType.Checkbox
];

export class NoteConverter extends ANConverter {
	note: ANNote;

	listNumber = 0;
	listIndent = 0;
	multiRun = ANMultiRun.None;

	static protobufType = 'ciofecaforensics.Document';

	constructor(importer: AppleNotesImporter, document: ANDocument | ANTableObject) {
		super(importer);
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
		let firstLineSkip = !table && this.importer.omitFirstLine && this.note.noteText.contains('\n');
		let converted = '';

		for (let j = 0; j < fragments.length; j++) {
			let { attr, fragment } = fragments[j];

			if (firstLineSkip) {
				if (fragment.contains('\n') || attr.attachmentInfo) {
					firstLineSkip = false;
				}
				else {
					continue;
				}
			}

			attr.fragment = fragment;
			attr.atLineStart = j == 0 ? true : fragments[j - 1]?.fragment.contains('\n');

			converted += this.formatMultiRun(attr);

			if (!/\S/.test(attr.fragment) || this.multiRun == ANMultiRun.Monospaced) {
				converted += attr.fragment;
			}
			else if (attr.attachmentInfo) {
				converted += await this.formatAttachment(attr, parentNotePath);
			}
			else if (attr.superscript || attr.underlined || attr.color || attr.font || this.multiRun == ANMultiRun.Alignment) {
				converted += await this.formatHtmlAttr(attr);
			}
			else {
				converted += await this.formatAttr(attr);
			}
		}

		if (this.multiRun != ANMultiRun.None) converted += this.formatMultiRun({} as ANAttributeRun);
		if (table) converted.replace('\n', '<br>').replace('|', '&#124;');

		return converted.trim();
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
				if (!attr.paragraphStyle?.alignment) {
					this.multiRun = ANMultiRun.None;
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
				const val = this.convertAlign(attr?.paragraphStyle?.alignment);
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
		if (attr.color) style += `color:${this.convertColor(attr.color)};`;

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

		if (attr.atLineStart) {
			return this.formatParagraph(attr);
		}
		else {
			return attr.fragment;
		}
	}

	async formatAttr(attr: ANAttributeRun): Promise<string> {
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

			case ANStyleType.Checkbox:
				const box = attr.paragraphStyle!.checklist?.done ? '[x]' : '[ ]';
				return `${prelude}${indent}- ${box} ${attr.fragment}`;
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
				row = await this.importer.database.get`
					SELECT zalttext FROM ziccloudsyncingobject 
					WHERE zidentifier = ${attr.attachmentInfo.attachmentIdentifier}`;

				return row.ZALTTEXT;

			case ANAttachment.InternalLink:
				row = await this.importer.database.get`
					SELECT ztokencontentidentifier FROM ziccloudsyncingobject 
					WHERE zidentifier = ${attr.attachmentInfo.attachmentIdentifier}`;

				return await this.getInternalLink(row.ZTOKENCONTENTIDENTIFIER, undefined, parentNotePath);

			case ANAttachment.Table:
				row = await this.importer.database.get`
					SELECT hex(zmergeabledata1) as zhexdata FROM ziccloudsyncingobject 
					WHERE zidentifier = ${attr.attachmentInfo.attachmentIdentifier}`;

				converter = this.importer.decodeData(row.zhexdata, TableConverter);
				return await converter.format();

			case ANAttachment.UrlCard:
				row = await this.importer.database.get`
					SELECT ztitle, zurlstring FROM ziccloudsyncingobject 
					WHERE zidentifier = ${attr.attachmentInfo.attachmentIdentifier}`;

				return `[**${row.ZTITLE}**](${row.ZURLSTRING})`;

			case ANAttachment.Scan:
				row = await this.importer.database.get`
					SELECT hex(zmergeabledata1) as zhexdata FROM ziccloudsyncingobject 
					WHERE zidentifier = ${attr.attachmentInfo.attachmentIdentifier}`;

				converter = this.importer.decodeData(row.zhexdata, ScanConverter);
				return await converter.format(false, parentNotePath);

			case ANAttachment.ModifiedScan:
			case ANAttachment.DrawingLegacy:
			case ANAttachment.DrawingLegacy2:
			case ANAttachment.Drawing:
				row = await this.importer.database.get`
					SELECT z_pk, zhandwritingsummary 
					FROM (SELECT *, NULL AS zhandwritingsummary FROM ziccloudsyncingobject) 
					WHERE zidentifier = ${attr.attachmentInfo.attachmentIdentifier}`;

				id = row?.Z_PK;
				break;

			// Actual file on disk (eg image, audio, video, pdf, vcard)
			// Hundreds of different utis so not in the enum
			default:
				row = await this.importer.database.get`
					SELECT zmedia FROM ziccloudsyncingobject 
					WHERE zidentifier = ${attr.attachmentInfo?.attachmentIdentifier}`;

				id = row?.ZMEDIA;
				break;
		}

		if (!id) {
			// Doesn't have an associated file, so unknown
			return ` **(unknown attachment: ${attr.attachmentInfo?.typeUti})** `;
		}

		const attachment = await this.importer.resolveAttachment(id, attr.attachmentInfo!.typeUti);
		let link = attachment
			? `\n${this.app.fileManager.generateMarkdownLink(attachment, parentNotePath)}\n` 
			: ` **(error reading attachment)**`;
		
		if (this.importer.includeHandwriting && row.ZHANDWRITINGSUMMARY) {
			link = `\n> [!Handwriting]-\n> ${row.ZHANDWRITINGSUMMARY.replace('\n', '\n> ')}${link}`;
		}
		
		return link;
	}

	async getInternalLink(uri: string, name: string | undefined = undefined, parentNotePath = ''): Promise<string> {
		const identifier = uri.match(NOTE_URI)![1];

		const row = await this.importer.database.get`
			SELECT z_pk FROM ziccloudsyncingobject 
			WHERE zidentifier = ${identifier.toUpperCase()}`;

		let file = await this.importer.resolveNote(row.Z_PK);
		if (!file) return '(unknown file link)';

		return this.app.fileManager.generateMarkdownLink(
			file, parentNotePath, undefined, name
		);
	}

	convertColor(color: ANColor): string {
		let hexcode = '#';

		for (const channel of Object.values(color)) {
			hexcode += Math.floor(channel * 255).toString(16);
		}

		return hexcode;
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
