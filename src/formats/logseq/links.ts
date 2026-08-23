import { outsideMarkdownCode } from '../../markdown';
import { sanitizeTag } from '../../util';
import { LogseqFilenameFormat } from './config';
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

function retainedTag(name: string): string {
	return sanitizeTag(name.replace(/\s+/g, '-')).replace(/-+/g, '-');
}

export function convertTags(content: string, dropTags: Set<string> = new Set()): string {
	return outsideMarkdownCode(content, segment => {
		segment = segment.replace(/(^|[\s([])#\[\[([^\]]+)\]\]/g, (_match: string, pre: string, name: string) => {
			const tag = retainedTag(name);
			if (dropTags.has(name) || dropTags.has(tag)) return pre;
			return tag ? `${pre}#${tag}` : pre;
		});
		segment = segment.replace(/(^|[\s([])#([\p{L}\p{M}\p{N}_/-]+)/gu,
			(match: string, pre: string, name: string) => {
				if (dropTags.has(name)) return pre;
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

export function rewritePlannedPageLinks(
	content: string,
	pages: Map<string, PlannedPageLink>,
	filenameFormat: LogseqFilenameFormat = 'triple-lowbar',
): string {
	if (pages.size === 0) return content;

	return outsideMarkdownCode(content, segment =>
		segment.replace(/(!?)\[\[([^\]|#]+)(#[^\]|]+)?(?:\|([^\]]+))?\]\]/g,
			(whole: string, bang: string, sourceTarget: string, suffix: string = '', sourceDisplay?: string) => {
				const sourceKey = namespaceToPath(sourceTarget.trim(), filenameFormat).toLowerCase();
				const planned = pages.get(sourceKey);
				if (!planned) return whole;

				const display = sourceDisplay ?? planned.display;
				return `${bang}[[${planned.target}${suffix}${display ? `|${display}` : ''}]]`;
			})
	);
}
