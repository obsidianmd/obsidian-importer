import { InternalLink } from './models';

export interface NoteIdNameEntry {
	title: string;
	noteName: string;
	notebookName: string;
	uniqueEnd: string;
}

export interface NoteIdNames {
	[key: string]: NoteIdNameEntry;
}

export class RuntimeProperties {

	noteIdNameMap: NoteIdNames = {};
	noteIdNameTOCMap: NoteIdNames = {}; // Table of Contents map - the trusted source
	currentNoteName: string;
	currentNotebookName: string;
	currentNotebookFullpath: string;

	addItemToMap(linkItem: InternalLink): void {
		this.noteIdNameMap[linkItem.url] = {
			...this.noteIdNameMap[linkItem.url],
			title: linkItem.title,
			noteName: this.currentNoteName,
			notebookName: this.currentNotebookName,
			uniqueEnd: linkItem.uniqueEnd,
		};
	}

	addItemToTOCMap(linkItem: InternalLink): void {
		this.noteIdNameTOCMap[linkItem.url] = {
			...this.noteIdNameMap[linkItem.url],
			title: linkItem.title,
			noteName: this.currentNoteName,
			notebookName: this.currentNotebookName,
			uniqueEnd: linkItem.uniqueEnd,
		};
	}

	getAllNoteIdNameMap(): NoteIdNames {
		return {
			...this.noteIdNameMap,
			...this.noteIdNameTOCMap,
		};
	}

	getNoteIdNameMapByNoteTitle(noteTitle: string): NoteIdNameEntry[] {
		return Object.values(this.getAllNoteIdNameMap()).filter(noteIdName => noteIdName.title === noteTitle);
	}

	setCurrentNotebookName(currentNotebookName: string): void {
		this.currentNotebookName = currentNotebookName;
	}
	getCurrentNotebookName(): string {
		return this.currentNotebookName;
	}
	setCurrentNotebookFullpath(currentNotebookFullpath: string): void {
		this.currentNotebookFullpath = currentNotebookFullpath;
	}

	setCurrentNoteName(currentNoteName: string): void {
		this.currentNoteName = currentNoteName;
	}

	getCurrentNoteName(): string {
		return this.currentNoteName;
	}

	getCurrentNotebookFullpath(): string {
		return this.currentNotebookFullpath;
	}

}
