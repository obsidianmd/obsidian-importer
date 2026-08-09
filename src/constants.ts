import { getLanguage, ObsidianProtocolData } from 'obsidian';


export const AUTH_REDIRECT_URI: string = 'obsidian://importer-auth/';

export const NOTION_ID_PROPERTY = 'notion-id';

/**
 * What an import can embed rather than skip.
 *
 * What Obsidian itself renders, read from `app.viewRegistry`. `mpg` is kept
 * though Obsidian does not render it, because imports rely on it downloading.
 */
export const ATTACHMENT_EXTS = [
	'png', 'webp', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'avif',
	'mp3', 'wav', 'm4a', '3gp', 'flac', 'ogg', 'oga', 'opus',
	'mp4', 'webm', 'ogv', 'mov', 'mkv', 'mpg',
	'pdf',
];

export type AuthCallback = (data: ObsidianProtocolData) => void;

// English help pages have no language prefix.
export function helpUrl(permalink: string): string {
	const language = getLanguage();
	const prefix = language === 'en' ? '' : `/${language}`;

	return `https://obsidian.md${prefix}/help/${permalink}`;
}
