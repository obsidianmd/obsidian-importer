import { getLanguage, ObsidianProtocolData } from 'obsidian';


export const AUTH_REDIRECT_URI: string = 'obsidian://importer-auth/';

export const NOTION_ID_PROPERTY = 'notion-id';

export const ATTACHMENT_EXTS = ['png', 'webp', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'mpg', 'm4a', 'webm', 'wav', 'ogv', '3gp', 'mov', 'mp4', 'mkv', 'pdf'];

export type AuthCallback = (data: ObsidianProtocolData) => void;

// English help pages have no language prefix.
export function helpUrl(permalink: string): string {
	const language = getLanguage();
	const prefix = language === 'en' ? '' : `/${language}`;

	return `https://obsidian.md${prefix}/help/${permalink}`;
}
