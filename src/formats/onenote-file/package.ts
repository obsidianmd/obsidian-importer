import { CabinetLimits, DEFAULT_CABINET_LIMITS, readCabinet, readCabinetIndex } from './cabinet/cabinet';
import { OneNoteFormatError } from './errors';
import { inspectOnex, isCompoundFile } from './onex';
import { readRevisionStore } from './onestore/revision-store';
import { Section } from './semantic/content';
import { mapSection } from './semantic/map';

export interface SectionEntry {
	name: string;
	title: string;
}

export interface ReadSection extends SectionEntry {
	section: Section;
}

const SECTION_EXTENSION = /\.one$/i;

function titleOf(name: string): string {
	return name.replace(/^.*[\\/]/, '').replace(SECTION_EXTENSION, '');
}

function isSection(name: string): boolean {
	return SECTION_EXTENSION.test(name);
}

export function isPackage(data: Uint8Array): boolean {
	return data.length >= 4 && data[0] === 0x4d && data[1] === 0x53 && data[2] === 0x43 && data[3] === 0x46;
}

/** Lists package sections without expanding them. */
export function listSections(data: Uint8Array, fallbackName: string, limits: CabinetLimits = DEFAULT_CABINET_LIMITS): SectionEntry[] {
	if (!isPackage(data)) return [{ name: fallbackName, title: titleOf(fallbackName) }];

	return readCabinetIndex(data, limits).entries
		.filter(entry => isSection(entry.name))
		.map(entry => ({ name: entry.name, title: titleOf(entry.name) }));
}

/** Reads selected sections, or all sections when `wanted` is omitted. */
export function readSections(
	data: Uint8Array,
	fallbackName: string,
	wanted?: ReadonlySet<string>,
	limits: CabinetLimits = DEFAULT_CABINET_LIMITS,
): { name: string, title: string, read: () => Section }[] {
	if (isCompoundFile(data)) {
		const kind = inspectOnex(data);
		throw new OneNoteFormatError(
			kind === 'rights-protected' ? 'ONENOTE_ONEX_PROTECTED' : 'ONENOTE_ONEX_UNSUPPORTED',
			kind === 'rights-protected'
				? 'The .onex file is rights-protected and its contents are encrypted.'
				: 'The .onex file is a compound document this importer does not recognise.');
	}

	if (!isPackage(data)) {
		return [{ name: fallbackName, title: titleOf(fallbackName), read: () => mapSection(readRevisionStore(data)) }];
	}

	return readCabinet(data, limits, name => isSection(name) && (!wanted || wanted.has(name)))
		.map(entry => ({
			name: entry.name,
			title: titleOf(entry.name),
			read: () => mapSection(readRevisionStore(entry.data)),
		}));
}
