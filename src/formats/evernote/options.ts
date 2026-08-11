import { PickedFile } from '../../filesystem';
import { TagSeparatorReplaceOptions } from './models';
import type { MarkdownOutput } from '../../markdown-output';

export interface EvernoteOptions {
	enexSources: PickedFile[];
	outputDir: string;
	skipWebClips?: boolean;
	useHashTags?: boolean;
	dateFormat?: string;
	nestedTags?: TagSeparatorReplaceOptions;
	turndownOptions?: Record<string, string | boolean>;
	obsidianTaskTag?: string;
	/** How the vault being written into indents; left out, a test's default. */
	markdownOutput?: MarkdownOutput;
}

export const defaultEvernoteOptions: EvernoteOptions = {
	enexSources: [],
	outputDir: './mdNotes',
	// The form Obsidian reads as a date and time property
	dateFormat: 'YYYY-MM-DDTHH:mm:ss',
	skipWebClips: false,
	useHashTags: true,
	nestedTags: {
		separatorInEN: '_',
		replaceSeparatorWith: '/',
		replaceSpaceWith: '-',
	},
	obsidianTaskTag: '',
	turndownOptions: {
		headingStyle: 'atx',
	},
};
