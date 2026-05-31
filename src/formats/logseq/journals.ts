// Journal date handling (pure parts).
//
// Logseq journal files are named with `:journal/file-name-format` (default
// `yyyy_MM_dd`) and reference dates in content using `:journal/page-title-format`
// (default `MMM do, yyyy`, e.g. "Aug 30th, 2024"). These helpers normalize both
// to ISO `YYYY-MM-DD`. The orchestrator reformats ISO into the target Obsidian
// daily-note format at runtime (using moment), which is not needed here.

const MONTHS: Record<string, number> = {
	jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
	jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function pad(n: number): string {
	return n.toString().padStart(2, '0');
}

function validYMD(y: number, m: number, d: number): boolean {
	if (m < 1 || m > 12 || d < 1 || d > 31) return false;
	return true;
}

export function journalFilenameToISO(basename: string): string | null {
	const m = basename.match(/^(\d{4})[_-](\d{1,2})[_-](\d{1,2})$/);
	if (!m) return null;
	const y = parseInt(m[1], 10);
	const mo = parseInt(m[2], 10);
	const d = parseInt(m[3], 10);
	if (!validYMD(y, mo, d)) return null;
	return `${y}-${pad(mo)}-${pad(d)}`;
}

export function isJournalFilename(basename: string): boolean {
	return journalFilenameToISO(basename) !== null;
}

const DATE_LINK = /\[\[((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*)\.? (\d{1,2})(?:st|nd|rd|th)?,? (\d{4})\]\]/g;

export function convertJournalDateLinks(content: string): string {
	return content.replace(DATE_LINK, (whole, monthName: string, day: string, year: string) => {
		const mo = MONTHS[monthName.slice(0, 3).toLowerCase()];
		const d = parseInt(day, 10);
		if (!mo || !validYMD(parseInt(year, 10), mo, d)) return whole;
		return `[[${year}-${pad(mo)}-${pad(d)}]]`;
	});
}
