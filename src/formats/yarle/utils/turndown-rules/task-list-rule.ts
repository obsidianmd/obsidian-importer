import { checkboxDone, checkboxTodo } from '../../constants';

import { getAttributeProxy } from './get-attribute-proxy';
import { isElement } from './dom-utils';
import { defineRule } from './define-rule';

const indentCharacter = '	';
export const taskListRule = defineRule({
	filter: 'li',
	replacement: (content, node, options) => {

		const isTodoDoneBlock = (node: HTMLElement) => {
			const nodeProxy = getAttributeProxy(node);
			const taskFlag = '--en-checked:true;';

			const style = nodeProxy.getNamedItem('style');
			return style?.value.includes(taskFlag);
		};
		const isTodoBlock = (node: HTMLElement) => {
			const nodeProxy = getAttributeProxy(node);
			const taskFlag = '--en-checked:false;';

			const style = nodeProxy.getNamedItem('style');
			return style?.value.includes(taskFlag);
		};

		const indentCount = content.match(/^\n*/)![0].length;
		const indentChars = indentCharacter.repeat(indentCount);

		const singleLineContent = content
			.replace(/^\n+/, '') // Remove leading newlines
			.replace(/\n+$/, '\n') // Replace trailing newlines with just a single one
			.replace(/\n/gm, `\n${indentCharacter}`); // Indent

		let prefix = indentCount > 0
			? indentChars
			: (isTodoDoneBlock(node)
				? `${checkboxDone} `
				: (isTodoBlock(node)
					? `${checkboxTodo} `
					: '* '))
		;
		const parent = node.parentNode;
		if (parent && isElement(parent) && parent.nodeName === 'OL') {
			const start = parent.getAttribute('start') || '1';
			const index = Array.prototype.indexOf.call(parent.children, node);
			prefix = `${Number.parseInt(start, 10) + index}. `;
		}

		let ret;

		ret = (prefix + singleLineContent + (node.nextSibling && !/\n$/.test(singleLineContent) ? '\n' : ''));

		return ret;
	},
});
