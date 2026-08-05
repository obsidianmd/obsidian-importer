# Obsidian Importer

Imports notes from other apps into an Obsidian vault.

## Project structure

- `src/main.ts` — Plugin entry, the importer registry, `ImportContext` (progress and reporting)
- `src/format-importer.ts` — Base class every importer extends: file pickers, output folder, attachment paths
- `src/formats/<name>.ts` — One importer per format; the vault-facing half
- `src/formats/<name>/` — The conversion, extracted so it runs without a vault (see below)
- `src/filesystem.ts` — The only place node modules are reached, and the seam tests inject through
- `src/util.ts` — `parseHTML`, `sanitizeFileName`, `serializeFrontMatter`, `getUniqueFilePath`
- `tests/shims/` — What a test needs to run importer code outside Obsidian: `obsidian.ts` (API), `dom.ts` (linkedom), `runtime.ts` (Obsidian's prototype extensions)
- `tests/<importer>/` — Fixtures, with recorded output in `expected/`

## Build and test

- `npm run build` — esbuild bundle to `main.js`
- `npm test` — every test
- `npm test -- notion` — one importer, for iterating; takes several names
- `npm run typecheck` / `npm run lint:check` — both must pass
- `npm run lint:review` — the config the Obsidian community review uses, which is stricter than ours

**`eslint-disable` does not work for the community review.** A finding has to be solved rather than suppressed.

## The conversion seam

An importer is split in two:

- **The conversion** — HTML, JSON or SQLite in, markdown out. No vault, no network, no settings it was not handed. This is what tests drive.
- **The importer** — picks files, downloads attachments, asks the vault for a path, writes. Stays in `src/formats/<name>.ts`.

Anything the conversion needs from the vault is passed in as a callback. `src/formats/html/convert.ts` is the pattern to copy: it takes `resolveAttachment`, and the importer supplies the one that enforces its size limits and path checks.

Extracting a conversion is a **faithful move** — copy the code, do not improve it on the way. A behaviour change and a refactor in one commit cannot be reviewed.

## Fixtures and recorded output

Every importer is tested by converting a real file and comparing against a recorded output committed beside it.

```
tests/notion/Export-xyz.zip              fixture
tests/notion/expected/Export-xyz/…       what converting it produces
tests/notion/local/                      gitignored, for a file that cannot be committed
```

To record or update:

```bash
UPDATE_EXPECTED=1 npm test -- notion
```

This writes the output and **fails on purpose**. Read what it wrote — `git diff` if it already existed — then re-run without the variable. A recording nobody reads is not a check; it just goes green.

Without `UPDATE_EXPECTED`, output that differs from its recording is a failure. That is the point: a conversion change shows up as a diff you have to look at.

### Fixing a bug

1. Add a fixture that reproduces it, as small as is useful and anonymised — replace real names, emails, account ids and tokens with placeholders. Organisations and product names can stay; how they convert is part of what is being checked.
2. **Verify the fixture fails before the fix.** Record the expected output with the fix reverted, or check that the recording shows the wrong behaviour. A fixture that passes on both old and new code proves nothing.
3. Apply the fix, re-record, and read the diff. Every changed line should be a line you meant to change.

### API-based importers

Airtable, OneNote and Notion API have no export file to use as a fixture. The fixture is a saved API response instead, in the shape the endpoint returns, with a `_comment` naming the endpoint. See `tests/airtable/example-base.json`.

A saved response goes stale silently, so those importers also get a live check that asks the real API whether the shape still holds. It skips unless a token is set:

```
# .env, not committed
AIRTABLE_TOKEN=pat...
AIRTABLE_BASE_ID=app...
```

See `tests/airtable/live.test.ts`. Live checks read; they never write.

### The end-to-end check

`npm run e2e` imports fixtures through the running app - its `htmlToMarkdown`,
its vault, its YAML - and compares what lands in the vault with what `npm test`
recorded. It is what catches the shim drifting from the real thing; it found
the YAML dialect differences the shim now matches.

It needs the Obsidian CLI, the plugin enabled in the active vault, and a build
of the current source deployed there. It writes one folder and deletes it after.

Cases are limited to fixtures whose conversion does not depend on the vault: no
attachment downloads, no links to other imported notes. Anything else differs
for good reasons - a vault path, a link in the user's preferred form.

## Verifying against Obsidian itself

`tests/shims/obsidian.ts` reimplements `htmlToMarkdown` (turndown) and `stringifyYaml` (js-yaml). They agree with the app on the fixtures here, and each rule in the shim was added to close a difference that was measured rather than guessed.

When a recording depends on one of them, check it against the real thing rather than assuming:

1. Add `(window as any).__probe = <the API>;` to `onload()` in `src/main.ts`, `npm run build`, then `obsidian plugin:reload id=obsidian-importer`.
2. `obsidian eval code="..."` runs in the app. Write the result to a file with `require('fs')` and diff it against the shim's.
3. Revert the probe and rebuild.

`obsidian eval` ignores a `vault=` argument — it always uses the active vault. Check which one that is (`app.vault.getName()`) before trusting a result.

## Rules

- **Never reach for a node module directly.** Everything goes through `src/filesystem.ts`, which is what lets a conversion run in a test, and one day in a browser. `obsidianmd/no-nodejs-modules` flags it — a warning here, a finding in the community review.
- **`requestUrl`, not `fetch`,** for anything the plugin downloads: it is not bound by CORS.
- **Await every vault write.** An unawaited `create` or `modify` races the next read of the same file.
- **A path built from user data is untrusted.** File names go through `sanitizeFileName`; a resolved `file:` URL is checked against the directory it is allowed to read.
- **Report, don't throw.** A single bad note should be `ctx.reportFailed(...)`, leaving the rest of the import to finish.

## Common pitfalls

- `Element.createEl` **appends**; the global `createEl` does not. Using the wrong one on a document root attaches nodes to the page.
- `createEl` with a `null` attribute value omits the attribute; `undefined` writes the string `"undefined"`.
- **Don't add an `id` property to a Modal subclass.** Obsidian assigns one, and a getter with no setter swallows the write and hangs the app on open. Name it something else (`importerId`).
- From `eval`, close a modal with an `Escape` keydown. Clicking `.modal-close-button` does not close it, and detaching `.modal-container` wedges the app.
- linkedom has no `HTMLAudioElement` or `HTMLVideoElement`, so check `tagName` rather than `instanceOf` in conversion code.
- `htmlToMarkdown` on a whole document drops `head`; turndown does not, which is why the shim removes it explicitly.
- Obsidian's markdown escapes nothing coming out of HTML, and percent-encodes spaces in link targets rather than wrapping them in `<>`.
