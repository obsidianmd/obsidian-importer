import { gfm } from '@joplin/turndown-plugin-gfm';

import { YarleOptions } from '../options';
import { divRule, imagesRule, italicRule, newLineRule, spanRule, strikethroughRule, taskItemsRule, wikiStyleLinksRule } from './turndown-rules';
import { taskListRule } from './turndown-rules/task-list-rule';
import { defineRuleReplacement } from './turndown-rules/define-rule';

export const getTurndownService = (yarleOptions: YarleOptions) => {
	const turndownService = new window.TurndownService({
		br: '',
		...yarleOptions.turndownOptions,
		blankReplacement: defineRuleReplacement((content, node) => {
			return node.isBlock ? '\n\n' : '';
		}),
		keepReplacement: defineRuleReplacement((content, node) => {
			return node.isBlock ? `\n${node.outerHTML}\n` : node.outerHTML;
		}),
		defaultReplacement: defineRuleReplacement((content, node) => {
			return node.isBlock ? `\n${content}\n` : content;
		}),
	});
	turndownService.use(gfm);
	turndownService.addRule('span', spanRule);
	turndownService.addRule('strikethrough', strikethroughRule);
	turndownService.addRule('evernote task items', taskItemsRule);
	turndownService.addRule('wikistyle links', wikiStyleLinksRule);
	turndownService.addRule('images', imagesRule);
	turndownService.addRule('list', taskListRule);
	turndownService.addRule('italic', italicRule);

	if (yarleOptions.keepMDCharactersOfENNotes) {
		turndownService.escape = ((str: string) => str);
	}

	turndownService.addRule('divBlock', divRule);

	if (yarleOptions.keepOriginalAmountOfNewlines) {
		turndownService.addRule('newline', newLineRule);
	}

	return turndownService;
};
