import { filterByNodeName } from './filter-by-nodename';
import { getAttributeProxy } from './get-attribute-proxy';
import { defineRule } from './define-rule';

export const taskItemsRule = defineRule({
	filter: filterByNodeName('EN-TODO'),
	replacement: (content, node) => {
		const nodeProxy = getAttributeProxy(node);

		// If <EN-TODO> is already in <LI> (it always is in newer Evernote builds),
		// don't add an extra list bullet
		const prefix = node.parentElement?.nodeName?.toUpperCase() === 'LI' ? '' : '- ';

		const checked = nodeProxy.getNamedItem('checked');
		return `${prefix}${checked?.value === 'true' ? '[x]' : '[ ]'} ${content}`;
	},
});
