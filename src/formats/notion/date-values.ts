import { moment } from 'obsidian';

type NotionDateOrder = 'day-first' | 'month-first';

export interface NotionDateValue {
	text: string;
	datetime?: string;
	/** Minutes east of UTC, when the displayed time names a fixed offset. */
	offset?: number;
}

interface MonthName {
	month: number;
	orders: Set<NotionDateOrder>;
}

// Use Intl rather than Moment's registered locales: the web importer and
// Obsidian do not necessarily load the same ones.
const DATE_LANGUAGES = ['en-US', 'en-GB', 'fr', 'de', 'es', 'pt-BR', 'it', 'nl', 'da', 'sv', 'nb', 'fi', 'pl', 'ru', 'tr'];
const monthNames = new Map<string, MonthName>();

// A zoned date ends in "(PDT)" or "(GMT+2)"; the wall-clock time is what gets imported.
const TIME_ZONE_SUFFIX = /\s*\((?:(?:GMT|UTC)(?:([+-])(\d{1,2})(?::(\d{2}))?)?|[A-Z]{2,5})\)$/;

// An abbreviation such as "PDT" does not identify one offset, so only GMT and UTC forms count.
function timeZoneOffset(text: string): number | undefined {
	const match = TIME_ZONE_SUFFIX.exec(text.trim());
	if (!match || !/\((?:GMT|UTC)/.test(match[0])) return undefined;
	const minutes = Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
	return match[1] === '-' ? -minutes : minutes;
}

function normalize(text: string): string {
	return text.replace(/^\s*@\s*/, '').replace(/\s+/g, ' ').trim().replace(TIME_ZONE_SUFFIX, '');
}

function monthKey(text: string): string {
	return text.toLowerCase().replace(/\./g, '').trim();
}

function localeOrder(locale: string): NotionDateOrder | undefined {
	try {
		if (!Intl.DateTimeFormat.supportedLocalesOf(locale).length) return undefined;
		const parts = new Intl.DateTimeFormat(locale, { month: 'numeric', day: 'numeric' }).formatToParts(new Date(2026, 8, 23));
		return parts.find(part => part.type === 'day' || part.type === 'month')?.type === 'day' ? 'day-first' : 'month-first';
	}
	catch {
		return undefined;
	}
}

for (const locale of DATE_LANGUAGES) {
	const order = localeOrder(locale);
	if (!order) continue;
	for (const month of ['long', 'short'] as const) {
		for (const day of [undefined, 'numeric'] as const) {
			const formatter = new Intl.DateTimeFormat(locale, { month, day });
			for (let index = 0; index < 12; index++) {
				const name = formatter.formatToParts(new Date(2026, index, 15)).find(part => part.type === 'month')?.value;
				if (!name) continue;
				const key = monthKey(name);
				const entry = monthNames.get(key) ?? { month: index + 1, orders: new Set<NotionDateOrder>() };
				entry.orders.add(order);
				monthNames.set(key, entry);
			}
		}
	}
}
// Notion also uses the four-letter English abbreviation.
monthNames.set('sept', { month: 9, orders: new Set(['day-first', 'month-first']) });

function namedDate(text: string): { day: number, month: MonthName, year?: number } | undefined {
	// Spanish and Portuguese write "11 de septiembre de 2026".
	text = text.replace(/ de /g, ' ');
	const dayFirst = /^(\d{1,2})\.? (.+?)(?: (\d{4}))?$/.exec(text);
	const monthFirst = /^(.+?) (\d{1,2})(?: (\d{4}))?$/.exec(text);
	for (const [match, dayIndex, monthIndex] of [[dayFirst, 1, 2], [monthFirst, 2, 1]] as const) {
		if (!match) continue;
		const month = monthNames.get(monthKey(match[monthIndex]));
		if (month) return { day: Number(match[dayIndex]), month, year: match[3] ? Number(match[3]) : undefined };
	}
	return undefined;
}

function splitTime(text: string): { date: string, time: string } {
	const match = /[ T]+(\d{1,2}:\d{2}(?::\d{2})?(?:\s*[ap]m)?)$/i.exec(text);
	return {
		date: (match ? text.slice(0, match.index) : text).replace(/,/g, '').trim(),
		time: match ? ' ' + match[1].replace(/\s*([ap]m)$/i, ' $1').toUpperCase() : '',
	};
}

export function notionDateValue(time: Element): NotionDateValue {
	const text = time.textContent ?? '';
	return { text: normalize(text), datetime: time.getAttribute('datetime') ?? undefined, offset: timeZoneOffset(text) };
}

/** A range may share one `<time>`, and a same-day end may carry only its time. */
export function notionDateValues(time: Element): NotionDateValue[] {
	const value = notionDateValue(time);
	const parts = value.text.split(/\s*→\s*/).map(normalize);
	if (parts.length !== 2) return [value];
	const [start, end] = parts;
	// A machine-readable value describes the start; the end exists only as text.
	return [{ text: start, datetime: value.datetime }, { text: /^\d{1,2}:\d{2}/.test(end) ? `${splitTime(start).date} ${end}` : end }];
}

/** A date written without a year belongs to the year its archive was exported, not the year of the import. */
export function exportYear(date: Date | undefined): number | undefined {
	// An archive without timestamps reports the zip epoch, 1980.
	return date && date.getFullYear() > 1980 ? date.getFullYear() : undefined;
}

export class NotionDateParser {
	private inferredOrders = new Set<NotionDateOrder>();

	/** The indexing pass sees the whole export before any dates are written. */
	observe(dom: HTMLElement): void {
		const language = dom.getAttribute('lang');
		const order = language ? localeOrder(language) : undefined;
		if (order) this.inferredOrders.add(order);
		for (const value of Array.from(dom.querySelectorAll('table.properties time')).flatMap(notionDateValues)) {
			const { date } = splitTime(value.text);
			const named = namedDate(date);
			// Shared names such as "September" do not identify a numeric order.
			if (named?.month.orders.size === 1 && this.parse({ text: date })) this.inferredOrders.add([...named.month.orders][0]);
			const numeric = /^(\d{1,2})([/.-])(\d{1,2})\2(\d{4})$/.exec(date);
			if (numeric) {
				const first = Number(numeric[1]), second = Number(numeric[3]);
				if (first > 12 && second <= 12 && moment(`${numeric[4]}-${second}-${first}`, 'YYYY-M-D', 'en', true).isValid()) this.inferredOrders.add('day-first');
				if (second > 12 && first <= 12 && moment(`${numeric[4]}-${first}-${second}`, 'YYYY-M-D', 'en', true).isValid()) this.inferredOrders.add('month-first');
			}
		}
	}

	/** The instant a value names, for file timestamps; properties keep the wall-clock time. */
	timestamp(value: NotionDateValue, year?: number): Date | null {
		const read = this.read(value, year);
		if (!read) return null;
		const { date } = read;
		if (read.zoned) return date.toDate();
		if (value.offset !== undefined) return date.utcOffset(value.offset, true).toDate();
		return new Date(date.year(), date.month(), date.date(), date.hour(), date.minute(), date.second());
	}

	/** The wall-clock time as written, whatever zone it belongs to. */
	parse(value: NotionDateValue, year?: number): moment.Moment | null {
		return this.read(value, year)?.date ?? null;
	}

	// Unzoned values are held in UTC so that a daylight-saving gap in the importing
	// computer's zone cannot move the time that was written.
	private read(value: NotionDateValue, defaultYear = new Date().getFullYear()): { date: moment.Moment, zoned: boolean } | null {
		// Prefer the machine-readable value whenever the export provides one.
		for (const text of [value.datetime, normalize(value.text)]) {
			if (!text) continue;
			if (/^\d{4}-\d{2}-\d{2}(?:$|[T ])/.test(text)) {
				const zoned = /(?:Z|[+-]\d{2}:?\d{2})$/.test(text);
				const iso = zoned
					? moment.parseZone(text, moment.ISO_8601, 'en', true)
					: moment.utc(text, moment.ISO_8601, 'en', true);
				if (iso.isValid()) return { date: iso, zoned };
			}
		}

		const { date, time } = splitTime(normalize(value.text));
		const named = namedDate(date);
		let year: number, month: number, day: number;
		if (named) {
			({ day } = named);
			month = named.month.month;
			year = named.year ?? defaultYear;
		}
		else {
			const yearFirst = /^(\d{4})[/.\-年년] ?(\d{1,2})[/.\-月월] ?(\d{1,2})[日일]?$/.exec(date);
			if (yearFirst) {
				[, year, month, day] = yearFirst.map(Number);
			}
			else {
				const numeric = /^(\d{1,2})([/.-])(\d{1,2})\2(\d{4})$/.exec(date);
				if (!numeric) return null;
				const first = Number(numeric[1]), second = Number(numeric[3]);
				let order = this.inferredOrders.size === 1 ? [...this.inferredOrders][0] : undefined;
				if (!order) {
					if (first > 12 && second <= 12) order = 'day-first';
					else if (second > 12 && first <= 12) order = 'month-first';
					else if (first !== second) return null;
				}
				[day, month] = order === 'day-first' ? [first, second] : [second, first];
				year = Number(numeric[4]);
			}
		}

		const parsed = moment.utc(`${year}-${month}-${day}${time}`, [
			'YYYY-M-D', 'YYYY-M-D H:mm', 'YYYY-M-D HH:mm', 'YYYY-M-D H:mm:ss', 'YYYY-M-D HH:mm:ss',
			'YYYY-M-D h:mm A', 'YYYY-M-D hh:mm A', 'YYYY-M-D h:mm:ss A', 'YYYY-M-D hh:mm:ss A',
		], 'en', true);
		return parsed.isValid() ? { date: parsed, zoned: false } : null;
	}
}
