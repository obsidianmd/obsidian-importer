import '@jxa/global-type';
import { Notes } from '@jxa/types/src/core/Notes';

declare global {
	interface String {
		name(): string;
	}
	type ProgressType = {
		totalUnitCount: number;
		completedUnitCount: number;
		description: string;
		additionalDescription: string;
	};
	interface NotesItem extends Notes.Note, String {}
}

let Progress: ProgressType = {
	totalUnitCount: 0,
	completedUnitCount: 0,
	description: '',
	additionalDescription: '',
};

export const exportNotes = async () => {
	const notesApp = Application('Notes');
	notesApp.includeStandardAdditions = true;

	const currentApp = Application.currentApplication();
	currentApp.includeStandardAdditions = true;

	const notesAccount = currentApp.chooseFromList(['iCloud', 'On My Mac'], {
		withPrompt: 'Choose Notes Account',
		defaultItems: ['iCloud'],
	}) as unknown as Notes.Account[];

	if (notesAccount.length <= 0) displayError('Notes Account not chosen');
	const allNotesInAccount = notesApp.accounts.byName(notesAccount)
		.notes as unknown as NotesItem;
	if (allNotesInAccount.length <= 0) displayError('Notes Account not found');

	const selectedNotes = currentApp.chooseFromList(allNotesInAccount.name(), {
		withPrompt: 'Select Notes',
		multipleSelectionsAllowed: true,
	}) as unknown as Notes.Note[];

	if (selectedNotes.length === 0) displayError('No note selected');

	const outputFormat = 'Hypertext (.html) file';
	const outputFileSuffix = '.html';

	const savePath = currentApp
		.chooseFolder({
			withPrompt: 'Choose output location',
		})
		.toString();
	if (savePath.length <= 0) displayError('No output location specified');

	Progress.totalUnitCount = selectedNotes.length;
	Progress.completedUnitCount = 0;
	Progress.description = 'Exporting Notes...';
	Progress.additionalDescription = `Exporting notes into ${outputFormat}s.`;

	for (let i = 0; i < allNotesInAccount.length; i++) {
		if (
			selectedNotes.includes(
				allNotesInAccount[i].name() as unknown as Notes.Note
			)
		) {
			Progress.additionalDescription = `Exporting Note ${
				Progress.completedUnitCount + 1
			} of ${Progress.totalUnitCount}`;

			const noteFilePath = `${savePath}/${allNotesInAccount[
				i
			].name()}${outputFileSuffix}`;

			writeTextToFile(
				noteFilePath,
				(allNotesInAccount[i] as unknown as Notes.Note).body(),
				false
			);

			Progress.completedUnitCount++;
		}
	}

	currentApp.displayNotification('All selected notes have been exported.', {
		withTitle: 'MacOS Notes Exporter',
		subtitle: 'Export is complete.',
		soundName: 'Glass',
	});

	function displayError(errorMessage: string) {
		currentApp.displayDialog(errorMessage);
	}

	function writeTextToFile(
		file: string,
		text: string,
		overwriteExistingContent = true
	) {
		try {
			const fileString = file.toString();

			const openedFile = currentApp.openForAccess(Path(fileString), {
				writePermission: true,
			});

			if (overwriteExistingContent) {
				currentApp.setEof(openedFile, { to: 0 });
			}

			currentApp.write(text, {
				to: openedFile,
				startingAt: currentApp.getEof(openedFile),
			});

			currentApp.closeAccess(openedFile);

			return true;
		} catch (error) {
			try {
				currentApp.closeAccess(file);
			} catch (error) {
				console.log(`Couldn't close file: ${error}`);
			}

			return false;
		}
	}
};
