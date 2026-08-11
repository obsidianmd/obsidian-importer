import { TurndownNode } from './turndown-rules/turndown-types';
import { gfm } from '@joplin/turndown-plugin-gfm';

import { EvernoteRun } from '../run';
import { divRule, encryptedContentRule, imagesRule, italicRule, spanRule, strikethroughRule, taskItemsRule, wikiStyleLinksRule } from './turndown-rules';
import { taskListRule } from './turndown-rules/task-list-rule';

export const getTurndownService = (run: EvernoteRun) => {
	// @ts-ignore
	const turndownService = new window.TurndownService({
		br: '',
		...run.options.turndownOptions,
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
	turndownService.addRule('evernote encrypted content', encryptedContentRule);
	turndownService.addRule('wikistyle links', wikiStyleLinksRule(run));
	turndownService.addRule('images', imagesRule);
	turndownService.addRule('list', taskListRule);
	turndownService.addRule('italic', italicRule);

	turndownService.addRule('divBlock', divRule);

	return turndownService;
};
