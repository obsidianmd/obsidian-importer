import { ImporterPlugin } from './ImporterPlugin';
import { NotionImporter } from './formats/NotionImporter';

// Yeni Notion importer-i əlavə et
ImporterPlugin.importers.push(new NotionImporter());

