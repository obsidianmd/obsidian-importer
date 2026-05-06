# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development build with watch mode
npm run dev

# Production build (type-checks first)
npm run build

# Lint and auto-fix
npm run lint
```

No test runner is configured — the plugin is tested manually inside Obsidian.

## Architecture

This is an Obsidian community plugin. The build outputs `main.js` (bundled via esbuild) which Obsidian loads directly.

### Core abstractions

- **`src/format-importer.ts`** — Base class `FormatImporter` that all importers extend. Provides helpers for UI settings, file choosers, folder creation, and vault write operations.
- **`src/main.ts`** — Plugin entry point; registers all importers via `ImportContext`, which tracks progress/cancellation.
- **`src/filesystem.ts`** — Filesystem abstractions (`PickedFile`, `PickedFolder`). `ZipEntryFile` (in `src/zip.ts`) also implements `PickedFile` for files inside ZIPs.

### Notion importer (most complex format)

Located in `src/formats/notion/` with entry point `src/formats/notion.ts`. Uses a **two-pass approach**:

**Pass 1 — `parseFileInfo`** (`parse-info.ts`): Iterates all zip entries to build two lookup maps in `NotionResolverInfo`:
- `idsToFileInfo`: maps Notion UUID → `NotionFileInfo` (title, path, parentIds)
- `pathsToAttachmentInfo`: maps zip filepath → `NotionAttachmentInfo` (nameWithExtension, targetParentFolder)

**Pass 2 — conversion** (`notion.ts`): Resolves paths via `cleanDuplicates`, creates vault folders, then converts HTML→Markdown and writes files.

**Key types** (`notion-types.ts`):
- `NotionFileInfo` / `NotionAttachmentInfo` — per-file metadata populated during pass 1, mutated during dedup
- `NotionResolverInfo` — container for both maps + `getPathForFile()` which reconstructs vault-relative folder paths from `parentIds`

**Link conversion** (`convert-to-md.ts` → `convertLinksToObsidian`): Converts Notion HTML anchor tags to Obsidian `[[wikilinks]]`. For attachments, currently generates `![[filename.ext]]` (filename only) unless `fullLinkPathNeeded` is true (in which case it prepends `targetParentFolder`).

**Deduplication** (`clean-duplicates.ts` → `cleanDuplicateAttachments`): Sets `attachmentInfo.targetParentFolder` for each attachment. When the user has configured attachments in the current folder (Obsidian setting `./subfolder`), it calls `info.getPathForFile(attachmentInfo)` to place the attachment alongside its parent note.

### Known bugs (as of this writing)

**Bug 1 — Filename collision for same-named files in different zip folders** (e.g. `p1/1.png` and `p2/1.png`):
In `parse-info.ts`, `nameWithExtension` is set to `sanitizeFileName(decodeURIComponent(file.name))` — just the bare filename, not the path. Both files end up as `nameWithExtension: '1.png'` and the second overwrites the first in `pathsToAttachmentInfo` (keyed by full zip path), but the dedup check in `cleanDuplicateAttachments` only checks `attachmentPaths` *after* `targetParentFolder` is determined, so the collision isn't caught for files that land in different vault folders. When copying, `vault.createBinary` will attempt to write both to their respective `targetParentFolder`, but the wikilink reference will still only use the bare filename.

**Bug 2 — Attachment links use filename only, not relative path**:
In `convertLinksToObsidian` (`convert-to-md.ts`, ~line 662), attachment links are formatted as:
```ts
attachmentInfo.fullLinkPathNeeded
  ? attachmentInfo.targetParentFolder + attachmentInfo.nameWithExtension + '|' + attachmentInfo.nameWithExtension
  : attachmentInfo.nameWithExtension
```
The user wants wikilinks in the form `![[./p1/1.png]]` (path relative to the markdown file's location) rather than `![[1.png]]`. The `targetParentFolder` is an absolute vault path, not a relative path from the note, so it cannot be used directly for this purpose. A relative path needs to be computed from the note's resolved path to the attachment's resolved path.
