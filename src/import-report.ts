import { ImportLogEntry } from './import-context';
import { i18n } from './i18n';
import { describeReason, sanitizeFileName } from './util';

export interface ImportReport {
	importer: string;
	when: Date;
	notes: number;
	attachments: number;
	cancelled: boolean;
	log: ImportLogEntry[];
}

function twoDigits(value: number): string {
	return String(value).padStart(2, '0');
}

function isoDate(when: Date): string {
	return `${when.getFullYear()}-${twoDigits(when.getMonth() + 1)}-${twoDigits(when.getDate())}`;
}

function timestamp(when: Date): string {
	return `${isoDate(when)} ${twoDigits(when.getHours())}:${twoDigits(when.getMinutes())}`;
}

export function importReportName(importer: string, when: Date): string {
	return sanitizeFileName(i18n.report.fileName({ date: isoDate(when), importer }));
}

// Escape source-controlled text before placing it in Markdown.
function asText(value: string): string {
	return value.replace(/\s+/g, ' ').replace(/[\\`*_[\]<>]/g, '\\$&');
}

function section(heading: string, entries: ImportLogEntry[]): string[] {
	if (entries.length === 0) return [];

	const lines = [`## ${heading}`, ''];

	for (const { name, reason } of entries) {
		const line = reason === undefined || reason === null || reason === ''
			? i18n.progress.labelEntry({ name: asText(name) })
			: i18n.progress.labelEntryWithReason({ name: asText(name), reason: asText(describeReason(reason)) });

		lines.push(`- ${line}`);
	}

	lines.push('');
	return lines;
}

export function formatImportReport(report: ImportReport): string {
	const { importer, when, notes, attachments, cancelled, log } = report;

	const failed = log.filter(entry => entry.outcome === 'failed');
	const skipped = log.filter(entry => entry.outcome === 'skipped');

	// Some importers do not count successful notes, so omit zero counts.
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
		...section(i18n.report.headingFailed({ count: failed.length }), failed),
		...section(i18n.report.headingSkipped({ count: skipped.length }), skipped),
	];

	return lines.join('\n');
}
