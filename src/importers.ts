import { App, IconName } from 'obsidian';
import { FormatImporter, ImporterHost } from './format-importer';
import { AirtableAPIImporter } from './formats/airtable-api';
import { AppleNotesImporter } from './formats/apple-notes';
import { AppleJournalImporter } from './formats/apple-journal';
import { Bear2bkImporter } from './formats/bear-bear2bk';
import { CSVImporter } from './formats/csv';
import { EvernoteEnexImporter } from './formats/evernote-enex';
import { FilesImporter } from './formats/files';
import { HtmlImporter } from './formats/html';
import { KeepImporter } from './formats/keep-json';
import { LogseqImporter } from './formats/logseq';
import { MarkdownImporter } from './formats/markdown';
import { NotionImporter } from './formats/notion';
import { NotionAPIImporter } from './formats/notion-api';
import { OneNoteImporter } from './formats/onenote';
import { OneNoteFileImporter } from './formats/onenote-file';
import { RoamJSONImporter } from './formats/roam-json';
import { TextbundleImporter } from './formats/textbundle';
import { TomboyImporter } from './formats/tomboy';
import { i18n } from './i18n';

export type ImporterClass = (new (app: App, host: ImporterHost) => FormatImporter) & { extensions: readonly string[] };

export interface ImporterDefinition {
	helpPermalink?: string;
	importer: ImporterClass;
	hidden?: boolean;
}

export const IMPORTERS: Record<string, ImporterDefinition> = {
	'airtable-api': {
		importer: AirtableAPIImporter,
		helpPermalink: 'import/airtable',
	},
	'apple-notes': {
		importer: AppleNotesImporter,
		helpPermalink: 'import/apple-notes'
	},
	'apple-journal': {
		importer: AppleJournalImporter,
	},
	'bear': {
		importer: Bear2bkImporter,
		helpPermalink: 'import/bear',
	},
	'csv': {
		importer: CSVImporter,
		helpPermalink: 'import/csv',
	},
	'evernote': {
		importer: EvernoteEnexImporter,
		helpPermalink: 'import/evernote',
	},
	'files': {
		importer: FilesImporter,
		hidden: true,
	},
	'keep': {
		importer: KeepImporter,
		helpPermalink: 'import/google-keep',
	},
	'html': {
		importer: HtmlImporter,
		helpPermalink: 'import/html',
	},
	'markdown': {
		importer: MarkdownImporter,
		helpPermalink: 'import/markdown',
	},
	'logseq': {
		importer: LogseqImporter,
		helpPermalink: 'import/logseq',
	},
	'onenote': {
		importer: OneNoteImporter,
		helpPermalink: 'import/onenote',
	},
	'onenote-file': {
		importer: OneNoteFileImporter,
		helpPermalink: 'import/onenote',
	},
	'notion-api': {
		importer: NotionAPIImporter,
		helpPermalink: 'import/notion',
	},
	'notion': {
		importer: NotionImporter,
		helpPermalink: 'import/notion',
	},
	'roam-json': {
		importer: RoamJSONImporter,
		helpPermalink: 'import/roam',
	},
	'textbundle': {
		importer: TextbundleImporter,
		helpPermalink: 'import/textbundle',
	},
	'tomboy': {
		importer: TomboyImporter,
	},
};

export const IMPORTER_GROUPS: Record<string, string[]> = {
	'onenote': ['onenote-file', 'onenote'],
	'notion': ['notion-api', 'notion'],
};

export const FALLBACK_ICONS: Record<string, IconName> = {
	'csv': 'table',
	'files': 'copy',
	'html': 'code-2',
	'logseq': 'network',
	'markdown': 'file-text',
	'textbundle': 'package',
	'tomboy': 'sticky-note',
};

export function groupHelpPermalink(importers: Record<string, ImporterDefinition>, group: string): string | undefined {
	for (const member of IMPORTER_GROUPS[group]) {
		const permalink = importers[member]?.helpPermalink;
		if (permalink) return permalink;
	}

	return undefined;
}

export function groupOf(id: string): string | undefined {
	for (const [group, members] of Object.entries(IMPORTER_GROUPS)) {
		if (members.includes(id)) return group;
	}

	return undefined;
}

export function groupName(group: string): string {
	return i18n.group(`${group}.name`);
}

export function importerName(id: string): string {
	return i18n.importer(`${id}.name`);
}

export function importerOptionText(id: string): string {
	return i18n.importer(`${id}.option-text`);
}
