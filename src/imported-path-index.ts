export interface ImportedPath {
	path: string;
}

export class ImportedPathIndex<T extends ImportedPath> {
	private readonly bySource = new Map<string, Map<string, T>>();
	private readonly sourceByOutput = new Map<string, string>();

	clear(): void {
		this.bySource.clear();
		this.sourceByOutput.clear();
	}

	remember(source: string, output: T): void {
		const key = normalizeTreePath(source);
		const folded = key.toLowerCase();
		let variants = this.bySource.get(folded);

		if (!variants) this.bySource.set(folded, variants = new Map<string, T>());
		variants.set(key, output);
		this.sourceByOutput.set(output.path.toLowerCase(), key);
	}

	get(source: string): T | null {
		const key = normalizeTreePath(source);
		const variants = this.bySource.get(key.toLowerCase());
		if (!variants) return null;

		return variants.get(key)
			?? (variants.size === 1 ? variants.values().next().value ?? null : null);
	}

	sourceFor(outputPath: string): string | null {
		return this.sourceByOutput.get(outputPath.toLowerCase()) ?? null;
	}
}

export function parentTreePath(path: string): string {
	return path.slice(0, Math.max(0, path.lastIndexOf('/')));
}

export function resolveTreePath(parent: string, link: string): string {
	const wanted = link.replace(/\\/g, '/').replace(/^\/+/, '');
	return normalizeTreePath(parent ? `${parent}/${wanted}` : wanted);
}

export function normalizeTreePath(path: string): string {
	const parts: string[] = [];

	for (const part of path.replace(/\\/g, '/').split('/')) {
		if (!part || part === '.') continue;
		if (part === '..') parts.pop();
		else parts.push(part);
	}

	return parts.join('/');
}
