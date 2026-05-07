export function toWhitelist(extensions: string[]): string {
	return extensions.map(e => `*.${e}`).join(', ');
}

function parseWhitelistPatterns(whitelist: string): string[] {
	return whitelist.split(',').map(p => p.trim()).filter(p => p.length > 0);
}

function isValidPattern(pattern: string): boolean {
	if (pattern === '*') return true;
	if (/^\*\.[^*?]+$/.test(pattern)) return true;
	if (/^[^*?]+$/.test(pattern)) return true;
	return false;
}

function findUnsupportedPatterns(patterns: string[]): string[] {
	return patterns.filter(p => !isValidPattern(p));
}

function matchesPattern(filename: string, pattern: string): boolean {
	if (pattern === '*') return true;
	if (pattern.startsWith('*.')) return filename.toLowerCase().endsWith(pattern.slice(1).toLowerCase());
	return filename.toLowerCase() === pattern.toLowerCase();
}

export function findUnsupportedWhitelistPatterns(whitelist: string): string[] {
	return findUnsupportedPatterns(parseWhitelistPatterns(whitelist));
}

export function matchesAttachmentWhitelist(filename: string, whitelist: string): boolean {
	return parseWhitelistPatterns(whitelist).some(pattern => matchesPattern(filename, pattern));
}
