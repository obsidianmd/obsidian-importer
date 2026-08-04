/**
 * The parts of the `obsidian` module the conversion code reaches.
 *
 * node_modules/obsidian ships type declarations only - there is no runtime
 * module - so anything importing it fails outside the app. This stands in for
 * the pieces used on the conversion path.
 *
 * It is deliberately small. If a test needs more of the API than this, that is
 * a signal the code under test is reaching into the app rather than converting
 * data, and belongs behind the sink interface instead of here.
 */
import moment from 'moment';

export { moment };

/**
 * Desktop, and not Obsidian.
 *
 * isDesktopApp is false so filesystem.ts does not try Electron's require at
 * import time; the test supplies node's real modules through
 * provideNodeModules instead.
 */
export const Platform = {
	isDesktopApp: false,
	isDesktop: true,
	isMobile: false,
	isMacOS: process.platform === 'darwin',
	isWin: process.platform === 'win32',
	isLinux: process.platform === 'linux',
};

/** Matches Obsidian's own: forward slashes, no duplicate or trailing ones. */
export function normalizePath(path: string): string {
	const normalized = path
		.replace(/([\\/])+/g, '/')
		.replace(/(^\/+|\/+$)/g, '');
	return normalized === '' ? '/' : normalized;
}
