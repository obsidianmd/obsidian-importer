import { PickedFile } from '../../filesystem';
import { TagSeparatorReplaceOptions } from './models';
import type { MarkdownOutput } from '../../markdown-output';

export interface ExistingNote {
	absolutePath: string;
	writtenAt: number;
	updatedAt: number | null;
}

export type ExistingNoteDecision = 'write' | 'skip';

export interface EvernoteOptions {
	enexSources: PickedFile[];
	outputDir: string;
	skipWebClips?: boolean;
	useHashTags?: boolean;
	dateFormat?: string;
	nestedTags?: TagSeparatorReplaceOptions;
	resourcesDir: string;
	turndownOptions?: Record<string, string | boolean>;
	obsidianTaskTag?: string;
	/** How the vault being written into indents; left out, a test's default. */
	markdownOutput?: MarkdownOutput;
	/**
	 * What to do about a note an earlier import left. Left out, a note takes a
	 * name nothing is using, which is what "Create a copy" wants.
	 */
	decideExistingNote?: (existing: ExistingNote) => ExistingNoteDecision;
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
	resourcesDir: '_resources',
	turndownOptions: {
		headingStyle: 'atx',
	},
};
