export function getAppleNotesTitleFromText(noteText: string | undefined): string | null {
	const firstLine = noteText?.split(/\r\n|\r|\n/, 1)[0]?.trim();
	return firstLine || null;
}
