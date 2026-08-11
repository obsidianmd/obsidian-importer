import { SAXParser } from 'sax';

import { PickedFile } from '../../filesystem';

/** Text with attributes uses `$text`; repeated children become arrays. */
export type EnexElement = Record<string, unknown> | string;

interface Building {
	name: string;
	attributes: boolean;
	text: string;
	children: Record<string, unknown> | null;
}

export interface EnexHandlers {
	wanted: Set<string>;
	onElement(name: string, element: EnexElement): void;
	isCancelled?(): boolean;
	/** Awaited between chunks; true stops parsing. */
	checkpoint?(): Promise<boolean>;
}

export async function parseEnex(file: PickedFile, handlers: EnexHandlers): Promise<void> {
	const { wanted, onElement, isCancelled, checkpoint } = handlers;

	// Match xml-flow's permissive, whitespace-normalizing behavior.
	const parser = new SAXParser(false, { lowercase: true, trim: true, normalize: true });

	const stack: Building[] = [];
	let failure: Error | null = null;

	parser.onerror = error => {
		failure ??= error;
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

		if (wanted.has(name)) {
			if (!isCancelled?.()) onElement(name, value);
			// Do not retain emitted notes and tasks in the parent tree.
			return;
		}

		const parent = stack[stack.length - 1];
		if (!parent) return;

		parent.children ??= {};
		const existing = parent.children[name];

		if (existing === undefined) parent.children[name] = value;
		else if (Array.isArray(existing)) existing.push(value);
		else parent.children[name] = [existing, value];
	};

	for await (const piece of file.readChunks()) {
		if (await checkpoint?.()) return;

		parser.write(piece);
		if (failure) throw failure;
	}

	parser.close();
	if (failure) throw failure;
}
