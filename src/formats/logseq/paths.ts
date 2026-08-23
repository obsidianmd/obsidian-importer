// Decode each run together so multi-byte UTF-8 escapes stay intact.
const PERCENT_RUN = /(?:%[0-9A-Fa-f]{2})+/g;

export function decodeLogseqName(name: string): string {
	return name.replace(PERCENT_RUN, (run) => {
		try {
			return decodeURIComponent(run);
		}
		catch {
			return run;
		}
	});
}

export function namespaceToPath(filenameBody: string): string {
	const separator = /%2F/i.test(filenameBody) ? /%2F/i : '___';
	return filenameBody
		.split(separator)
		.map(decodeLogseqName)
		.join('/');
}
