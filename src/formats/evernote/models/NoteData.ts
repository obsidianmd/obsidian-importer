import { InternalLink } from './InternalLink';

export interface NoteData {
	title?: string;
	tags?: string;
	content: string;
	originalContent?: string;
	htmlContent: string;
	sourceUrl?: string;
	internalLinks?: Array<InternalLink>;
	reminderTime?: string;
	reminderDoneTime?: string;
}
