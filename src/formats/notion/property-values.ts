export function parseNotionNumberPropertyValue(text: string | null): number | string {
	const rawValue = text ?? '';
	const value = Number(rawValue);

	return Number.isNaN(value) ? rawValue.trim() : value;
}
