/**
 * The note an import leaves behind when something did not come through.
 *
 * The progress log says what happened while it is on screen and then it is
 * gone. An import of ten thousand pages ends on five numbers and no way to act
 * on them: which pages failed, why, and whether the ones that were skipped
 * were the ones already in the vault. This writes that down.
 *
 * Building the text takes no vault, so what the report says can be checked
 * without one; FormatImporter.writeImportReport puts it in the output folder.
 */
import { ImportLogEntry } from './import-context';
import { i18n } from './i18n';
import { describeReason } from './util';

export interface ImportReport {
	/** The importer's display name, for the heading. */
	importer: string;
	when: Date;
	notes: number;
	attachments: number;
	cancelled: boolean;
	log: ImportLogEntry[];
}

/**
 * As many entries as a section will list. A re-run of a large import can skip
 * every page it already has, and a note of a hundred thousand bullets is one
 * nobody can open. What is left out is said rather than quietly dropped.
 */
const MAX_ENTRIES = 5000;

function twoDigits(value: number): string {
	return String(value).padStart(2, '0');
}

/** The local time, written the way Obsidian writes a datetime property. */
function timestamp(when: Date): string {
	return `${when.getFullYear()}-${twoDigits(when.getMonth() + 1)}-${twoDigits(when.getDate())}`
		+ ` ${twoDigits(when.getHours())}:${twoDigits(when.getMinutes())}`;
}

/** One line each, the same wording the progress log used while it was on screen. */
function section(heading: string, entries: ImportLogEntry[]): string[] {
	if (entries.length === 0) return [];

	const lines = [`## ${heading}`, ''];

	for (const { name, reason } of entries.slice(0, MAX_ENTRIES)) {
		// No Markdown around the name: these come from note titles and URLs,
		// which carry brackets and asterisks of their own.
		const line = reason === undefined || reason === null || reason === ''
			? i18n.progress.labelEntry({ name })
			: i18n.progress.labelEntryWithReason({ name, reason: describeReason(reason) });

		lines.push(`- ${line.replace(/\s+/g, ' ')}`);
	}

	if (entries.length > MAX_ENTRIES) {
		lines.push('', `_${i18n.report.msgMoreNotListed({ count: entries.length - MAX_ENTRIES })}_`);
	}

	lines.push('');
	return lines;
}

export function formatImportReport(report: ImportReport): string {
	const { importer, when, notes, attachments, cancelled, log } = report;

	const failed = log.filter(entry => entry.outcome === 'failed');
	const skipped = log.filter(entry => entry.outcome === 'skipped');

	// Only what the import actually counted. Not every importer reports a note
	// success - the Notion API one tracks progress instead - and a report that
	// opens on "0 notes imported" over a folder full of them is worse than one
	// that does not mention notes at all.
	const counts = ([
		[notes, () => i18n.report.countNotes({ count: notes })],
		[attachments, () => i18n.report.countAttachments({ count: attachments })],
		[skipped.length, () => i18n.report.countSkipped({ count: skipped.length })],
		[failed.length, () => i18n.report.countFailed({ count: failed.length })],
	] as [number, () => string][])
		.filter(([count]) => count > 0)
		.map(([, text]) => text())
		.join(', ');

	const when_ = timestamp(when);

	const lines = [
		`# ${i18n.report.title({ importer })}`,
		'',
		cancelled ? i18n.report.msgStopped({ when: when_, counts }) : i18n.report.msgFinished({ when: when_, counts }),
		'',
		// Failures first: they are the ones with something still to do about them
		...section(i18n.report.headingFailed({ count: failed.length }), failed),
		...section(i18n.report.headingSkipped({ count: skipped.length }), skipped),
	];

	return lines.join('\n');
}
