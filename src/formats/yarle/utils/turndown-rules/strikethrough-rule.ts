import { languageItems } from '../../outputLanguages';
import { defineRule } from './define-rule';

// Note: this rule must appear *after* use(gfm) so it can override
// turndown-plugin-gfm rule for strikethrough (which always uses single '~')
export const strikethroughRule = defineRule({
	filter: ['del', 's', 'strike'],
	replacement: (content) => {
		return `${languageItems.strikethrough}${content}${languageItems.strikethrough}`;
	},
});
