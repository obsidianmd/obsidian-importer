/**
 * The little of node the conversion path still reaches for.
 *
 * filesystem.ts is the seam, and it hands out node's own modules inside
 * Obsidian and whatever a host provides outside it. A browser has none of
 * them, but the paths a conversion joins are vault paths - always '/', never a
 * drive letter - so posix path is the whole of what is needed here. Anything
 * wanting fs, zlib or crypto is an importer that reads a real disk, and those
 * are not offered on the website.
 */
import { provideNodeModules } from '../src/filesystem';

function normalizeParts(parts: string[], allowAboveRoot: boolean): string[] {
	const result: string[] = [];
	for (const part of parts) {
		if (part === '' || part === '.') continue;
		if (part === '..') {
			if (result.length && result[result.length - 1] !== '..') result.pop();
			else if (allowAboveRoot) result.push('..');
		}
		else result.push(part);
	}
	return result;
}

function normalize(filepath: string): string {
	const absolute = filepath.startsWith('/');
	const trailing = filepath.endsWith('/');
	const parts = normalizeParts(filepath.split('/'), !absolute);

	let normalized = parts.join('/');
	if (normalized === '' && !absolute) normalized = '.';
	if (normalized !== '' && trailing) normalized += '/';

	return absolute ? `/${normalized}` : normalized;
}

function join(...segments: string[]): string {
	const joined = segments.filter(segment => segment !== '').join('/');
	return joined === '' ? '.' : normalize(joined);
}

function dirname(filepath: string): string {
	const at = filepath.replace(/\/+$/, '').lastIndexOf('/');
	if (at === -1) return '.';
	if (at === 0) return '/';
	return filepath.slice(0, at);
}

function extname(filepath: string): string {
	const name = filepath.slice(filepath.lastIndexOf('/') + 1);
	const dot = name.lastIndexOf('.');
	// A leading dot is the whole name, not an extension
	return dot > 0 ? name.slice(dot) : '';
}

function basename(filepath: string, ext?: string): string {
	const name = filepath.replace(/\/+$/, '').slice(filepath.replace(/\/+$/, '').lastIndexOf('/') + 1);
	return ext && name.endsWith(ext) && name !== ext ? name.slice(0, -ext.length) : name;
}

function resolve(...segments: string[]): string {
	let resolved = '';
	for (const segment of segments) {
		if (segment === '') continue;
		resolved = segment.startsWith('/') ? segment : `${resolved}/${segment}`;
	}
	const normalized = normalize(resolved);
	return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

export const browserPath = {
	sep: '/',
	delimiter: ':',
	join,
	normalize,
	dirname,
	extname,
	basename,
	resolve,
	isAbsolute: (filepath: string) => filepath.startsWith('/'),
	relative: (from: string, to: string) => {
		const fromParts = normalize(from).split('/').filter(Boolean);
		const toParts = normalize(to).split('/').filter(Boolean);
		let shared = 0;
		while (shared < fromParts.length && shared < toParts.length && fromParts[shared] === toParts[shared]) shared++;
		return [...fromParts.slice(shared).map(() => '..'), ...toParts.slice(shared)].join('/');
	},
};

/** Hand the seam what a browser can answer, and nothing it cannot. */
export function installNodeShims(): void {
	provideNodeModules({ path: browserPath as unknown as typeof import('node:path') });
}
