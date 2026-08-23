/**
 * The names the plugin writes as they are spelled, whoever is reading.
 *
 * Two lint rules read this — the one that checks a `setName()` call and the one
 * that checks the English string table — and so does the translation script,
 * which tells a translator to leave every one of them alone. Keeping it in one
 * place is what stops the third copy drifting from the first two.
 */
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
		// A fragment spliced into a longer sentence starts lower case on purpose.
		'^[a-z]',
		// A format listed with the extensions it comes in: "Bear (.bear2bk)".
		'\\(\\.[a-z0-9., /]+\\)$',
		// Names of things outside Obsidian, quoted as they are spelled there.
		'"group\\.com\\.apple\\.notes"', 'Application Support', 'Quit Notes',
		// A format or a path written in its own lower-case spelling.
		'does not contain markdown', 'only textpack and zip files',
		'as textbundle or textpack',
		'import textbundle files', '~/\\.local/share/gnote',
	],
	ignoreWords: ['MB', '(MB)', 'TODO'],
};
