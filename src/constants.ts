import { getLanguage, ObsidianProtocolData } from 'obsidian';

import { availableLanguages, normalizeLanguage } from './i18n';


export const AUTH_REDIRECT_URI: string = 'obsidian://importer-auth/';

export const NOTION_ID_PROPERTY = 'notion-id';

export const ATTACHMENT_EXTS = [
	'png', 'webp', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'avif',
	'mp3', 'wav', 'm4a', '3gp', 'flac', 'ogg', 'oga', 'opus',
	'mp4', 'webm', 'ogv', 'mov', 'mkv', 'mpg',
	'pdf',
];

export type AuthCallback = (data: ObsidianProtocolData) => void;

/** Use a bundled help language, falling back to English. */
export function helpLanguage(language: string): string {
	const code = normalizeLanguage(language);
	const languages = availableLanguages();

	if (languages.includes(code)) return code;

	const base = code.split('-')[0];
	if (languages.includes(base)) return base;

	return 'en';
}

// English help pages have no language prefix.
export function helpUrl(permalink: string): string {
	const language = helpLanguage(getLanguage());
	const prefix = language === 'en' ? '' : `/${language}`;

	return `https://obsidian.md${prefix}/help/${permalink}`;
}
