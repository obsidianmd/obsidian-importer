import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BlockConverter } from '../../../src/formats/notion-api/block-converter';
import type { BlockObjectResponse, RichTextItemResponse } from '@notionhq/client/build/src/api-endpoints';

const mockVault = {
	create: vi.fn(),
	createBinary: vi.fn(),
	exists: vi.fn()
} as any;

const mockClient = {
	getAllBlockChildren: vi.fn()
} as any;

describe('BlockConverter', () => {
	let converter: BlockConverter;

	beforeEach(() => {
		converter = new BlockConverter(mockClient, mockVault, '/attachments');
		vi.clearAllMocks();
	});

	describe('Rich Text Conversion', () => {
		it('should convert plain text', () => {
			const richText: RichTextItemResponse[] = [
				{
					type: 'text',
					text: { content: 'Hello world', link: null },
					plain_text: 'Hello world',
					href: null,
					annotations: {
						bold: false,
						italic: false,
						strikethrough: false,
						underline: false,
						code: false,
						color: 'default'
					}
				}
			];

			const result = (converter as any).convertRichText(richText);
			expect(result).toBe('Hello world');
		});

		it('should convert bold text', () => {
			const richText: RichTextItemResponse[] = [
				{
					type: 'text',
					text: { content: 'bold text', link: null },
					plain_text: 'bold text',
					href: null,
					annotations: {
						bold: true,
						italic: false,
						strikethrough: false,
						underline: false,
						code: false,
						color: 'default'
					}
				}
			];

			const result = (converter as any).convertRichText(richText);
			expect(result).toBe('**bold text**');
		});

		it('should convert italic text', () => {
			const richText: RichTextItemResponse[] = [
				{
					type: 'text',
					text: { content: 'italic text', link: null },
					plain_text: 'italic text',
					href: null,
					annotations: {
						bold: false,
						italic: true,
						strikethrough: false,
						underline: false,
						code: false,
						color: 'default'
					}
				}
			];

			const result = (converter as any).convertRichText(richText);
			expect(result).toBe('*italic text*');
		});

		it('should convert strikethrough text', () => {
			const richText: RichTextItemResponse[] = [
				{
					type: 'text',
					text: { content: 'deleted text', link: null },
					plain_text: 'deleted text',
					href: null,
					annotations: {
						bold: false,
						italic: false,
						strikethrough: true,
						underline: false,
						code: false,
						color: 'default'
					}
				}
			];

			const result = (converter as any).convertRichText(richText);
			expect(result).toBe('~~deleted text~~');
		});

		it('should convert inline code', () => {
			const richText: RichTextItemResponse[] = [
				{
					type: 'text',
					text: { content: 'console.log()', link: null },
					plain_text: 'console.log()',
					href: null,
					annotations: {
						bold: false,
						italic: false,
						strikethrough: false,
						underline: false,
						code: true,
						color: 'default'
					}
				}
			];

			const result = (converter as any).convertRichText(richText);
			expect(result).toBe('`console.log()`');
		});

		it('should convert text with link', () => {
			const richText: RichTextItemResponse[] = [
				{
					type: 'text',
					text: {
						content: 'click here',
						link: { url: 'https://example.com' }
					},
					plain_text: 'click here',
					href: 'https://example.com',
					annotations: {
						bold: false,
						italic: false,
						strikethrough: false,
						underline: false,
						code: false,
						color: 'default'
					}
				}
			];

			const result = (converter as any).convertRichText(richText);
			expect(result).toBe('[click here](https://example.com)');
		});

		it('should combine multiple formatting styles', () => {
			const richText: RichTextItemResponse[] = [
				{
					type: 'text',
					text: { content: 'bold italic', link: null },
					plain_text: 'bold italic',
					href: null,
					annotations: {
						bold: true,
						italic: true,
						strikethrough: false,
						underline: false,
						code: false,
						color: 'default'
					}
				}
			];

			const result = (converter as any).convertRichText(richText);
			expect(result).toBe('***bold italic***');
		});

		it('should handle multiple rich text parts', () => {
			const richText: RichTextItemResponse[] = [
				{
					type: 'text',
					text: { content: 'Normal ', link: null },
					plain_text: 'Normal ',
					href: null,
					annotations: {
						bold: false,
						italic: false,
						strikethrough: false,
						underline: false,
						code: false,
						color: 'default'
					}
				},
				{
					type: 'text',
					text: { content: 'bold', link: null },
					plain_text: 'bold',
					href: null,
					annotations: {
						bold: true,
						italic: false,
						strikethrough: false,
						underline: false,
						code: false,
						color: 'default'
					}
				},
				{
					type: 'text',
					text: { content: ' and ', link: null },
					plain_text: ' and ',
					href: null,
					annotations: {
						bold: false,
						italic: false,
						strikethrough: false,
						underline: false,
						code: false,
						color: 'default'
					}
				},
				{
					type: 'text',
					text: { content: 'italic', link: null },
					plain_text: 'italic',
					href: null,
					annotations: {
						bold: false,
						italic: true,
						strikethrough: false,
						underline: false,
						code: false,
						color: 'default'
					}
				}
			];

			const result = (converter as any).convertRichText(richText);
			expect(result).toBe('Normal **bold** and *italic*');
		});

		it('should convert equation type', () => {
			const richText: RichTextItemResponse[] = [
				{
					type: 'equation',
					equation: { expression: 'x^2 + y^2 = z^2' },
					plain_text: 'x^2 + y^2 = z^2',
					href: null,
					annotations: {
						bold: false,
						italic: false,
						strikethrough: false,
						underline: false,
						code: false,
						color: 'default'
					}
				}
			];

			const result = (converter as any).convertRichText(richText);
			expect(result).toBe('$x^2 + y^2 = z^2$');
		});

		it('should convert page mention', () => {
			const richText: RichTextItemResponse[] = [
				{
					type: 'mention',
					mention: {
						type: 'page',
						page: { id: 'page-id' }
					},
					plain_text: 'Referenced Page',
					href: null,
					annotations: {
						bold: false,
						italic: false,
						strikethrough: false,
						underline: false,
						code: false,
						color: 'default'
					}
				}
			];

			const result = (converter as any).convertRichText(richText);
			expect(result).toBe('[[Referenced Page]]');
		});
	});

	describe('Block Type Conversion', () => {
		it('should convert heading_1 block', () => {
			const block: BlockObjectResponse = {
				object: 'block',
				id: 'block-1',
				type: 'heading_1',
				heading_1: {
					rich_text: [{
						type: 'text',
						text: { content: 'Main Title' },
						plain_text: 'Main Title',
						annotations: {} as any
					}],
					is_toggleable: false,
					color: 'default'
				},
				has_children: false,
				created_time: '2024-01-01T00:00:00.000Z',
				last_edited_time: '2024-01-01T00:00:00.000Z',
				parent: {} as any
			} as any;

			const result = (converter as any).convertHeading(block, 1);
			expect(result).toBe('# Main Title');
		});

		it('should convert heading_2 block', () => {
			const block: BlockObjectResponse = {
				object: 'block',
				id: 'block-2',
				type: 'heading_2',
				heading_2: {
					rich_text: [{
						type: 'text',
						text: { content: 'Section' },
						plain_text: 'Section',
						annotations: {} as any
					}],
					is_toggleable: false,
					color: 'default'
				},
				has_children: false
			} as any;

			const result = (converter as any).convertHeading(block, 2);
			expect(result).toBe('## Section');
		});

		it('should convert heading_3 block', () => {
			const block: BlockObjectResponse = {
				object: 'block',
				id: 'block-3',
				type: 'heading_3',
				heading_3: {
					rich_text: [{
						type: 'text',
						text: { content: 'Subsection' },
						plain_text: 'Subsection',
						annotations: {} as any
					}],
					is_toggleable: false,
					color: 'default'
				},
				has_children: false
			} as any;

			const result = (converter as any).convertHeading(block, 3);
			expect(result).toBe('### Subsection');
		});

		it('should convert code block', () => {
			const block: BlockObjectResponse = {
				object: 'block',
				id: 'block-code',
				type: 'code',
				code: {
					language: 'typescript',
					rich_text: [{
						type: 'text',
						text: { content: 'const x = 10;' },
						plain_text: 'const x = 10;',
						annotations: {} as any
					}],
					caption: []
				},
				has_children: false
			} as any;

			const result = (converter as any).convertCode(block);
			expect(result).toBe('```typescript\nconst x = 10;\n```');
		});

		it('should convert divider block', async () => {
			const block: BlockObjectResponse = {
				object: 'block',
				id: 'block-divider',
				type: 'divider',
				divider: {},
				has_children: false
			} as any;

			const context = {
				vault: mockVault,
				client: mockClient,
				attachmentFolder: '/attachments',
				indentLevel: 0,
				listCounters: new Map()
			};

			const result = await (converter as any).convertBlock(block, context);
			expect(result).toBe('---');
		});

		it('should convert bookmark block', () => {
			const block: BlockObjectResponse = {
				object: 'block',
				id: 'block-bookmark',
				type: 'bookmark',
				bookmark: {
					url: 'https://example.com',
					caption: [{
						type: 'text',
						text: { content: 'Example Site' },
						plain_text: 'Example Site',
						annotations: {} as any
					}]
				},
				has_children: false
			} as any;

			const result = (converter as any).convertBookmark(block);
			expect(result).toBe('[Example Site](https://example.com)');
		});

		it('should convert child_page block', () => {
			const block: BlockObjectResponse = {
				object: 'block',
				id: 'block-child',
				type: 'child_page',
				child_page: {
					title: 'Child Page Name'
				},
				has_children: false
			} as any;

			const result = (converter as any).convertChildPage(block);
			expect(result).toBe('[[Child Page Name]]');
		});

		it('should convert equation block', () => {
			const block: BlockObjectResponse = {
				object: 'block',
				id: 'block-eq',
				type: 'equation',
				equation: {
					expression: 'E = mc^2'
				},
				has_children: false
			} as any;

			const result = (converter as any).convertEquation(block);
			expect(result).toBe('$$\nE = mc^2\n$$');
		});
	});

	describe('List Block Conversion', () => {
		it('should convert bulleted list item', async () => {
			const block: BlockObjectResponse = {
				object: 'block',
				id: 'list-1',
				type: 'bulleted_list_item',
				bulleted_list_item: {
					rich_text: [{
						type: 'text',
						text: { content: 'List item' },
						plain_text: 'List item',
						annotations: {} as any
					}],
					color: 'default'
				},
				has_children: false
			} as any;

			const context = {
				vault: mockVault,
				client: mockClient,
				attachmentFolder: '/attachments',
				indentLevel: 0,
				listCounters: new Map()
			};

			const result = await (converter as any).convertBulletedListItem(block, context, '');
			expect(result).toBe('- List item');
		});

		it('should convert numbered list item', async () => {
			const block: BlockObjectResponse = {
				object: 'block',
				id: 'list-2',
				type: 'numbered_list_item',
				numbered_list_item: {
					rich_text: [{
						type: 'text',
						text: { content: 'First item' },
						plain_text: 'First item',
						annotations: {} as any
					}],
					color: 'default'
				},
				has_children: false
			} as any;

			const context = {
				vault: mockVault,
				client: mockClient,
				attachmentFolder: '/attachments',
				indentLevel: 0,
				listCounters: new Map()
			};

			const result = await (converter as any).convertNumberedListItem(block, context, '');
			expect(result).toBe('1. First item');
		});

		it('should convert to-do item unchecked', async () => {
			const block: BlockObjectResponse = {
				object: 'block',
				id: 'todo-1',
				type: 'to_do',
				to_do: {
					checked: false,
					rich_text: [{
						type: 'text',
						text: { content: 'Task to do' },
						plain_text: 'Task to do',
						annotations: {} as any
					}],
					color: 'default'
				},
				has_children: false
			} as any;

			const context = {
				vault: mockVault,
				client: mockClient,
				attachmentFolder: '/attachments',
				indentLevel: 0,
				listCounters: new Map()
			};

			const result = await (converter as any).convertToDo(block, context, '');
			expect(result).toBe('- [ ] Task to do');
		});

		it('should convert to-do item checked', async () => {
			const block: BlockObjectResponse = {
				object: 'block',
				id: 'todo-2',
				type: 'to_do',
				to_do: {
					checked: true,
					rich_text: [{
						type: 'text',
						text: { content: 'Completed task' },
						plain_text: 'Completed task',
						annotations: {} as any
					}],
					color: 'default'
				},
				has_children: false
			} as any;

			const context = {
				vault: mockVault,
				client: mockClient,
				attachmentFolder: '/attachments',
				indentLevel: 0,
				listCounters: new Map()
			};

			const result = await (converter as any).convertToDo(block, context, '');
			expect(result).toBe('- [x] Completed task');
		});
	});

	describe('Quote and Callout Blocks', () => {
		it('should convert quote block', async () => {
			const block: BlockObjectResponse = {
				object: 'block',
				id: 'quote-1',
				type: 'quote',
				quote: {
					rich_text: [{
						type: 'text',
						text: { content: 'Important quote' },
						plain_text: 'Important quote',
						annotations: {} as any
					}],
					color: 'default'
				},
				has_children: false
			} as any;

			mockClient.getAllBlockChildren.mockResolvedValue([]);

			const context = {
				vault: mockVault,
				client: mockClient,
				attachmentFolder: '/attachments',
				indentLevel: 0,
				listCounters: new Map()
			};

			const result = await (converter as any).convertQuote(block, context);
			expect(result).toBe('> Important quote');
		});

		it('should convert callout block with emoji', async () => {
			const block: BlockObjectResponse = {
				object: 'block',
				id: 'callout-1',
				type: 'callout',
				callout: {
					icon: {
						type: 'emoji',
						emoji: '💡'
					},
					rich_text: [{
						type: 'text',
						text: { content: 'Tip' },
						plain_text: 'Tip',
						annotations: {} as any
					}],
					color: 'default'
				},
				has_children: false
			} as any;

			mockClient.getAllBlockChildren.mockResolvedValue([]);

			const context = {
				vault: mockVault,
				client: mockClient,
				attachmentFolder: '/attachments',
				indentLevel: 0,
				listCounters: new Map()
			};

			const result = await (converter as any).convertCallout(block, context);
			expect(result).toBe('> [!note] 💡\n> Tip');
		});
	});

	describe('Edge Cases', () => {
		it('should handle empty rich text', () => {
			const richText: RichTextItemResponse[] = [];
			const result = (converter as any).convertRichText(richText);
			expect(result).toBe('');
		});

		it('should handle rich text with no content', () => {
			const richText: RichTextItemResponse[] = [
				{
					type: 'text',
					text: { content: '', link: null },
					plain_text: '',
					href: null,
					annotations: {} as any
				}
			];
			const result = (converter as any).convertRichText(richText);
			expect(result).toBe('');
		});

		it('should handle unsupported block type', async () => {
			const block = {
				object: 'block',
				id: 'unsupported',
				type: 'unsupported_type',
				has_children: false
			} as any;

			const context = {
				vault: mockVault,
				client: mockClient,
				attachmentFolder: '/attachments',
				indentLevel: 0,
				listCounters: new Map()
			};

			const result = await (converter as any).convertBlock(block, context);
			expect(result).toContain('<!-- Unsupported block type: unsupported_type -->');
		});
	});

	describe('Filename Extraction', () => {
		it('should extract filename from URL', () => {
			const url = 'https://example.com/path/to/file.png';
			const result = (converter as any).extractFilenameFromUrl(url);
			expect(result).toBe('file.png');
		});

		it('should handle URL with query parameters', () => {
			const url = 'https://example.com/image.jpg?size=large';
			const result = (converter as any).extractFilenameFromUrl(url);
			expect(result).toBe('image.jpg');
		});

		it('should handle URL with encoded characters', () => {
			const url = 'https://example.com/my%20file.pdf';
			const result = (converter as any).extractFilenameFromUrl(url);
			expect(result).toBe('my file.pdf');
		});

		it('should return default filename for invalid URL', () => {
			const url = 'not-a-url';
			const result = (converter as any).extractFilenameFromUrl(url);
			expect(result).toBe('attachment');
		});
	});

	describe('Table Conversion', () => {
		it('should convert table with column headers', async () => {
			const tableBlock: BlockObjectResponse = {
				object: 'block',
				id: 'table-1',
				type: 'table',
				created_time: '2024-01-01T00:00:00.000Z',
				last_edited_time: '2024-01-01T00:00:00.000Z',
				has_children: true,
				archived: false,
				in_trash: false,
				table: {
					table_width: 3,
					has_column_header: true,
					has_row_header: false
				},
				parent: { type: 'page_id', page_id: 'page-1' },
				created_by: { object: 'user', id: 'user-1' },
				last_edited_by: { object: 'user', id: 'user-1' }
			} as any;

			const row1: BlockObjectResponse = {
				object: 'block',
				id: 'row-1',
				type: 'table_row',
				created_time: '2024-01-01T00:00:00.000Z',
				last_edited_time: '2024-01-01T00:00:00.000Z',
				has_children: false,
				archived: false,
				in_trash: false,
				table_row: {
					cells: [
						[{ type: 'text', text: { content: 'Name' }, plain_text: 'Name', annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' } }],
						[{ type: 'text', text: { content: 'Age' }, plain_text: 'Age', annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' } }],
						[{ type: 'text', text: { content: 'City' }, plain_text: 'City', annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' } }]
					]
				},
				parent: { type: 'block_id', block_id: 'table-1' },
				created_by: { object: 'user', id: 'user-1' },
				last_edited_by: { object: 'user', id: 'user-1' }
			} as any;

			const row2: BlockObjectResponse = {
				object: 'block',
				id: 'row-2',
				type: 'table_row',
				created_time: '2024-01-01T00:00:00.000Z',
				last_edited_time: '2024-01-01T00:00:00.000Z',
				has_children: false,
				archived: false,
				in_trash: false,
				table_row: {
					cells: [
						[{ type: 'text', text: { content: 'John' }, plain_text: 'John', annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' } }],
						[{ type: 'text', text: { content: '30' }, plain_text: '30', annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' } }],
						[{ type: 'text', text: { content: 'NYC' }, plain_text: 'NYC', annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' } }]
					]
				},
				parent: { type: 'block_id', block_id: 'table-1' },
				created_by: { object: 'user', id: 'user-1' },
				last_edited_by: { object: 'user', id: 'user-1' }
			} as any;

			mockClient.getAllBlockChildren.mockResolvedValue([row1, row2]);

			const context = { vault: mockVault, client: mockClient, attachmentFolder: '/attachments', indentLevel: 0, listCounters: new Map() };
			const result = await (converter as any).convertTable(tableBlock, context);

			expect(result).toBe('| Name | Age | City |\n| --- | --- | --- |\n| John | 30 | NYC |');
		});

		it('should convert table without headers', async () => {
			const tableBlock: BlockObjectResponse = {
				object: 'block',
				id: 'table-2',
				type: 'table',
				created_time: '2024-01-01T00:00:00.000Z',
				last_edited_time: '2024-01-01T00:00:00.000Z',
				has_children: true,
				archived: false,
				in_trash: false,
				table: {
					table_width: 2,
					has_column_header: false,
					has_row_header: false
				},
				parent: { type: 'page_id', page_id: 'page-1' },
				created_by: { object: 'user', id: 'user-1' },
				last_edited_by: { object: 'user', id: 'user-1' }
			} as any;

			const row: BlockObjectResponse = {
				object: 'block',
				id: 'row-1',
				type: 'table_row',
				created_time: '2024-01-01T00:00:00.000Z',
				last_edited_time: '2024-01-01T00:00:00.000Z',
				has_children: false,
				archived: false,
				in_trash: false,
				table_row: {
					cells: [
						[{ type: 'text', text: { content: 'A' }, plain_text: 'A', annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' } }],
						[{ type: 'text', text: { content: 'B' }, plain_text: 'B', annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' } }]
					]
				},
				parent: { type: 'block_id', block_id: 'table-2' },
				created_by: { object: 'user', id: 'user-1' },
				last_edited_by: { object: 'user', id: 'user-1' }
			} as any;

			mockClient.getAllBlockChildren.mockResolvedValue([row]);

			const context = { vault: mockVault, client: mockClient, attachmentFolder: '/attachments', indentLevel: 0, listCounters: new Map() };
			const result = await (converter as any).convertTable(tableBlock, context);

			expect(result).toBe('| A | B |');
		});

		it('should handle empty table cells', async () => {
			const tableBlock: BlockObjectResponse = {
				object: 'block',
				id: 'table-3',
				type: 'table',
				created_time: '2024-01-01T00:00:00.000Z',
				last_edited_time: '2024-01-01T00:00:00.000Z',
				has_children: true,
				archived: false,
				in_trash: false,
				table: {
					table_width: 2,
					has_column_header: true,
					has_row_header: false
				},
				parent: { type: 'page_id', page_id: 'page-1' },
				created_by: { object: 'user', id: 'user-1' },
				last_edited_by: { object: 'user', id: 'user-1' }
			} as any;

			const row: BlockObjectResponse = {
				object: 'block',
				id: 'row-1',
				type: 'table_row',
				created_time: '2024-01-01T00:00:00.000Z',
				last_edited_time: '2024-01-01T00:00:00.000Z',
				has_children: false,
				archived: false,
				in_trash: false,
				table_row: {
					cells: [
						[{ type: 'text', text: { content: 'A' }, plain_text: 'A', annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' } }],
						[]
					]
				},
				parent: { type: 'block_id', block_id: 'table-3' },
				created_by: { object: 'user', id: 'user-1' },
				last_edited_by: { object: 'user', id: 'user-1' }
			} as any;

			mockClient.getAllBlockChildren.mockResolvedValue([row]);

			const context = { vault: mockVault, client: mockClient, attachmentFolder: '/attachments', indentLevel: 0, listCounters: new Map() };
			const result = await (converter as any).convertTable(tableBlock, context);

			expect(result).toBe('| A |  |\n| --- | --- |');
		});

		it('should return empty string for table with no rows', async () => {
			const tableBlock: BlockObjectResponse = {
				object: 'block',
				id: 'table-4',
				type: 'table',
				created_time: '2024-01-01T00:00:00.000Z',
				last_edited_time: '2024-01-01T00:00:00.000Z',
				has_children: true,
				archived: false,
				in_trash: false,
				table: {
					table_width: 2,
					has_column_header: false,
					has_row_header: false
				},
				parent: { type: 'page_id', page_id: 'page-1' },
				created_by: { object: 'user', id: 'user-1' },
				last_edited_by: { object: 'user', id: 'user-1' }
			} as any;

			mockClient.getAllBlockChildren.mockResolvedValue([]);

			const context = { vault: mockVault, client: mockClient, attachmentFolder: '/attachments', indentLevel: 0, listCounters: new Map() };
			const result = await (converter as any).convertTable(tableBlock, context);

			expect(result).toBe('');
		});
	});

	describe('Image Conversion', () => {
		it('should convert external image to markdown embed', async () => {
			const imageBlock: BlockObjectResponse = {
				object: 'block',
				id: 'image-1',
				type: 'image',
				created_time: '2024-01-01T00:00:00.000Z',
				last_edited_time: '2024-01-01T00:00:00.000Z',
				has_children: false,
				archived: false,
				in_trash: false,
				image: {
					type: 'external',
					external: {
						url: 'https://example.com/image.png'
					},
					caption: []
				},
				parent: { type: 'page_id', page_id: 'page-1' },
				created_by: { object: 'user', id: 'user-1' },
				last_edited_by: { object: 'user', id: 'user-1' }
			} as any;

			mockVault.createBinary.mockResolvedValue(undefined);
			global.fetch = vi.fn().mockResolvedValue({
				ok: true,
				arrayBuffer: async () => new ArrayBuffer(0)
			});

			const context = { vault: mockVault, client: mockClient, attachmentFolder: '/attachments', indentLevel: 0, listCounters: new Map() };
			const result = await (converter as any).convertImage(imageBlock, context);

			expect(result).toBe('![](image.png)');
			expect(mockVault.createBinary).toHaveBeenCalled();
		});

		it('should convert uploaded image with file URL', async () => {
			const imageBlock: BlockObjectResponse = {
				object: 'block',
				id: 'image-2',
				type: 'image',
				created_time: '2024-01-01T00:00:00.000Z',
				last_edited_time: '2024-01-01T00:00:00.000Z',
				has_children: false,
				archived: false,
				in_trash: false,
				image: {
					type: 'file',
					file: {
						url: 'https://notion.so/signed/file.jpg',
						expiry_time: '2024-01-02T00:00:00.000Z'
					},
					caption: []
				},
				parent: { type: 'page_id', page_id: 'page-1' },
				created_by: { object: 'user', id: 'user-1' },
				last_edited_by: { object: 'user', id: 'user-1' }
			} as any;

			mockVault.createBinary.mockResolvedValue(undefined);
			global.fetch = vi.fn().mockResolvedValue({
				ok: true,
				arrayBuffer: async () => new ArrayBuffer(0)
			});

			const context = { vault: mockVault, client: mockClient, attachmentFolder: '/attachments', indentLevel: 0, listCounters: new Map() };
			const result = await (converter as any).convertImage(imageBlock, context);

			expect(result).toBe('![](file.jpg)');
		});

		it('should include caption in image markdown', async () => {
			const imageBlock: BlockObjectResponse = {
				object: 'block',
				id: 'image-3',
				type: 'image',
				created_time: '2024-01-01T00:00:00.000Z',
				last_edited_time: '2024-01-01T00:00:00.000Z',
				has_children: false,
				archived: false,
				in_trash: false,
				image: {
					type: 'external',
					external: {
						url: 'https://example.com/photo.jpg'
					},
					caption: [
						{ type: 'text', text: { content: 'My Photo' }, plain_text: 'My Photo', annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' } }
					]
				},
				parent: { type: 'page_id', page_id: 'page-1' },
				created_by: { object: 'user', id: 'user-1' },
				last_edited_by: { object: 'user', id: 'user-1' }
			} as any;

			mockVault.createBinary.mockResolvedValue(undefined);
			global.fetch = vi.fn().mockResolvedValue({
				ok: true,
				arrayBuffer: async () => new ArrayBuffer(0)
			});

			const context = { vault: mockVault, client: mockClient, attachmentFolder: '/attachments', indentLevel: 0, listCounters: new Map() };
			const result = await (converter as any).convertImage(imageBlock, context);

			expect(result).toBe('![My Photo](photo.jpg)');
		});

		it('should fallback to URL if download fails', async () => {
			const imageBlock: BlockObjectResponse = {
				object: 'block',
				id: 'image-4',
				type: 'image',
				created_time: '2024-01-01T00:00:00.000Z',
				last_edited_time: '2024-01-01T00:00:00.000Z',
				has_children: false,
				archived: false,
				in_trash: false,
				image: {
					type: 'external',
					external: {
						url: 'https://example.com/image.png'
					},
					caption: []
				},
				parent: { type: 'page_id', page_id: 'page-1' },
				created_by: { object: 'user', id: 'user-1' },
				last_edited_by: { object: 'user', id: 'user-1' }
			} as any;

			global.fetch = vi.fn().mockResolvedValue({
				ok: false
			});

			const context = { vault: mockVault, client: mockClient, attachmentFolder: '/attachments', indentLevel: 0, listCounters: new Map() };
			const result = await (converter as any).convertImage(imageBlock, context);

			expect(result).toBe('![](https://example.com/image.png)');
		});

		it('should return empty string for image without URL', async () => {
			const imageBlock: BlockObjectResponse = {
				object: 'block',
				id: 'image-5',
				type: 'image',
				created_time: '2024-01-01T00:00:00.000Z',
				last_edited_time: '2024-01-01T00:00:00.000Z',
				has_children: false,
				archived: false,
				in_trash: false,
				image: {
					type: 'external',
					external: {
						url: ''
					},
					caption: []
				},
				parent: { type: 'page_id', page_id: 'page-1' },
				created_by: { object: 'user', id: 'user-1' },
				last_edited_by: { object: 'user', id: 'user-1' }
			} as any;

			const context = { vault: mockVault, client: mockClient, attachmentFolder: '/attachments', indentLevel: 0, listCounters: new Map() };
			const result = await (converter as any).convertImage(imageBlock, context);

			expect(result).toBe('');
		});
	});

	describe('File Attachment Conversion', () => {
		it('should convert external file attachment', async () => {
			const fileBlock: BlockObjectResponse = {
				object: 'block',
				id: 'file-1',
				type: 'file',
				created_time: '2024-01-01T00:00:00.000Z',
				last_edited_time: '2024-01-01T00:00:00.000Z',
				has_children: false,
				archived: false,
				in_trash: false,
				file: {
					type: 'external',
					external: {
						url: 'https://example.com/document.pdf'
					},
					caption: []
				},
				parent: { type: 'page_id', page_id: 'page-1' },
				created_by: { object: 'user', id: 'user-1' },
				last_edited_by: { object: 'user', id: 'user-1' }
			} as any;

			mockVault.createBinary.mockResolvedValue(undefined);
			global.fetch = vi.fn().mockResolvedValue({
				ok: true,
				arrayBuffer: async () => new ArrayBuffer(0)
			});

			const context = { vault: mockVault, client: mockClient, attachmentFolder: '/attachments', indentLevel: 0, listCounters: new Map() };
			const result = await (converter as any).convertFile(fileBlock, context);

			expect(result).toBe('[document.pdf](document.pdf)');
			expect(mockVault.createBinary).toHaveBeenCalled();
		});

		it('should convert uploaded file with caption', async () => {
			const fileBlock: BlockObjectResponse = {
				object: 'block',
				id: 'file-2',
				type: 'file',
				created_time: '2024-01-01T00:00:00.000Z',
				last_edited_time: '2024-01-01T00:00:00.000Z',
				has_children: false,
				archived: false,
				in_trash: false,
				file: {
					type: 'file',
					file: {
						url: 'https://notion.so/signed/report.docx',
						expiry_time: '2024-01-02T00:00:00.000Z'
					},
					caption: [
						{ type: 'text', text: { content: 'Monthly Report' }, plain_text: 'Monthly Report', annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' } }
					]
				},
				parent: { type: 'page_id', page_id: 'page-1' },
				created_by: { object: 'user', id: 'user-1' },
				last_edited_by: { object: 'user', id: 'user-1' }
			} as any;

			mockVault.createBinary.mockResolvedValue(undefined);
			global.fetch = vi.fn().mockResolvedValue({
				ok: true,
				arrayBuffer: async () => new ArrayBuffer(0)
			});

			const context = { vault: mockVault, client: mockClient, attachmentFolder: '/attachments', indentLevel: 0, listCounters: new Map() };
			const result = await (converter as any).convertFile(fileBlock, context);

			expect(result).toBe('[Monthly Report](Monthly_Report)');
		});

		it('should fallback to URL if file download fails', async () => {
			const fileBlock: BlockObjectResponse = {
				object: 'block',
				id: 'file-3',
				type: 'file',
				created_time: '2024-01-01T00:00:00.000Z',
				last_edited_time: '2024-01-01T00:00:00.000Z',
				has_children: false,
				archived: false,
				in_trash: false,
				file: {
					type: 'external',
					external: {
						url: 'https://example.com/video.mp4'
					},
					caption: []
				},
				parent: { type: 'page_id', page_id: 'page-1' },
				created_by: { object: 'user', id: 'user-1' },
				last_edited_by: { object: 'user', id: 'user-1' }
			} as any;

			global.fetch = vi.fn().mockResolvedValue({
				ok: false
			});

			const context = { vault: mockVault, client: mockClient, attachmentFolder: '/attachments', indentLevel: 0, listCounters: new Map() };
			const result = await (converter as any).convertFile(fileBlock, context);

			expect(result).toBe('[video.mp4](https://example.com/video.mp4)');
		});

		it('should return empty string for file without URL', async () => {
			const fileBlock: BlockObjectResponse = {
				object: 'block',
				id: 'file-4',
				type: 'file',
				created_time: '2024-01-01T00:00:00.000Z',
				last_edited_time: '2024-01-01T00:00:00.000Z',
				has_children: false,
				archived: false,
				in_trash: false,
				file: {
					type: 'external',
					external: {
						url: ''
					},
					caption: []
				},
				parent: { type: 'page_id', page_id: 'page-1' },
				created_by: { object: 'user', id: 'user-1' },
				last_edited_by: { object: 'user', id: 'user-1' }
			} as any;

			const context = { vault: mockVault, client: mockClient, attachmentFolder: '/attachments', indentLevel: 0, listCounters: new Map() };
			const result = await (converter as any).convertFile(fileBlock, context);

			expect(result).toBe('');
		});
	});

	describe('Toggle Block Conversion', () => {
		it('should convert toggle block without children', async () => {
			const toggleBlock: BlockObjectResponse = {
				object: 'block',
				id: 'toggle-1',
				type: 'toggle',
				created_time: '2024-01-01T00:00:00.000Z',
				last_edited_time: '2024-01-01T00:00:00.000Z',
				has_children: false,
				archived: false,
				in_trash: false,
				toggle: {
					rich_text: [
						{ type: 'text', text: { content: 'Click to expand' }, plain_text: 'Click to expand', annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' } }
					],
					color: 'default'
				},
				parent: { type: 'page_id', page_id: 'page-1' },
				created_by: { object: 'user', id: 'user-1' },
				last_edited_by: { object: 'user', id: 'user-1' }
			} as any;

			const context = { vault: mockVault, client: mockClient, attachmentFolder: '/attachments', indentLevel: 0, listCounters: new Map() };
			const result = await (converter as any).convertToggle(toggleBlock, context, '');

			expect(result).toBe('- Click to expand');
		});

		it('should convert toggle block with nested content', async () => {
			const toggleBlock: BlockObjectResponse = {
				object: 'block',
				id: 'toggle-2',
				type: 'toggle',
				created_time: '2024-01-01T00:00:00.000Z',
				last_edited_time: '2024-01-01T00:00:00.000Z',
				has_children: true,
				archived: false,
				in_trash: false,
				toggle: {
					rich_text: [
						{ type: 'text', text: { content: 'Details' }, plain_text: 'Details', annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' } }
					],
					color: 'default'
				},
				parent: { type: 'page_id', page_id: 'page-1' },
				created_by: { object: 'user', id: 'user-1' },
				last_edited_by: { object: 'user', id: 'user-1' }
			} as any;

			const childBlock: BlockObjectResponse = {
				object: 'block',
				id: 'para-1',
				type: 'paragraph',
				created_time: '2024-01-01T00:00:00.000Z',
				last_edited_time: '2024-01-01T00:00:00.000Z',
				has_children: false,
				archived: false,
				in_trash: false,
				paragraph: {
					rich_text: [
						{ type: 'text', text: { content: 'Hidden content' }, plain_text: 'Hidden content', annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' } }
					],
					color: 'default'
				},
				parent: { type: 'block_id', block_id: 'toggle-2' },
				created_by: { object: 'user', id: 'user-1' },
				last_edited_by: { object: 'user', id: 'user-1' }
			} as any;

			mockClient.getAllBlockChildren.mockResolvedValue([childBlock]);

			const context = { vault: mockVault, client: mockClient, attachmentFolder: '/attachments', indentLevel: 0, listCounters: new Map() };
			const result = await (converter as any).convertToggle(toggleBlock, context, '');

			expect(result).toBe('- Details\n  Hidden content');
		});
	});

	describe('Child References', () => {
		it('should convert child page reference', () => {
			const childPageBlock: BlockObjectResponse = {
				object: 'block',
				id: 'child-page-1',
				type: 'child_page',
				created_time: '2024-01-01T00:00:00.000Z',
				last_edited_time: '2024-01-01T00:00:00.000Z',
				has_children: false,
				archived: false,
				in_trash: false,
				child_page: {
					title: 'Sub Page'
				},
				parent: { type: 'page_id', page_id: 'page-1' },
				created_by: { object: 'user', id: 'user-1' },
				last_edited_by: { object: 'user', id: 'user-1' }
			} as any;

			const result = (converter as any).convertChildPage(childPageBlock);
			expect(result).toBe('[[Sub Page]]');
		});

		it('should convert child database reference', () => {
			const childDbBlock: BlockObjectResponse = {
				object: 'block',
				id: 'child-db-1',
				type: 'child_database',
				created_time: '2024-01-01T00:00:00.000Z',
				last_edited_time: '2024-01-01T00:00:00.000Z',
				has_children: false,
				archived: false,
				in_trash: false,
				child_database: {
					title: 'Projects'
				},
				parent: { type: 'page_id', page_id: 'page-1' },
				created_by: { object: 'user', id: 'user-1' },
				last_edited_by: { object: 'user', id: 'user-1' }
			} as any;

			const result = (converter as any).convertChildDatabase(childDbBlock);
			expect(result).toBe('[[Projects]]');
		});
	});

	describe('Link and Bookmark Conversion', () => {
		it('should convert bookmark with URL and caption', () => {
			const bookmarkBlock: BlockObjectResponse = {
				object: 'block',
				id: 'bookmark-1',
				type: 'bookmark',
				created_time: '2024-01-01T00:00:00.000Z',
				last_edited_time: '2024-01-01T00:00:00.000Z',
				has_children: false,
				archived: false,
				in_trash: false,
				bookmark: {
					url: 'https://example.com',
					caption: [
						{ type: 'text', text: { content: 'Example Site' }, plain_text: 'Example Site', annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' } }
					]
				},
				parent: { type: 'page_id', page_id: 'page-1' },
				created_by: { object: 'user', id: 'user-1' },
				last_edited_by: { object: 'user', id: 'user-1' }
			} as any;

			const result = (converter as any).convertBookmark(bookmarkBlock);
			expect(result).toBe('[Example Site](https://example.com)');
		});

		it('should convert bookmark without caption', () => {
			const bookmarkBlock: BlockObjectResponse = {
				object: 'block',
				id: 'bookmark-2',
				type: 'bookmark',
				created_time: '2024-01-01T00:00:00.000Z',
				last_edited_time: '2024-01-01T00:00:00.000Z',
				has_children: false,
				archived: false,
				in_trash: false,
				bookmark: {
					url: 'https://github.com',
					caption: []
				},
				parent: { type: 'page_id', page_id: 'page-1' },
				created_by: { object: 'user', id: 'user-1' },
				last_edited_by: { object: 'user', id: 'user-1' }
			} as any;

			const result = (converter as any).convertBookmark(bookmarkBlock);
			expect(result).toBe('[https://github.com](https://github.com)');
		});

		it('should convert link preview', () => {
			const linkPreviewBlock: BlockObjectResponse = {
				object: 'block',
				id: 'link-1',
				type: 'link_preview',
				created_time: '2024-01-01T00:00:00.000Z',
				last_edited_time: '2024-01-01T00:00:00.000Z',
				has_children: false,
				archived: false,
				in_trash: false,
				link_preview: {
					url: 'https://obsidian.md'
				},
				parent: { type: 'page_id', page_id: 'page-1' },
				created_by: { object: 'user', id: 'user-1' },
				last_edited_by: { object: 'user', id: 'user-1' }
			} as any;

			const result = (converter as any).convertLinkPreview(linkPreviewBlock);
			expect(result).toBe('[Link](https://obsidian.md)');
		});
	});

	describe('Equation Conversion', () => {
		it('should convert block equation', () => {
			const equationBlock: BlockObjectResponse = {
				object: 'block',
				id: 'eq-1',
				type: 'equation',
				created_time: '2024-01-01T00:00:00.000Z',
				last_edited_time: '2024-01-01T00:00:00.000Z',
				has_children: false,
				archived: false,
				in_trash: false,
				equation: {
					expression: 'E = mc^2'
				},
				parent: { type: 'page_id', page_id: 'page-1' },
				created_by: { object: 'user', id: 'user-1' },
				last_edited_by: { object: 'user', id: 'user-1' }
			} as any;

			const result = (converter as any).convertEquation(equationBlock);
			expect(result).toBe('$$\nE = mc^2\n$$');
		});

		it('should handle complex equation', () => {
			const equationBlock: BlockObjectResponse = {
				object: 'block',
				id: 'eq-2',
				type: 'equation',
				created_time: '2024-01-01T00:00:00.000Z',
				last_edited_time: '2024-01-01T00:00:00.000Z',
				has_children: false,
				archived: false,
				in_trash: false,
				equation: {
					expression: '\\int_{0}^{\\infty} e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}'
				},
				parent: { type: 'page_id', page_id: 'page-1' },
				created_by: { object: 'user', id: 'user-1' },
				last_edited_by: { object: 'user', id: 'user-1' }
			} as any;

			const result = (converter as any).convertEquation(equationBlock);
			expect(result).toBe('$$\n\\int_{0}^{\\infty} e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}\n$$');
		});
	});
});
