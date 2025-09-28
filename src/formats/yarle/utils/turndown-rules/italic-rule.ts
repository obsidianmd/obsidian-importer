import { languageItems } from '../../outputLanguages';
import { defineRule } from './define-rule';

// Note: this rule must appear *after* use(gfm) so it can override
// turndown-plugin-gfm rule for strikethrough (which always uses single '~')
export const italicRule = defineRule({
	filter: ['i'],
	replacement: (content) => {
		return (content.trim() !== '')
			? `${languageItems.italic}${content}${languageItems.italic}`
			: content;
	},
});
