import { ObsidianProtocolData } from 'obsidian';

/*
 * Plugin-wide values an importer needs but the plugin object does not carry.
 *
 * Kept out of main.ts so that an importer wanting one of them does not pull in
 * the plugin, the dialog, and every other importer to get it.
 */

/**
 * URI to use as the callback for OAuth applications.
 */
export const AUTH_REDIRECT_URI: string = 'obsidian://importer-auth/';

/**
 * List of accepted attachment extensions
 */
export const ATTACHMENT_EXTS = ['png', 'webp', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'mpg', 'm4a', 'webm', 'wav', 'ogv', '3gp', 'mov', 'mp4', 'mkv', 'pdf'];

/**
 * AuthCallback is a function which will be called when the importer-auth
 * protocal is opened by an OAuth callback.
 */
export type AuthCallback = (data: ObsidianProtocolData) => void;
