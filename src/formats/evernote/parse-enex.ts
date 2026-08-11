import { SAXParser } from 'sax';

import { PickedFile } from '../../filesystem';

/**
 * Read an ENEX, calling back with each element of interest as it closes.
 *
 * This used to be xml-flow, which builds the same objects but only over a Node
 * stream: it pipes into sax's stream half, which needs `stream` and `events`,
 * and neither is there off the desktop. sax's parser half needs nothing, and
 * the file arrives a piece at a time through PickedFile - so an import can be
 * driven with `await` between elements rather than from inside a synchronous
 * event handler.
 *
 * What an element becomes:
 *
 *   <mime>image/png</mime>                  'image/png'
 *   <data encoding="base64">AA==</data>     { $text: 'AA==' }
 *   <resource-attributes><file-name>x…      { 'file-name': 'x' }
 *   two <tag> elements                      ['one', 'two']
 *
 * An element carrying attributes keeps its text under `$text` because that is
 * the only shape that can hold both. xml-flow collapsed an element with one
 * child into that child, which is why note-attributes and resource-attributes
 * had to be collected separately and put back; nothing collapses here.
 */
export type EnexElement = Record<string, unknown> | string;

interface Building {
	name: string;
	attributes: boolean;
	text: string;
	children: Record<string, unknown> | null;
}

export interface EnexHandlers {
	/** Which element names to be called back about. */
	wanted: Set<string>;
	onElement(name: string, element: EnexElement): void;
	/** Asked as the read goes; true stops it giving anything more back. */
	isCancelled?(): boolean;
}

export async function parseEnex(file: PickedFile, handlers: EnexHandlers): Promise<void> {
	const { wanted, onElement, isCancelled } = handlers;

	// Not strict: an ENEX is html-ish in places, and this is what xml-flow used.
	// trim and normalize are what keep the indentation between elements out of
	// the text, which is why a note's title arrives without its surrounding
	// newlines.
	const parser = new SAXParser(false, { lowercase: true, trim: true, normalize: true });

	const stack: Building[] = [];
	let failure: Error | null = null;

	parser.onerror = error => {
		failure ??= error;
		// The parser refuses everything after a complaint until it is resumed,
		// and the piece it is part-way through still has to run out. The first
		// complaint is what the import is told about, once it has.
		parser.resume();
	};

	parser.onopentag = node => {
		stack.push({
			name: node.name,
			attributes: Object.keys(node.attributes).length > 0,
			text: '',
			children: null,
		});
	};

	const addText = (text: string) => {
		const top = stack[stack.length - 1];
		if (top) top.text += text;
	};

	parser.ontext = addText;
	parser.oncdata = addText;

	parser.onclosetag = name => {
		const closed = stack.pop();
		if (!closed) return;

		const value: EnexElement = closed.children ?? (closed.attributes ? { $text: closed.text } : closed.text);

		// Asked per element as well as per piece, because a file small enough to
		// arrive in one piece would otherwise be read to the end regardless.
		if (wanted.has(name) && !isCancelled?.()) onElement(name, value);

		const parent = stack[stack.length - 1];
		if (!parent) return;

		parent.children ??= {};
		const existing = parent.children[name];

		if (existing === undefined) parent.children[name] = value;
		else if (Array.isArray(existing)) existing.push(value);
		else parent.children[name] = [existing, value];
	};

	for await (const piece of file.readChunks()) {
		if (isCancelled?.()) return;

		parser.write(piece);
		if (failure) throw failure;
	}

	parser.close();
	if (failure) throw failure;
}
