// HTML charset declarations must appear within the first 1024 bytes.
const DECLARATION_BYTES = 1024;

const CHARSET_PATTERNS = [
	// <?xml version="1.0" encoding="GB2312"?>
	/<\?xml[^>]*?\bencoding\s*=\s*["']([^"']+)["']/i,
	// <meta charset="gbk">
	/<meta[^>]*?\bcharset\s*=\s*["']?([^"'\s/>;]+)/i,
	// <meta http-equiv="Content-Type" content="text/html; charset=gbk">
	/<meta[^>]*?\bcontent\s*=\s*["'][^"']*?\bcharset\s*=\s*([^"'\s;]+)/i,
];

interface Encoding {
	decoder: TextDecoder;
	/** BOM bytes to skip. */
	offset: number;
}

function utf8(offset = 0): Encoding {
	return { decoder: new TextDecoder('utf-8'), offset };
}

// Unknown labels are ignored rather than failing the import.
function decoderFor(label: string): TextDecoder | null {
	try {
		return new TextDecoder(label);
	}
	catch {
		return null;
	}
}

export function detectEncoding(head: Uint8Array): Encoding {
	if (head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf) return utf8(3);
	if (head[0] === 0xff && head[1] === 0xfe) return { decoder: new TextDecoder('utf-16le'), offset: 2 };
	if (head[0] === 0xfe && head[1] === 0xff) return { decoder: new TextDecoder('utf-16be'), offset: 2 };

	// Latin-1 exposes an ASCII declaration before its encoding is known.
	const declaration = new TextDecoder('latin1').decode(head.subarray(0, DECLARATION_BYTES));

	for (const pattern of CHARSET_PATTERNS) {
		const label = pattern.exec(declaration)?.[1];
		if (!label) continue;

		const decoder = decoderFor(label.trim());
		return decoder ? { decoder, offset: 0 } : utf8();
	}

	return utf8();
}

export function decodeText(bytes: Uint8Array): string {
	const { decoder, offset } = detectEncoding(bytes);
	return decoder.decode(bytes.subarray(offset));
}

// The first chunk must contain every byte considered for a declaration.
export async function* decodeChunks(chunks: AsyncIterable<Uint8Array>): AsyncIterable<string> {
	let decoder: TextDecoder | undefined;

	for await (const chunk of chunks) {
		let bytes = chunk;

		if (!decoder) {
			const encoding = detectEncoding(chunk);
			decoder = encoding.decoder;
			bytes = chunk.subarray(encoding.offset);
		}

		const piece = decoder.decode(bytes, { stream: true });
		if (piece) yield piece;
	}

	const tail = decoder?.decode();
	if (tail) yield tail;
}
