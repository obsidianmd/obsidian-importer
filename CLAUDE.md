# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Obsidian Importer is an Obsidian plugin that imports notes from various formats (Notion, Evernote, Apple Notes, OneNote, Google Keep, Bear, Roam, CSV, HTML, etc.) into Obsidian vaults.

## Commands

- **Build**: `npm run build` (runs `tsc -skipLibCheck` then esbuild production bundle)
- **Dev**: `npm run dev` (esbuild watch mode with inline sourcemaps)
- **Lint**: `npm run lint` (eslint with `--fix`, uses flat config)

There is no automated test suite. The `tests/` directory contains fixture data for manual testing. Verify changes by building and testing the plugin in Obsidian.

## Architecture

### Plugin Entry Point

`src/main.ts` — defines `ImporterPlugin` (extends Obsidian `Plugin`), `ImporterModal` (the UI), and `ImportContext` (progress tracking during imports). All importers are registered in the `importers` map inside `ImporterPlugin`.

### Importer Pattern

Every importer extends `FormatImporter` (`src/format-importer.ts`):

1. **`init()`** — adds UI settings to `this.modal.contentEl` (file chooser, output location, format-specific options)
2. **`showTemplateConfiguration(ctx, container)`** — optional second config screen (e.g., CSV column mapping). Returns `true`/`false`/`null`.
3. **`import(ctx: ImportContext)`** — performs the actual import. Report progress via `ctx.reportNoteSuccess()`, `ctx.reportAttachmentSuccess()`, `ctx.reportSkipped()`, `ctx.reportFailed()`, `ctx.reportProgress()`.

Format implementations live in `src/formats/` — each is a file or directory.

### Registering a New Importer

Add entry to the `importers` object in `src/main.ts`:
```ts
'format-id': {
    name: 'Display Name',
    optionText: 'Dropdown text (.ext)',
    helpPermalink: 'import/format-id',
    importer: YourImporterClass,
}
```

### Key Modules

- `src/filesystem.ts` — file I/O abstraction (`PickedFile`, `NodePickedFile`, `WebPickedFile`). Must use this instead of direct Node.js `fs`/`path` imports.
- `src/template.ts` — template system for structured data (CSV, etc.). Substitutes `{{fieldName}}` placeholders and generates YAML frontmatter.
- `src/util.ts` — filename sanitization, text utilities.
- `src/zip.ts` — zip file handling via `@zip.js/zip.js`.

### Cross-Platform Compatibility

The plugin runs on desktop (Electron/Node.js) and mobile (web). Node.js modules must be soft-imported:
```ts
import type * as NodeModuleName from 'node:modulename';
const modulename: typeof NodeModuleName = Platform.isDesktopApp ? window.require('node:modulename') : null;
```

Some importers (e.g., Apple Notes) are desktop-only and set `this.notAvailable = true` on unsupported platforms.

## Code Style

- TypeScript only, strict mode
- Tabs for indentation, single quotes, semicolons
- Stroustrup brace style
- Unused function args are allowed (prefixed with `_` or not)
- `any` type is permitted
- Minimal dependencies — avoid heavy libraries
- Avoid concurrency (sequential processing to prevent memory issues with large vaults)
- esbuild bundles to single `main.js`; `obsidian`, `electron`, and `codemirror` are external
