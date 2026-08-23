import { outsideMarkdownCode } from '../../markdown';
import { namespaceToPath } from './paths';

export interface LinkIndex {
	aliasMap: Map<string, string>;
}

export function convertAliasLinks(content: string): string {
	return outsideMarkdownCode(content, segment =>
		segment.replace(/\[([^\]]+)\]\(\[\[([^\]]+)\]\]\)/g,
			(_match: string, display: string, target: string) => `[[${target.split('|')[0]}|${display}]]`)
	);
}

export interface ConvertTagsOptions {
	toLinks: boolean;
	onlyExistingPages: boolean;
	knownPages: Set<string>;
	dropTags: Set<string>;
}

const HEX_COLOUR = /^(?:[0-9A-Fa-f]{3,4}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/;

export function convertTags(content: string, options: ConvertTagsOptions): string {
	const { toLinks, onlyExistingPages, knownPages, dropTags } = options;

	return outsideMarkdownCode(content, segment => {
		segment = segment.replace(/(^|[\s([])#\[\[([^\]]+)\]\]/g, (_match: string, pre: string, name: string) => {
			if (dropTags.has(name) || dropTags.has(name.replace(/\s+/g, '-'))) return pre;
			if (toLinks) {
				if (onlyExistingPages && !knownPages.has(name.toLowerCase())) return `${pre}#${name.replace(/\s+/g, '-')}`;
				return `${pre}[[${name}]]`;
			}
			return `${pre}#${name.replace(/\s+/g, '-')}`;
		});
		segment = segment.replace(/(^|[\s([])#([\p{L}\p{M}\p{N}_/-]+)/gu,
			(match: string, pre: string, name: string) => {
				if (dropTags.has(name)) return pre;
				if (HEX_COLOUR.test(name) && !knownPages.has(name.toLowerCase())) return match;
				if (toLinks) {
					if (onlyExistingPages && !knownPages.has(name.toLowerCase())) return match;
					return `${pre}[[${name}]]`;
				}
				return match;
			});
		return segment;
	});
}

export function rewriteAliasReferences(content: string, index: LinkIndex): string {
	if (index.aliasMap.size === 0) return content;
	return outsideMarkdownCode(content, segment =>
		segment.replace(/(!?)\[\[([^\]]+)\]\]/g, (whole: string, bang: string, inner: string) => {
			const pipe = inner.indexOf('|');
			const target = (pipe >= 0 ? inner.slice(0, pipe) : inner).trim();
			const display = pipe >= 0 ? inner.slice(pipe + 1) : target;
			if (target.includes('#')) return whole; // block/heading ref, not a page alias
			const canonical = index.aliasMap.get(target.toLowerCase());
			if (!canonical) return whole;
			if (canonical.toLowerCase() === target.toLowerCase()) return whole;
			return `${bang}[[${canonical}|${display}]]`;
		})
	);
}

export interface PlannedPageLink {
	target: string;
	display?: string;
}

export function rewritePlannedPageLinks(content: string, pages: Map<string, PlannedPageLink>): string {
	if (pages.size === 0) return content;

	return outsideMarkdownCode(content, segment =>
		segment.replace(/(!?)\[\[([^\]|#]+)(#[^\]|]+)?(?:\|([^\]]+))?\]\]/g,
			(whole: string, bang: string, sourceTarget: string, suffix: string = '', sourceDisplay?: string) => {
				const sourceKey = namespaceToPath(sourceTarget.trim()).toLowerCase();
				const planned = pages.get(sourceKey);
				if (!planned) return whole;

				const display = sourceDisplay ?? planned.display;
				return `${bang}[[${planned.target}${suffix}${display ? `|${display}` : ''}]]`;
			})
	);
}
