# Obsidian Importer

Imports notes from other apps into an Obsidian vault.

## Project structure

- `src/main.ts` — Plugin entry point and desktop import modal
- `src/importers.ts` — Importer registry, groups, names, icons, and help links
- `src/importer-flow.ts` — Shared import screens and the `ImporterShell` contract
- `src/importer-setting-tab.ts` — Settings host for the shared flow
- `src/progress-ui.ts` — `ImportProgressUI`, the progress screen driven by an `ImportContext`
- `src/format-importer.ts` — Base importer: steps, file pickers, templates, output folders, duplicate handling, note writes, and attachments
- `src/note-template.ts`, `src/note-template-configurator.ts` — Knap template rendering and configuration
- `src/list-properties.ts` — Final normalization of Obsidian's built-in list properties
- `src/formats/<name>.ts` — Vault-facing importer code
- `src/formats/<name>/` — Conversion code split out so it can run without a vault, when the format has such a split
- `src/filesystem.ts` — Shared filesystem and Node-module seam injected by tests
- `src/encoding.ts` — Encoding detection used by every `PickedFile.readText()` implementation
- `src/util.ts` — Shared parsing, sanitizing, frontmatter, and unique-path helpers
- `src/outline.ts`, `src/block-refs.ts`, `src/markdown.ts` — Reusable outliner primitives described below
- `tests/shims/` — Obsidian API, DOM, runtime-prototype, vault, picker, and zip substitutes used outside the app
- `tests/<importer>/` — Fixtures, tests, and recorded output under `expected/`

## Build and test

- `npm run build` — Typecheck and create the production `main.js` bundle
- `npm test` — Run every test
- `npm test -- notion` — Run one importer suite; several suite names may be supplied
- `npm run typecheck` and `npm run lint:check` — Both must pass
- `npm run lint:review` — Run the stricter configuration used for Obsidian community-plugin review

**`eslint-disable` does not suppress findings in the community review.** Resolve the finding instead.

## Import flow hosts

`ImporterFlow` owns the import screens and is independent of its surrounding window. An `ImporterShell` supplies its content and container elements, navigation chrome, focus behavior, button-bar placement, finish behavior, and a way to bring the flow forward.

`ImporterModal` hosts the ribbon and command flow on desktop. On mobile, both entry points open `ImporterSettingTab`. Settings renders each screen beyond the format list as a `SettingPage`. On phones, Settings owns the title-bar back button, so `ownsBackButton` prevents the flow from drawing a second one; larger screens and the modal put Back beside Help.

Screen depth is the number of screens beyond the format list: the list is 0, a grouped method picker is 1, and importer steps continue from there. The Settings shell opens or closes pages until its stack matches that depth. A running import has no screen behind it, so Back leaves the flow and unwinds the page stack.

Each screen passes its action row to `adoptButtonBar`; the format list passes `null`. In Settings, the shell keeps the bar outside the scrolling, animated `SettingPage` and refills it in place so it neither scrolls away nor jumps during a page transform. The shell also toggles `has-button-bar` so the page's scrollbar ends above the bar. Do not replace that class with `:has()`; community-plugin CSS may not use `:has()`.

An importer with a separate configuration screen overrides `configures`, which changes the last source step from Import to Continue. The run stays on the configuration page and redraws its `ImportProgressUI` there. Construct that UI in the configuration screen's container; otherwise its initial render flashes beneath the configuration before the run redraws it.

File-export importers begin with `addExportSetting`. If finding the export needs extra help, wrap that row with `addInstructions`. Connected importers begin with the credential, account, or folder they actually require rather than a redundant service-name row. Help appears on every screen and comes from the registry's single `helpPermalink`, exposed through `ImporterHost`.

Settings pages require Obsidian 1.13, which is why `manifest.json` declares `minAppVersion: 1.13.0`. The published `obsidian` package is still 1.12.3, so the missing 1.13 `SettingPage` APIs are declared in `src/augment.d.ts`.

A host calls `flow.detach()` when its UI disappears and `flow.attach()` when it returns. Detaching leaves an active import running and reports progress through a notice; attaching redraws its saved screen. `flow.leave()` returns to the format list while preserving the background run in `awayFrom`. `flow.dispose()` permanently tears down the flow and cancels its work; closing the modal uses it.

`ImporterSettingTab.pageClosed()` defers its answer by one microtask so Settings can finish changing the page stack. It treats a single remaining stack change as Back and ignores wholesale page or tab teardown, preserving the flow for reopening.

Leaving a running import makes the format list available, but imports remain serialized. Stopping is cooperative and the current run may write until its next checkpoint, so a second import waits for `importRun`. A background run that finishes updates `awayFrom` to its finished screen instead of drawing over the format list.

## Conversion boundary

Keep an importer split into two layers when practical:

- **Conversion** — HTML, JSON, SQLite, or another source representation in; Markdown and metadata out. It has no vault, network, or undeclared settings. Unit tests drive this layer.
- **Importer** — Selects files, talks to APIs, downloads attachments, resolves vault paths, and writes. It lives in `src/formats/<name>.ts`.

Pass anything the conversion needs from the vault as a callback. `src/formats/html/convert.ts` is the model: it accepts `resolveAttachment`, and the importer supplies a callback that enforces size limits and path checks.

Extracting a conversion must be a **faithful move**. Do not combine behavioral improvements with the extraction; a refactor and behavior change in one commit cannot be reviewed independently.

## Templates and final Markdown

Every note importer has a Markdown template preview step. Shared template behavior belongs in `src/note-template.ts`, `src/note-template-configurator.ts`, and `FormatImporter`; importer-specific variables and preview samples stay with the importer. Templates use Knap, with the shared Web Clipper-style filters plus Importer's Markdown and fragment-link behavior. Keep `docs/templates.md` synchronized with variables or behavior exposed to users.

`FormatImporter` applies the selected template and managed source-ID property before writing. Every Markdown note shown in preview or written through `FormatImporter` then passes through `normalizeListProperties`, which enforces list values for `tags`, `aliases`, and `cssclasses`. A conversion harness whose output changes at that final boundary must apply the normalization too, so its recording matches the note that reaches the vault.

Duplicate handling is centralized in `planNote`, `preflightNote`, and `writePlannedNote`. Reuse them rather than implementing importer-specific path matching or overwrite behavior. In update mode, a source modification time allows locally edited notes to be preserved before conversion; without one, the rendered content is compared before writing.

## Importing an outliner

Roam and Logseq have the same broad problem but different source models. Reuse primitives only when their contracts match; keep parsing and source-specific anchor rules with the format that owns them.

- `src/outline.ts` provides `OutlineNode`, `deOutline`, and `anchorLines` for importers that already receive a block tree, currently Roam. An outliner treats prose and headings as bullets, so flattening must infer what each block was used as. A one-line block keeps its anchor at the end; a multiline block puts the anchor on its own line so it cannot become part of a closing code fence. Logseq must preserve Markdown continuation lines, physical indentation, and property lines, so its parser and serializer live in `src/formats/logseq/de-outline.ts`.
- `src/block-refs.ts` provides `BlockIndex` for sources, currently Roam, whose reference mentions and definitions arrive as separate graph records. A referenced block may be on any page, so the complete graph must be read before notes are finalized. Track where a block is separately from whether anything references it; only the latter determines whether to emit an anchor. `((a passing thought))` is a reference-shaped string, not necessarily a block ID. Logseq discovers `id::` definitions while rewriting Markdown, so its UUID-to-anchor logic stays beside that parser in `src/formats/logseq/block-ids.ts`.
- `src/markdown.ts` provides `outsideMarkdownCode`, `outsideMarkdownFences`, and `markdownFenceLines` for both importers. Use `outsideMarkdownCode` for character-level rewrites and `outsideMarkdownFences` for line-oriented rewrites, where inline code must not split a logical line. Do not rewrite source syntax shown inside code examples.

An importer given a source tree can build shared `OutlineNode`s directly. A Markdown-backed outliner may need a format-specific parser because the shared tree does not represent all significant syntax and physical layout.

## Fixtures and recorded output

Importer tests convert real fixtures and compare them with committed output:

```text
tests/notion/Export-xyz.zip              fixture
tests/notion/expected/Export-xyz/…       recorded conversion output
tests/notion/local/                      gitignored private fixtures
```

To create or update a recording:

```bash
UPDATE_EXPECTED=1 npm test -- notion
```

This writes the output and **fails intentionally**. Read the new files or `git diff`, then rerun without `UPDATE_EXPECTED`. A recording that nobody reviews is not a useful check.

### Fixing a bug

1. Add the smallest useful fixture that reproduces the bug. Anonymize real names, email addresses, account IDs, and tokens; organization and product names may remain when their conversion matters.
2. **Verify that the fixture fails before the fix.** Record the old, incorrect behavior or otherwise prove the old code fails. A fixture that passes before and after the change proves nothing.
3. Apply the fix, rerecord, and inspect every changed line.

### API-based importers

API importers use saved endpoint responses as deterministic fixtures; include a `_comment` naming the endpoint when the fixture format allows it. Airtable and Notion API also have read-only live checks because saved responses can silently become stale. OneNote uses saved responses but currently has no live check.

Live checks skip unless their credentials are present in the uncommitted `.env`:

```dotenv
AIRTABLE_TOKEN=pat...
AIRTABLE_BASE_ID=app...       # optional
NOTION_TOKEN=ntn_...
NOTION_PAGE_ID=...            # optional
```

See `tests/airtable/live.test.ts` and `tests/notion-api/live.test.ts`. Live checks must never write.

### End-to-end check

`npm run e2e` imports selected fixtures through the running app, including its real `htmlToMarkdown`, vault, and YAML behavior, then compares the notes with `npm test` recordings. This detects drift between `tests/shims/` and Obsidian.

The check requires the Obsidian CLI, the plugin enabled in the target vault, and the current source built and deployed there. It uses `E2E_VAULT` when set; otherwise it derives the vault from `OBSIDIAN_PATH`. It writes `_e2e-check` and trashes that folder after the run.

E2E cases are limited to conversions whose output does not depend on vault-specific attachment placement or link preferences. Such cases differ from recordings for legitimate reasons.

## Verifying behavior in Obsidian

`tests/shims/obsidian.ts` reimplements `htmlToMarkdown` with Turndown and `stringifyYaml` with `yaml`. Its rules match the fixtures because differences were measured against the app rather than guessed. When a recording depends on either API and the E2E suite does not cover the case, verify it in Obsidian:

1. Temporarily expose the API from `onload()` in `src/main.ts`, for example `(window as any).__probe = <API>`, run `npm run build`, and reload with `obsidian plugin:reload id=obsidian-importer`.
2. Run it with `obsidian eval code="..."`; write complex results to a file with `require('fs')` and compare them with the shim.
3. Remove the probe and rebuild.

To target another vault, `vault=<name>` must be the **first** CLI argument: `obsidian vault=Importer eval code="…"`. In any other position it is ignored. Check `app.vault.getName()` when the result appears to come from the wrong vault.

## Localization

All user-visible plugin text comes from `src/i18n/en.ts` through a proxy that mirrors the table:

```ts
i18n.modal.buttonDone()
i18n.progress.statusStandardizing({ current, total })
i18n.nouns.fileWithCount({ count })          // uses _plural when count !== 1
i18n.importer(`${id}.name`)                  // runtime-only key
```

Keys are camelCase in TypeScript and kebab-case in locale files, so `msgPickFile` becomes `[common.msg-pick-file]`. `setLanguage()` is called once from `onload()` with Obsidian's `getLanguage()`; without that call, tests remain in English.

`locale/*.txt` uses the obsidian-translations block format, and `src/i18n/locales.ts` is the bundled translation table. Both are generated from `src/i18n/en.ts`:

```bash
npm run locales          # regenerate after changing en.ts
npm run locales -- check # check only; run by the test suite
```

Translations must preserve the English placeholders, provide a plural form when English has one, and preserve leading and trailing whitespace. Intentional trailing space may separate a translated fragment from a neighboring link or name.

Numbers are formatted with `toLocaleString` in the selected language. Adjacent UI fragments need separate keys; interpolating an internal identifier such as an enum member leaves English inside a translated sentence. Represent a closed label set with a union and keyed `Record`, as `BlockContext` does in `src/formats/notion-api/types.ts`, so a new member cannot compile without a label. A label inserted into a sentence must include any language-specific article it needs, because the surrounding sentence cannot infer grammatical gender.

Developer-only console messages, errors thrown by scripted `runImport`, and text written into imported notes do not belong in the translation table; their output must remain stable across UI languages.

`obsidianmd/ui/sentence-case-locale-module` checks `src/i18n/en.ts`, and `obsidianmd/ui/sentence-case` checks direct UI calls such as `setName()`. Both use the shared brands and exceptions at the top of `eslint.config.mjs`.

## Rules

- **Keep runtime Node access behind an adapter.** Application code imports Node bindings from `src/filesystem.ts`, which tests replace and browser-capable paths avoid. `src/formats/apple-notes/sqlite/index.js` is the intentional adapter exception for its SQLite fallback. `obsidianmd/no-nodejs-modules` is a warning locally and a finding in community review.
- **Use `requestUrl` for downloads by default.** It is not restricted by CORS. Native `fetch` is acceptable only when a required browser feature is missing from `requestUrl`; the abortable OneNote request is the existing example.
- **Await every vault write.** An unawaited `create`, `modify`, or binary equivalent can race the next read of the same file.
- **Treat paths built from user data as untrusted.** Pass filenames through `sanitizeFileName`, sanitize multi-segment paths, and verify a resolved `file:` URL remains inside the directory it may read.
- **Report per-item failures instead of aborting the import.** Use `ctx.reportFailed(...)` for one bad note and continue. Throw only when the import as a whole cannot proceed.
- **Do not add user-visible string literals.** Put UI text, including reasons passed to `reportSkipped` and `reportFailed`, in `src/i18n/en.ts` and regenerate locales.

## Common pitfalls

- `Element.createEl` appends to that element; the global `createEl` does not. Using the wrong one for a document root can attach nodes to the page.
- A `null` attribute value passed to `createEl` omits the attribute; `undefined` writes the string `"undefined"`.
- Do not add an `id` property to a `Modal` subclass. Obsidian assigns it, and a getter without a setter swallows the assignment and can hang the app when the modal opens. Use another name such as `importerId`.
- `FormatImporter` calls the subclass's `init()` from its constructor, before subclass field initializers run. If `init()` assigns a field, declare it without an initializer; otherwise an initializer such as `private x: T | null = null` silently overwrites the value after `super()` returns.
- From `obsidian eval`, close a modal by dispatching an Escape keydown. Clicking `.modal-close-button` does not close it, and detaching `.modal-container` wedges the app.
- linkedom has no `HTMLAudioElement`, `HTMLVideoElement`, or `HTMLBRElement`, and it does not specialize every element for which it exposes a constructor. For example, `p instanceof HTMLParagraphElement` is false under the shim while `img instanceof HTMLImageElement` is true. Prefer `tagName` in conversion code; a missing constructor throws, while an unspecialized element merely makes `instanceof` return false and can hide a bad recording.
- Obsidian's `htmlToMarkdown` drops `head` when given a whole document; Turndown alone does not, so the shim removes it explicitly.
- Obsidian's HTML-to-Markdown conversion does not escape text and percent-encodes spaces in link targets instead of enclosing targets in angle brackets.
