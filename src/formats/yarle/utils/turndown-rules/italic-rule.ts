import { languageItems } from '../../outputLanguages';

// Note: this rule must appear *after* use(gfm) so it can override
// turndown-plugin-gfm rule for strikethrough (which always uses single '~')
export const italicRule = {
	filter: ['i'],
	replacement: (content: any) => {
		return (content.trim() !== '')
			? `${languageItems.italic}${content}${languageItems.italic}`
			: content;
	},
};
