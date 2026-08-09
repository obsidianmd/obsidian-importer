import { TurndownNode } from './turndown-types';
import { bullet, checkedBox, uncheckedBox } from '../../constants';

import { getAttributeProxy } from './get-attribute-proxy';

const indentCharacter = '	';
export const taskListRule = {
	filter: 'li',
	replacement: (content: string, node: TurndownNode) => {

		const isTodoDoneBlock = (node: TurndownNode) => {
			const nodeProxy = getAttributeProxy(node);
			const taskFlag = '--en-checked:true;';

			return nodeProxy.style && nodeProxy.style.value.indexOf(taskFlag) >= 0;
		};
		const isTodoBlock = (node: TurndownNode) => {
			const nodeProxy = getAttributeProxy(node);
			const taskFlag = '--en-checked:false;';

			return nodeProxy.style && nodeProxy.style.value.indexOf(taskFlag) >= 0;
		};

		const indentCount = content.match(/^\n*/)?.[0].length ?? 0;
		const indentChars = indentCharacter.repeat(indentCount);

		const singleLineContent = content
			.replace(/^\n+/, '') // Remove leading newlines
			.replace(/\n+$/, '\n') // Replace trailing newlines with just a single one
			.replace(/\n/gm, `\n${indentCharacter}`); // Indent

		// The checkbox belongs to the item; the marker in front of it belongs to
		// the list, and is a number where that list is an ordered one
		const checkbox = isTodoDoneBlock(node)
			? `${checkedBox} `
			: (isTodoBlock(node)
				? `${uncheckedBox} `
				: '');

		let prefix = indentCount > 0
			? indentChars
			: (checkbox ? `${bullet} ${checkbox}` : '* ')
		;
		const parent = node.parentElement;
		if (parent?.nodeName === 'OL') {
			const start = parent.getAttribute('start');
			const index = Array.prototype.indexOf.call(parent.children, node);
			prefix = `${(start ? Number(start) + index : index + 1)}. ${checkbox}`;
		}

		let ret;

		ret = (prefix + singleLineContent + (node.nextSibling && !/\n$/.test(singleLineContent) ? '\n' : ''));

		return ret;
	},
};
