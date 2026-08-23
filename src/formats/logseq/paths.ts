import { LogseqFilenameFormat } from './config';

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

export function namespaceToPath(
	filenameBody: string,
	format: LogseqFilenameFormat = 'triple-lowbar',
): string {
	const separated = format === 'triple-lowbar'
		? filenameBody.replace(/___/g, '/')
		: filenameBody.replace(/\./g, '/');
	const decoded = decodeLogseqName(separated);
	return format === 'triple-lowbar'
		? decoded.split('/').filter(Boolean).join('/')
		: decoded;
}
