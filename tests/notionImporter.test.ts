import { NotionImporter } from '../formats/NotionImporter';
import { getPage, getDatabase } from '../src/notion';

const TEST_PAGE_ID = '27ebca3fd1c2801ea6c3cf971cad4eb3';
const TEST_DATABASE_ID = '27ebca3fd1c28010892c000ccd715ec1';

const NOTES_FOLDER = 'test_vault/notes';
const BASES_FOLDER = 'test_vault/bases';

describe('NotionImporter Full Workflow', () => {
  const importer = new NotionImporter();

  const checkMarkdownContent = (markdown: string) => {
    expect(markdown).toContain('#');
    expect(markdown).toMatch(/!?\[\]\(.+\)/);
  };

  const checkBaseContent = (baseYaml: string) => {
    expect(baseYaml).toContain('entries:');
  };

  it('imports a Notion page to Markdown with attachments', async () => {
    const page = await getPage(TEST_PAGE_ID);
    const markdown = await importer['convertPageToMarkdown'](page);
    importer['writeFile'](NOTES_FOLDER, page.properties.title.title[0].plain_text, markdown, 'md');
    checkMarkdownContent(markdown);
  });

  it('imports a Notion database to .base YAML', async () => {
    const records = await getDatabase(TEST_DATABASE_ID);
    const baseYaml = importer['convertDatabaseToBase']('Tasks', records);
    importer['writeFile'](BASES_FOLDER, 'Tasks', baseYaml, 'base');
    checkBaseContent(baseYaml);
  });

  it('handles Kanban view fallback', async () => {
    const records = await getDatabase(TEST_DATABASE_ID);
    const viewConfig = { columns: [{ name: 'To Do' }, { name: 'In Progress' }, { name: 'Done' }] };
    const kanbanYaml = importer['convertDatabaseFallbackBase']('Tasks', records, 'kanban', viewConfig);

    expect(kanbanYaml).toContain('To Do');
    expect(kanbanYaml).toContain('In Progress');
    expect(kanbanYaml).toContain('Done');
    checkBaseContent(kanbanYaml);
  });

  it('handles

