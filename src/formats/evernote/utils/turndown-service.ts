import { TurndownNode } from './turndown-rules/turndown-types';
import { gfm } from '@joplin/turndown-plugin-gfm';

import { EvernoteOptions } from '../options';
import { divRule, imagesRule, italicRule, newLineRule, spanRule, strikethroughRule, taskItemsRule, wikiStyleLinksRule } from './turndown-rules';
import { taskListRule } from './turndown-rules/task-list-rule';

export const getTurndownService = (evernoteOptions: EvernoteOptions) => {
	// @ts-ignore
	const turndownService = new window.TurndownService({
		br: '',
		...evernoteOptions.turndownOptions,
		blankReplacement: (content: string, node: TurndownNode) => {
			return node.isBlock ? '\n\n' : '';
		},
		keepReplacement: (content: string, node: TurndownNode) => {
			return node.isBlock ? `\n${node.outerHTML}\n` : node.outerHTML;
		},
		defaultReplacement: (content: string, node: TurndownNode) => {
			return node.isBlock ? `\n${content}\n` : content;
		},
	});
	turndownService.use(gfm);
	turndownService.addRule('span', spanRule);
	turndownService.addRule('strikethrough', strikethroughRule);
	turndownService.addRule('evernote task items', taskItemsRule);
	turndownService.addRule('wikistyle links', wikiStyleLinksRule);
	turndownService.addRule('images', imagesRule);
	turndownService.addRule('list', taskListRule);
	turndownService.addRule('italic', italicRule);

	if (evernoteOptions.keepMDCharactersOfENNotes) {
		turndownService.escape = ((str: string) => str);
	}

	turndownService.addRule('divBlock', divRule);

	if (evernoteOptions.keepOriginalAmountOfNewlines) {
		turndownService.addRule('newline', newLineRule);
	}

	return turndownService;
};
