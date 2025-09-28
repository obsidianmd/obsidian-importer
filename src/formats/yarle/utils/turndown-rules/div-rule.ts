import { yarleOptions } from '../../yarle';
import { filterByNodeName } from './filter-by-nodename';
import { getAttributeProxy } from './get-attribute-proxy';
import { replaceCodeBlock } from './replace-code-block';
import { replaceMonospaceCodeBlock } from './replace-monospace-code-block';
import { defineRule } from './define-rule';

const getTaskGroupId = (node: HTMLElement): string | null => {
	const nodeProxy = getAttributeProxy(node);
	const taskFlag = '--en-task-group:true';
	const idAttr = '--en-id:';

	const style = nodeProxy.getNamedItem('style');
	if (style?.value.includes(taskFlag)) {
		return style.value.split(idAttr)[1].split(';')[0];
	}
	return null;
};

export const divRule = defineRule({
	filter: filterByNodeName('DIV'),
	replacement: (content: string, node: HTMLElement) => {
		const taskGroupId = getTaskGroupId(node);
		if (taskGroupId) {
			return `<YARLE-EN-V10-TASK>${taskGroupId}</YARLE-EN-V10-TASK>`;
		}
		return (yarleOptions.monospaceIsCodeBlock)
			? replaceMonospaceCodeBlock(content, node)
			: replaceCodeBlock(content, node);
	},
});
