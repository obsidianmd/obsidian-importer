import { InternalLink } from './models';

export interface NoteIdNameEntry {
	title: string;
	notebookName: string;
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
			notebookName: this.currentNotebookName,
		};
	}

	addItemToTOCMap(linkItem: InternalLink): void {
		this.noteIdNameTOCMap[linkItem.url] = {
			...this.noteIdNameMap[linkItem.url],
			title: linkItem.title,
			notebookName: this.currentNotebookName,
		};
	}

	getAllNoteIdNameMap(): NoteIdNames {
		return {
			...this.noteIdNameMap,
			...this.noteIdNameTOCMap,
		};
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
