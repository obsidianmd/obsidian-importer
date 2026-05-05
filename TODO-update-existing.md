# TODO: Update existing notes option for OneNote importer

## Tasks

- [x] Replace boolean property with 2-value enum type
  In `onenote.ts`, replace `importPreviouslyImported: boolean = false` with an enum:
  `reimportBehavior: ReimportBehavior = ReimportBehavior.Skip`
  Enum values: `Skip`, `Reimport` (the `Update` value is added in the next step)

- [x] Replace toggle with dropdown in the UI, and add `Update` enum value
  In `init()`, replace the "Skip previously imported" toggle (lines 95-101) with an `addDropdown`
  Setting offering three options:
  - "Skip previously imported" → `ReimportBehavior.Skip` (default)
  - "Update if modified in OneNote" → `ReimportBehavior.Update` (add this enum value here)
  - "Always reimport" → `ReimportBehavior.Reimport`

- [ ] Update skip logic in the import loop
  At `onenote.ts:459`, replace the single boolean check with a 3-branch condition:
  - `'skip'`: current behavior — skip if page id is in `previouslyImported`
  - `'update'`: skip only if existing markdown `mtime >= Date.parse(page.lastModifiedDateTime!)` (both are UTC ms since epoch)
  - `'reimport'`: never skip, always process
  For `'update'`, find the existing `.md` file in the page folder using `getEntityPathNoParent`,
  then read its `stat.mtime` via `vault.adapter.stat()`.

- [ ] Handle overwrite when reimporting an existing note
  When `'update'` or `'reimport'` causes an already-existing markdown file to be re-processed,
  delete the existing `.md` file before calling `processFile` — otherwise `saveAsMarkdownFile`
  (which calls `createNewMarkdownFile`) will create a duplicate with a numeric suffix.
  Find and delete the existing `.md` file in the page folder before importing.

## Notes

- No migration needed: `importPreviouslyImported` is not persisted, only `previouslyImportedIDs` is.
  Existing users will see the dropdown defaulting to "Skip previously imported" — same as current behaviour.
- Time comparison is safe: both `file.stat.mtime` and `Date.parse(page.lastModifiedDateTime!)` are
  UTC milliseconds since epoch. `processFile` already sets the markdown file's `mtime` to
  `page.lastModifiedDateTime` after each import, so the comparison is exact.
- The trickiest part is finding the right `.md` file to delete in step 4 before re-importing.
