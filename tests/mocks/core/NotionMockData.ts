// Mock Notion API data for testing

export const mockNotionDatabase = {
  id: 'test-database-id',
  title: [{ plain_text: 'Test Database' }],
  properties: {
    Name: { type: 'title', title: {} },
    Status: { type: 'select', select: { options: [] } },
    Date: { type: 'date', date: {} },
  },
  created_time: '2023-01-01T00:00:00.000Z',
  last_edited_time: '2023-01-01T00:00:00.000Z',
};

export const mockNotionPage = {
  id: 'test-page-id',
  parent: { database_id: 'test-database-id' },
  properties: {
    Name: { title: [{ plain_text: 'Test Page' }] },
    Status: { select: { name: 'Active' } },
  },
  created_time: '2023-01-01T00:00:00.000Z',
  last_edited_time: '2023-01-01T00:00:00.000Z',
};

export const mockNotionBlocks = [
  {
    id: 'block-1',
    type: 'paragraph',
    paragraph: {
      rich_text: [{ plain_text: 'Test paragraph' }],
    },
  },
  {
    id: 'block-2',
    type: 'heading_1',
    heading_1: {
      rich_text: [{ plain_text: 'Test Heading' }],
    },
  },
];

export const mockNotionPropertyTypes = {
  title: { title: [{ plain_text: 'Title Text' }] },
  rich_text: { rich_text: [{ plain_text: 'Rich text content' }] },
  number: { number: 42 },
  select: { select: { name: 'Option A' } },
  multi_select: { multi_select: [{ name: 'Tag1' }, { name: 'Tag2' }] },
  date: { date: { start: '2023-01-01' } },
  checkbox: { checkbox: true },
  url: { url: 'https://example.com' },
  email: { email: 'test@example.com' },
  phone_number: { phone_number: '+1234567890' },
  formula: { formula: { string: 'Calculated value' } },
  relation: { relation: [{ id: 'related-page-id' }] },
  rollup: { rollup: { array: [] } },
  people: { people: [{ name: 'John Doe' }] },
  files: { files: [{ name: 'document.pdf' }] },
  created_time: { created_time: '2023-01-01T00:00:00.000Z' },
  created_by: { created_by: { name: 'Creator' } },
  last_edited_time: { last_edited_time: '2023-01-01T00:00:00.000Z' },
  last_edited_by: { last_edited_by: { name: 'Editor' } },
  status: { status: { name: 'In Progress' } },
  unique_id: { unique_id: { number: 1, prefix: 'ID-' } },
};

export const mockNotionBlockTypes = {
  paragraph: {
    type: 'paragraph',
    paragraph: { rich_text: [{ plain_text: 'Paragraph text' }] },
  },
  heading_1: {
    type: 'heading_1',
    heading_1: { rich_text: [{ plain_text: 'Heading 1' }] },
  },
  heading_2: {
    type: 'heading_2',
    heading_2: { rich_text: [{ plain_text: 'Heading 2' }] },
  },
  heading_3: {
    type: 'heading_3',
    heading_3: { rich_text: [{ plain_text: 'Heading 3' }] },
  },
  bulleted_list_item: {
    type: 'bulleted_list_item',
    bulleted_list_item: { rich_text: [{ plain_text: 'Bullet point' }] },
  },
  numbered_list_item: {
    type: 'numbered_list_item',
    numbered_list_item: { rich_text: [{ plain_text: 'Numbered item' }] },
  },
  to_do: {
    type: 'to_do',
    to_do: { rich_text: [{ plain_text: 'Todo item' }], checked: false },
  },
  toggle: {
    type: 'toggle',
    toggle: { rich_text: [{ plain_text: 'Toggle block' }] },
  },
  code: {
    type: 'code',
    code: { rich_text: [{ plain_text: 'console.log("hello");' }], language: 'javascript' },
  },
  quote: {
    type: 'quote',
    quote: { rich_text: [{ plain_text: 'Quoted text' }] },
  },
  callout: {
    type: 'callout',
    callout: { rich_text: [{ plain_text: 'Callout content' }], icon: { emoji: '💡' } },
  },
  divider: {
    type: 'divider',
    divider: {},
  },
  image: {
    type: 'image',
    image: { external: { url: 'https://example.com/image.jpg' } },
  },
  embed: {
    type: 'embed',
    embed: { url: 'https://example.com/embed' },
  },
  table: {
    type: 'table',
    table: { table_width: 2, has_column_header: true, has_row_header: false },
  },
};