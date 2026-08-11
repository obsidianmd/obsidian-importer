import { PickedFile } from '../../filesystem';
import { TagSeparatorReplaceOptions } from './models';

export interface EvernoteOptions {
	enexSources: PickedFile[];
	outputDir: string;
	skipWebClips?: boolean;
	useHashTags?: boolean;
	dateFormat?: string;
	nestedTags?: TagSeparatorReplaceOptions;
	turndownOptions?: Record<string, string | boolean>;
	obsidianTaskTag?: string;
}

export const defaultEvernoteOptions: EvernoteOptions = {
	enexSources: [],
	outputDir: './mdNotes',
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
