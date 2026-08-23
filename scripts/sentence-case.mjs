/** Shared sentence-case exceptions for lint and localization. */
export const sentenceCase = {
	brands: [
		'Agenda', 'Airtable', 'Apple', 'Apple Journal', 'Apple Notes', 'Bear', 'Craft',
		'Daily Notes', 'Dataview', 'Evernote', 'Excel', 'Gnote', 'GNote', 'Google', 'Google Keep', 'Google Sheets',
		'Google Takeout', 'Journal app', 'Mac', 'Markdown', 'Microsoft', 'Notion', 'Numbers',
		'Logseq', 'Obsidian', 'OneNote', 'Roam', 'Roam Research', 'Taio', 'Tasks', 'Textbundle', 'Tomboy',
		'Ulysses', 'Windows', 'Zettlr', 'iCloud', 'iCloud Drive',
	],
	acronyms: ['API', 'CLOCK', 'CSV', 'DD', 'HTML', 'ID', 'JSON', 'LOGBOOK', 'MB', 'MM', 'PDF', 'UID', 'URL', 'UUID', 'UUIDs', 'YAML', 'YYYY'],
	ignoreRegex: [
		'^base$', '^cover$', '^tags$', 'airtable-id', 'notion-id',
		'^YYYY-MM-DD$', 'Click "Load"', '"TODO"',
		// Deliberate sentence fragments.
		'^[a-z]',
		'\\(\\.[a-z0-9., /]+\\)$',
		'"group\\.com\\.apple\\.notes"', 'Application Support', 'Quit Notes',
		'does not contain markdown', 'only textpack and zip files',
		'as textbundle or textpack',
		'import textbundle files', '~/\\.local/share/gnote',
	],
	ignoreWords: ['MB', '(MB)', 'TODO'],
};
