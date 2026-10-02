import '../shims/dom';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseYaml } from 'obsidian';

import { NotionImporter } from '../../src/formats/notion';
import { convertHtmlToMarkdown } from '../../src/formats/notion/convert-to-md';
import { NotionResolverInfo } from '../../src/formats/notion/notion-types';
import { recordFileInfo } from '../../src/formats/notion/parse-info';
import { exportYear } from '../../src/formats/notion/date-values';
import { ImportContext } from '../../src/import-context';
import { indexedApp, MemoryVault } from '../shims/vault';
import { zipOf } from '../shims/zip';

const id = '0123456789abcdef0123456789abcdef';

function row(type: string, title: string, value: string): string {
	return `<tr class="property-row property-row-${type} extra-class"><th>${title}</th><td>${value}</td></tr>`;
}

function page(rows: string, title = 'Page', pageId = id, lang = ''): string {
	return `<html${lang ? ` lang="${lang}"` : ''}><head><title>${title}</title></head><body><article id="${pageId}"><table class="properties"><tbody>${rows}</tbody></table><div class="page-body"><p>Keep the page body.</p></div></article></body></html>`;
}

function properties(html: string): { data: Record<string, unknown>, warnings: string[], markdown: string } {
	const warnings: string[] = [];
	const markdown = convertHtmlToMarkdown(new NotionResolverInfo('', false), html, message => warnings.push(message));
	const data = parseYaml(markdown.split('---')[1]) as Record<string, unknown>;
	return { data, warnings, markdown };
}

test('Place properties keep the address and the rest of the page (#673)', () => {
	const { data, warnings, markdown } = properties(page(row('place', 'Place', '123 Rue de Paris, Lyon') + row('checkbox', 'Done', '<div class="checkbox-on"></div>')));
	assert.deepEqual(data, { Place: '123 Rue de Paris, Lyon', Done: true });
	assert.match(markdown, /Keep the page body\./);
	assert.deepEqual(warnings, []);
});

test('unknown property types preserve text with a warning rather than dropping the page', () => {
	const { data, warnings, markdown } = properties(page(row('new_type', 'Future property', '<span>A value</span>')));
	assert.equal(data['Future property'], 'A value');
	assert.match(markdown, /Keep the page body\./);
	assert.equal(warnings.length, 1);
	assert.match(warnings[0], /Future property.*new_type.*text/);
});

test('the French examples import without invalid dates or DD/MM swaps (#672)', () => {
	const examples = ['11 janvier 2026', '19 septembre 2026 10:34', '12/10/2026', '18/09/2026', 'sept. 23'];
	const { data, warnings } = properties(page(examples.map((text, index) => row('date', `Date ${index}`, `<time>@${text}</time>`)).join('')));
	assert.deepEqual(Object.values(data), ['2026-01-11', '2026-09-19T10:34', '2026-10-12', '2026-09-18', `${new Date().getFullYear()}-09-23`]);
	assert.deepEqual(warnings, []);
});

test('date ranges and created/edited properties use the localized parser', () => {
	const { data, warnings } = properties(page(
		row('date', 'Range', '<time>@11 janvier 2026</time> → <time>@19 septembre 2026 10:34</time>')
		+ row('created_time', 'Created', '<time>@11 janvier 2026 09:05</time>')
		+ row('last_edited_time', 'Edited', '<time>@18/09/2026 10:34</time>'),
	));
	assert.deepEqual(data, { Range: '2026-01-11 - 2026-09-19T10:34', Created: '2026-01-11T09:05', Edited: '2026-09-18T10:34' });
	assert.deepEqual(warnings, []);
});

test('unreadable dates and a partially unreadable range keep their original values', () => {
	const { data, warnings } = properties(page(
		row('date', 'Invalid', '<time>@31 février 2026</time>')
		+ row('date', 'Unknown', '<time>@not a date</time>')
		+ row('date', 'Range', '<time>@11 janvier 2026</time> → <time>@not a date</time>')
		+ row('date', 'Empty', ''),
	));
	assert.deepEqual(data, { Invalid: '31 février 2026', Unknown: 'not a date', Range: '11 janvier 2026 → not a date' });
	assert.equal(warnings.length, 3);
	assert.ok(warnings.every(warning => warning.includes('Kept its value as text')));
});

test('ambiguous numeric dates are preserved unless the export shows their order', () => {
	const html = page(row('date', 'Date', '<time>@12/10/2026</time>'));
	assert.equal(properties(html).data.Date, '12/10/2026');
	assert.equal(properties(html).warnings.length, 1);
	assert.equal(properties(page(row('date', 'Date', '<time>@12/10/2026</time>'), 'Page', id, 'fr')).data.Date, '2026-10-12');
	assert.equal(properties(page(row('date', 'Date', '<time>@12/10/2026</time>'), 'Page', id, 'en-US')).data.Date, '2026-12-10');
});

test('machine-readable dates take precedence over ambiguous display text', () => {
	const { data, warnings } = properties(page(row('date', 'Date', '<time datetime="2026-10-12T10:34:00+02:00">@12/10/2026</time>')));
	assert.equal(data.Date, '2026-10-12T10:34');
	assert.deepEqual(warnings, []);
});

test('invalid or conflicting date evidence does not resolve ambiguous numeric dates', () => {
	const invalid = properties(page(
		row('date', 'Invalid', '<time>@31/02/2026</time>') + row('date', 'Ambiguous', '<time>@12/10/2026</time>'),
	));
	assert.equal(invalid.data.Ambiguous, '12/10/2026');
	const conflicting = properties(page(
		row('date', 'Day first', '<time>@18/09/2026</time>')
		+ row('date', 'Month first', '<time>@09/18/2026</time>')
		+ row('date', 'Ambiguous', '<time>@12/10/2026</time>'),
	));
	assert.deepEqual(conflicting.data, { 'Day first': '2026-09-18', 'Month first': '2026-09-18', Ambiguous: '12/10/2026' });
	assert.equal(conflicting.warnings.length, 1);
});

test('ISO timestamps use local time without an offset and honor an explicit offset', () => {
	const info = new NotionResolverInfo('', false);
	recordFileInfo(info, { filepath: `Page ${id}.html`, name: `Page ${id}.html`, extension: 'html', text: page(
		row('created_time', 'Created', '<time datetime="2026-10-12T09:05:00">@12/10/2026</time>')
		+ row('last_edited_time', 'Edited', '<time datetime="2026-10-12T10:34:00+02:00">@12/10/2026</time>'),
	) });
	assert.equal(info.idsToFileInfo[id].ctime?.getTime(), new Date(2026, 9, 12, 9, 5).getTime());
	assert.equal(info.idsToFileInfo[id].mtime?.toISOString(), '2026-10-12T08:34:00.000Z');
});

test('English dates, AM/PM times, ISO dates and other localized month names still import', () => {
	const examples = ['March 1, 2024', 'September 19, 2026 10:34 AM', '2026-10-12', '11 février 2026', '11 März 2026', '11 septiembre 2026', '11 января 2026', '2026年10月12日'];
	const { data, warnings } = properties(page(examples.map((text, index) => row('date', `Date ${index}`, `<time>@${text}</time>`)).join('')));
	assert.deepEqual(Object.values(data), ['2024-03-01', '2026-09-19T10:34', '2026-10-12', '2026-02-11', '2026-03-11', '2026-09-11', '2026-01-11', '2026-10-12']);
	assert.deepEqual(warnings, []);
});

test('export-wide date evidence also resolves timestamps indexed before that evidence', () => {
	const info = new NotionResolverInfo('', false);
	const first = page(row('created_time', 'Created', '<time>@12/10/2026</time>') + row('last_edited_time', 'Edited', '<time>@12/10/2026 10:34</time>'));
	recordFileInfo(info, { filepath: `Page ${id}.html`, name: `Page ${id}.html`, extension: 'html', text: first });
	assert.equal(info.idsToFileInfo[id].ctime?.toISOString() ?? null, null);
	const secondId = '1123456789abcdef0123456789abcdef';
	recordFileInfo(info, { filepath: `French ${secondId}.html`, name: `French ${secondId}.html`, extension: 'html', text: page(row('date', 'Date', '<time>@11 janvier 2026</time>'), 'French', secondId) });
	assert.equal(info.idsToFileInfo[id].ctime?.getTime(), new Date(2026, 9, 12).getTime());
	assert.equal(info.idsToFileInfo[id].mtime?.getTime(), new Date(2026, 9, 12, 10, 34).getTime());
	assert.match(convertHtmlToMarkdown(info, first), /Created: 2026-10-12/);
});

test('zoned times keep their wall-clock time', () => {
	const { data, warnings } = properties(page(
		row('date', 'Zoned', '<time>@March 1, 2024 10:00 AM (PDT)</time>')
		+ row('date', 'Offset', '<time>@1 mars 2024 10:00 (GMT+2)</time>')
		+ row('created_time', 'Created', '<time>@March 1, 2024 10:00 AM (UTC)</time>'),
	));
	assert.deepEqual(data, { Zoned: '2024-03-01T10:00', Offset: '2024-03-01T10:00', Created: '2024-03-01T10:00' });
	assert.deepEqual(warnings, []);
});

test('Spanish and Portuguese dates are read with their particles', () => {
	const { data, warnings } = properties(page(
		row('date', 'Spanish', '<time>@11 de septiembre de 2026</time>')
		+ row('date', 'Portuguese', '<time>@11 de setembro de 2026 10:34</time>'),
	));
	assert.deepEqual(data, { Spanish: '2026-09-11', Portuguese: '2026-09-11T10:34' });
	assert.deepEqual(warnings, []);
});

test('a range inside one time element is split, including a same-day end time', () => {
	const { data, warnings } = properties(page(
		row('date', 'Days', '<time>@March 1, 2024 → March 5, 2024</time>')
		+ row('date', 'Hours', '<time>@March 1, 2024 10:00 AM → 11:00 AM</time>')
		+ row('date', 'Zoned', '<time>@March 1, 2024 10:00 AM (PDT) → March 2, 2024 11:00 AM (PDT)</time>')
		+ row('date', 'Broken', '<time>@March 1, 2024 → later</time>'),
	));
	assert.deepEqual(data, {
		Days: '2024-03-01 - 2024-03-05',
		Hours: '2024-03-01T10:00 - 2024-03-01T11:00',
		Zoned: '2024-03-01T10:00 - 2024-03-02T11:00',
		Broken: 'March 1, 2024 → later',
	});
	assert.equal(warnings.length, 1);
});

test('a date without a year takes the year of its own archive', () => {
	const info = new NotionResolverInfo('', false);
	const html = page(row('date', 'Date', '<time>@Sept 23</time>') + row('created_time', 'Created', '<time>@Sept 23</time>'));
	const secondId = '5123456789abcdef0123456789abcdef';
	recordFileInfo(info, { filepath: `Page ${id}.html`, name: `Page ${id}.html`, extension: 'html', mtime: new Date(2024, 11, 30), text: html });
	recordFileInfo(info, { filepath: `Later ${secondId}.html`, name: `Later ${secondId}.html`, extension: 'html', mtime: new Date(2025, 5, 1), text: page(row('created_time', 'Created', '<time>@Sept 23</time>'), 'Later', secondId) });
	assert.equal(info.idsToFileInfo[id].ctime?.getFullYear(), 2024);
	assert.equal(info.idsToFileInfo[secondId].ctime?.getFullYear(), 2025);
	assert.match(convertHtmlToMarkdown(info, html, undefined, 2024), /Date: 2024-09-23/);
	assert.match(convertHtmlToMarkdown(info, html, undefined, exportYear(new Date(1980, 0, 1))), new RegExp(`Date: ${new Date().getFullYear()}-09-23`));
});

test('file timestamps honor a displayed UTC offset while properties keep wall-clock time', () => {
	const info = new NotionResolverInfo('', false);
	const html = page(
		row('created_time', 'Created', '<time>@1 mars 2024 10:00 (GMT+2)</time>')
		+ row('last_edited_time', 'Edited', '<time>@March 1, 2024 10:00 AM (UTC-5:30)</time>'),
	);
	recordFileInfo(info, { filepath: `Page ${id}.html`, name: `Page ${id}.html`, extension: 'html', text: html });
	assert.equal(info.idsToFileInfo[id].ctime?.toISOString(), '2024-03-01T08:00:00.000Z');
	assert.equal(info.idsToFileInfo[id].mtime?.toISOString(), '2024-03-01T15:30:00.000Z');
	assert.match(convertHtmlToMarkdown(info, html), /Created: 2024-03-01T10:00\nEdited: 2024-03-01T10:00/);
});

test('an offset time inside a local daylight-saving gap is not shifted', () => {
	// 02:30 on 8 March 2026 does not exist in America/Los_Angeles.
	const info = new NotionResolverInfo('', false);
	const html = page(
		row('created_time', 'Created', '<time>@8 mars 2026 02:30 (GMT+2)</time>')
		+ row('last_edited_time', 'Edited', '<time datetime="2024-03-01T10:00:00">@1 mars 2024 10:00 (GMT+2)</time>'),
	);
	recordFileInfo(info, { filepath: `Page ${id}.html`, name: `Page ${id}.html`, extension: 'html', text: html });
	assert.equal(info.idsToFileInfo[id].ctime?.toISOString(), '2026-03-08T00:30:00.000Z');
	assert.equal(info.idsToFileInfo[id].mtime?.toISOString(), '2024-03-01T08:00:00.000Z');
	assert.match(convertHtmlToMarkdown(info, html), /Created: 2026-03-08T02:30\nEdited: 2024-03-01T10:00/);
});

test('a range with a datetime attribute keeps its displayed end', () => {
	const { data, warnings } = properties(page(row('date', 'Range', '<time datetime="2024-03-01">@March 1, 2024 → March 5, 2024</time>')));
	assert.equal(data.Range, '2024-03-01 - 2024-03-05');
	assert.deepEqual(warnings, []);
});

test('a warning repeated down a database column is reported once', async () => {
	const vault = new MemoryVault();
	const subject = new NotionImporter(indexedApp(vault) as never, { sourceEl: null, outputEl: null, optionsEl: null } as never);
	await subject.ready;
	const ids = ['2123456789abcdef0123456789abcdef', '3123456789abcdef0123456789abcdef', '4123456789abcdef0123456789abcdef'];
	const source = await zipOf(Object.fromEntries(ids.map((rowId, index) => [
		`Base/Row ${index} ${rowId}.html`,
		page(row('date', 'Date', '<time>@not a date</time>') + row('new_type', 'Future', 'Preserved'), `Row ${index}`, rowId),
	])));
	subject.chosen = [source];
	subject.files = [source];
	subject.outputLocation = 'Import';
	subject.indexImportedNotes();
	const ctx = new ImportContext();
	await subject.import(ctx);
	assert.equal(ctx.notes, 3);
	assert.equal(ctx.log.filter(entry => entry.outcome === 'message').length, 2);
});

test('import reports property warnings while successfully writing the page', async () => {
	const vault = new MemoryVault();
	const subject = new NotionImporter(indexedApp(vault) as never, { sourceEl: null, outputEl: null, optionsEl: null } as never);
	await subject.ready;
	const source = await zipOf({ [`Page ${id}.html`]: page(
		row('place', 'Place', 'Paris') + row('new_type', 'Future', 'Preserved') + row('date', 'Date', '<time>@not a date</time>'),
	) });
	subject.chosen = [source];
	subject.files = [source];
	subject.outputLocation = 'Import';
	subject.indexImportedNotes();
	const ctx = new ImportContext();
	await subject.import(ctx);
	assert.equal(ctx.notes, 1);
	assert.deepEqual(ctx.failed, []);
	assert.deepEqual(ctx.skipped, []);
	assert.equal(ctx.log.filter(entry => entry.outcome === 'message').length, 2);
	assert.ok(ctx.log.every(entry => entry.name.includes(`Page ${id}.html`)));
	assert.match(String(vault.contents.get('Import/Page.md')), /Place: Paris/);
	assert.match(String(vault.contents.get('Import/Page.md')), /Date: not a date/);
});
