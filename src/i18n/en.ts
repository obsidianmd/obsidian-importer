/**
 * Every string the importer shows. This is the source of truth: `locale/en.txt`
 * is generated from it, and a translator fills in the other files from there.
 *
 * Conventions, borrowed from Obsidian's own string table:
 *
 * - Keys are camelCase here and kebab-case in a translation file, so
 *   `msgNothingToImport` is written `[source.msg-nothing-to-import]`.
 * - `{{name}}` is filled in at runtime. A translation may move it, but not
 *   rename or drop it.
 * - A key ending `_plural` is used when `count` is anything but 1.
 *
 * Not in here, deliberately: messages only a developer sees (console output and
 * the errors the scripted `runImport` throws), and text that is written into a
 * note rather than shown on screen, which has to read the same whoever imported
 * it.
 */
export const en = {
	command: {
		importNotes: 'Import notes',
	},

	nouns: {
		fileWithCount: '{{count}} file',
		fileWithCount_plural: '{{count}} files',
		noteWithCount: '{{count}} note',
		noteWithCount_plural: '{{count}} notes',
		itemWithCount: '{{count}} item',
		itemWithCount_plural: '{{count}} items',
		recordWithCount: '{{count}} record',
		recordWithCount_plural: '{{count}} records',
		baseWithCount: '{{count}} base',
		baseWithCount_plural: '{{count}} bases',
		templateWithCount: '{{count}} template',
		templateWithCount_plural: '{{count}} templates',
		failureWithCount: '{{count}} failure',
		failureWithCount_plural: '{{count}} failures',
		secondWithCount: '{{count}} second',
		secondWithCount_plural: '{{count}} seconds',
		relationPlaceholderWithCount: '{{count}} relation placeholder',
		relationPlaceholderWithCount_plural: '{{count}} relation placeholders',
		linkedDatabaseWithCount: '{{count}} linked database',
		linkedDatabaseWithCount_plural: '{{count}} linked databases',
	},

	modal: {
		titlePickFormat: 'Import data into Obsidian',
		titleImportFrom: 'Import from {{format}}',
		searchPlaceholder: 'Filter...',
		msgNoFormats: 'No formats found.',
		buttonContinue: 'Continue',
		buttonImport: 'Import',
		buttonBack: 'Back',
		buttonHelp: 'Help',
		buttonCancel: 'Cancel',
		buttonPause: 'Pause',
		buttonResume: 'Resume',
		buttonStop: 'Stop',
		buttonImportMore: 'Import more',
		buttonDone: 'Done',
		msgUnexpectedAuth: 'Unexpected auth event. Please restart the auth process.',
	},

	progress: {
		statImported: 'imported',
		statAttachments: 'attachments',
		statRemaining: 'remaining',
		statSkipped: 'skipped',
		statFailed: 'failed',
		labelSkipped: 'Skipped: ',
		labelFailed: 'Failed: ',
		labelEntry: '"{{name}}"',
		labelEntryWithReason: '"{{name}}" because {{reason}}',
		labelPaused: 'Paused',
		labelPausedWith: 'Paused - {{status}}',
		labelImporting: 'Importing',
		labelRemaining: '{{count}} remaining...',
		labelPausedRemaining: 'Paused - {{count}} remaining',
		msgStopped: 'Import stopped.',
		msgErrors: 'Import finished with errors.',
		msgComplete: 'Import complete.',
		msgImportedCount: '{{count}} note imported',
		msgImportedCount_plural: '{{count}} notes imported',
		msgClickToShow: '{{counts}}. Click to show.',
		statusWaiting: 'Waiting {{duration}} ({{reason}})',
		statusWaitingForMarkdown: 'Waiting for imported Markdown…',
		statusStandardizing: 'Standardizing Markdown ({{current}}/{{total}})',
		labelFinalization: 'Markdown finalization',
	},

	source: {
		name: 'Files to import',
		desc: 'Pick the files that you want to import.',
		buttonChooseFile: 'Choose file',
		buttonChooseFiles: 'Choose files',
		buttonChooseFolders: 'Choose folders',
		dialogPickFiles: 'Pick files to import',
		dialogPickFolders: 'Folders to import',
		msgReadingFolders: 'Reading folders...',
		msgNothingToImport: 'Nothing to import there. Pick {{extensions}} files, or a folder holding some.',
		msgWillImport: '{{files}} will be imported: ',
	},

	output: {
		labelSourceId: 'source ID',
		nameSaveSourceId: 'Save {{label}}',
		descSaveSourceId: 'Add the {{label}} to note properties so future imports can recognize moved or renamed notes.',
		nameFolder: 'Output folder',
		descFolder: 'Where imported notes will be saved. Leave blank to use the top level of the vault.',
		nameAttachments: 'Attachment location',
		descAttachments: 'Where imported images and files will be saved.',
		nameSubfolder: 'Subfolder name',
		descSubfolder: 'Folder to use inside each imported note\'s folder.',
		nameAttachmentFolder: 'Attachment folder',
		descAttachmentFolder: 'Folder path from the top level of the vault.',
		nameDuplicates: 'Existing notes',
		descDuplicates: 'Choose what to do when an imported note matches one in your vault. "{{update}}" skips unchanged notes and preserves newer local edits when modification dates are available.',
		optionCreateCopy: 'Create a copy',
		optionSkip: 'Skip',
		optionUpdate: 'Update',
		optionAttachmentsVault: 'Vault folder',
		optionAttachmentsFolder: 'In the folder specified below',
		optionAttachmentsNote: 'Same folder as the note',
		optionAttachmentsSubfolder: 'In subfolder under the note',
	},

	reason: {
		alreadyInVault: 'it is already in the vault',
		unchangedSinceImport: 'it has not changed since the last import',
		editedSinceImport: 'it has been edited in Obsidian since the last import',
		fileNotInVault: 'The imported file did not appear in the vault.',
		folderNotCreated: 'Failed to create folder at "{{path}}"',
	},

	tree: {
		buttonSelectAll: 'Select all',
		buttonDeselectAll: 'Deselect all',
		buttonLoad: 'Load',
		buttonLoading: 'Loading...',
		buttonRefresh: 'Refresh',
	},

	/**
	 * What a service said no to. `subject` is what was being read, `service` the
	 * name it goes by, and `credential` a sentence about the token to check.
	 */
	request: {
		msgUnauthorized: '{{service}} did not accept the request for {{subject}}. {{credential}}',
		msgForbidden: '{{service}} would not give access to {{subject}}. {{credential}}',
		msgNotFound: '{{service}} could not find {{subject}}.',
		msgRateLimited: '{{service}} is limiting how fast {{subject}} can be read. Wait a few minutes and try again.',
		msgTimedOut: '{{service}} took too long to return {{subject}}. Try again shortly.',
		msgUnavailable: '{{service}} could not return {{subject}} right now. Try again shortly.',
		msgFailedWithCode: 'Could not read {{subject}}: {{message}} ({{code}})',
		msgFailedWithMessage: 'Could not read {{subject}}: {{message}}',
		msgFailedWithReportedCode: 'Could not read {{subject}}. {{service}} reported {{code}}.',
		msgFailed: 'Could not read {{subject}}.',
	},

	template: {
		msgIntro: 'Configure how your data should be imported. Use {{syntax}} syntax to reference field values.',
		nameTitle: 'Note title',
		descTitle: 'Template for the note title. Use {{field_name}} to insert values.',
		nameLocation: 'Note location',
		descLocation: 'Template for note location/path. Use {{field_name}} to organize notes.',
		nameContent: 'Note content',
		descContent: 'Template for the note content. Use {{field_name}} to insert values.',
		headingProperties: 'Properties',
		columnPropertyName: 'Property name',
		columnPropertyValue: 'Property value',
		columnExample: 'Example',
		actionDeleteProperty: 'Delete property',
		msgTitleRequired: 'Please provide a note title template.',
	},

	importer: {
		airtableApi: {
			name: 'Airtable',
			optionText: 'Airtable',
		},
		appleNotes: {
			name: 'Apple Notes',
			optionText: 'Apple Notes',
		},
		appleJournal: {
			name: 'Apple Journal',
			optionText: 'Apple Journal (HTML export)',
		},
		bear: {
			name: 'Bear',
			optionText: 'Bear (.bear2bk)',
		},
		csv: {
			name: 'CSV',
			optionText: 'CSV (.csv)',
		},
		evernote: {
			name: 'Evernote',
			optionText: 'Evernote (.enex)',
		},
		keep: {
			name: 'Google Keep',
			optionText: 'Google Keep (.zip/.json)',
		},
		html: {
			name: 'HTML files',
			optionText: 'HTML (.html)',
		},
		onenote: {
			name: 'Microsoft OneNote',
			optionText: 'Microsoft OneNote',
		},
		notionApi: {
			name: 'Notion (API)',
			optionText: 'Notion (API)',
		},
		notion: {
			name: 'Notion',
			optionText: 'Notion (.zip)',
		},
		roamJson: {
			name: 'Roam Research',
			optionText: 'Roam Research (.json)',
		},
		textbundle: {
			name: 'Textbundle files',
			optionText: 'Textbundle (.textbundle, .textpack)',
		},
		tomboy: {
			name: 'Tomboy/Gnote',
			optionText: 'Tomboy/Gnote (.note)',
		},
	},
};
