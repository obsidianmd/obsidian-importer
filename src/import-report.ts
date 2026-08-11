import { moment } from 'obsidian';
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

const isoDate = (when: Date) => moment(when).format('YYYY-MM-DD');
const timestamp = (when: Date) => moment(when).format('YYYY-MM-DD HH:mm');

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

function messages(heading: string, entries: ImportLogEntry[]): string[] {
	if (entries.length === 0) return [];

	return [`## ${heading}`, '', ...entries.map(({ name }) => `- ${asText(name)}`), ''];
}

export function formatImportReport(report: ImportReport): string {
	const { importer, when, notes, attachments, cancelled, log } = report;

	const failed = log.filter(entry => entry.outcome === 'failed');
	const skipped = log.filter(entry => entry.outcome === 'skipped');
	const said = log.filter(entry => entry.outcome === 'message');

	// Some importers do not count successful notes, so omit zero counts.
	const counts = [
		notes > 0 && i18n.report.countNotes({ count: notes }),
		attachments > 0 && i18n.report.countAttachments({ count: attachments }),
		skipped.length > 0 && i18n.report.countSkipped({ count: skipped.length }),
		failed.length > 0 && i18n.report.countFailed({ count: failed.length }),
	].filter((count): count is string => count !== false).join(', ');

	const at = timestamp(when);

	const lines = [
		`# ${i18n.report.title({ importer })}`,
		'',
		cancelled ? i18n.report.msgStopped({ when: at, counts }) : i18n.report.msgFinished({ when: at, counts }),
		'',
		...section(i18n.report.headingFailed({ count: failed.length }), failed),
		...section(i18n.report.headingSkipped({ count: skipped.length }), skipped),
		...messages(i18n.report.headingMessages(), said),
	];

	return lines.join('\n');
}
