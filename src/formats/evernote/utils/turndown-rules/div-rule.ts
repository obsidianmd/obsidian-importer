import { TurndownNode } from './turndown-types';
import { filterByNodeName } from './filter-by-nodename';
import { getAttributeProxy } from './get-attribute-proxy';
import { replaceCodeBlock } from './replace-code-block';

const isTaskBlock = (node: TurndownNode) => {
	const nodeProxy = getAttributeProxy(node);
	const taskFlag = '--en-task-group:true';

	return nodeProxy.style && nodeProxy.style.value.indexOf(taskFlag) >= 0;
};
const getTaskGroupId = (node: TurndownNode) => {
	const nodeProxy = getAttributeProxy(node);
	const idAttr = '--en-id:';

	return nodeProxy.style?.value.split(idAttr)[1]?.split(';')[0] ?? '';
};

export const divRule = {
	filter: filterByNodeName('DIV'),
	replacement: (content: string, node: TurndownNode) => {
		return (isTaskBlock(node))
			? `<ENEX-EN-V10-TASK>${getTaskGroupId(node)}</ENEX-EN-V10-TASK>`
			: replaceCodeBlock(content, node);
	},
};
