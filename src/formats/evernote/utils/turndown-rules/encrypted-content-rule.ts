import { TurndownNode } from './turndown-types';
import { filterByNodeName } from './filter-by-nodename';
import { getAttributeProxy } from './get-attribute-proxy';

/**
 * Evernote's encrypted blocks, which nothing here can decrypt.
 *
 * The ciphertext arrived as a line of note text, indistinguishable from
 * something the note's author wrote. It is kept - the note is the only copy of
 * it - but as a code block that says what it is, with Evernote's own hint.
 */
export const encryptedContentRule = {
	filter: filterByNodeName('EN-CRYPT'),
	replacement: (content: string, node: TurndownNode) => {
		const hint = getAttributeProxy(node).hint?.value;
		const cipherText = node.textContent?.trim() ?? '';

		return `\n\nEncrypted content${hint ? ` (hint: ${hint})` : ''}:\n\n\`\`\`\n${cipherText}\n\`\`\`\n\n`;
	},
};
