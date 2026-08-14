# Obsidian Importer

Imports notes from other apps into an Obsidian vault.

## Project structure

- `src/main.ts` — Plugin entry, and the modal an import is shown in
- `src/importers.ts` — The registry: which formats there are, how they group, what each is called
- `src/importer-flow.ts` — The screens of an import, and `ImporterShell`, what showing them takes
- `src/importer-setting-tab.ts` — The same flow, shown in Settings
- `src/progress-ui.ts` — `ImportProgressUI`: the progress screen an `ImportContext` drives
- `src/format-importer.ts` — Base class every importer extends: file pickers, output folder, attachment paths
- `src/formats/<name>.ts` — One importer per format; the vault-facing half
- `src/formats/<name>/` — The conversion, extracted so it runs without a vault (see below)
- `src/filesystem.ts` — The only place node modules are reached, and the seam tests inject through
- `src/encoding.ts` — What encoding a file is read in; every `readText` goes through it
- `src/util.ts` — `parseHTML`, `sanitizeFileName`, `sanitizeTag`, `serializeFrontMatter`, `getUniqueFilePath`
- `src/outline.ts`, `src/block-refs.ts`, `src/markdown.ts` — what every outliner
  format needs (see below)
- `tests/shims/` — What a test needs to run importer code outside Obsidian: `obsidian.ts` (API), `dom.ts` (linkedom), `runtime.ts` (Obsidian's prototype extensions)
- `tests/<importer>/` — Fixtures, with recorded output in `expected/`

## Build and test

- `npm run build` — esbuild bundle to `main.js`
- `npm test` — every test
- `npm test -- notion` — one importer, for iterating; takes several names
- `npm run typecheck` / `npm run lint:check` — both must pass
- `npm run lint:review` — the config the Obsidian community review uses, which is stricter than ours

**`eslint-disable` does not work for the community review.** A finding has to be solved rather than suppressed.

## Where the flow is shown

`ImporterFlow` owns every screen and knows nothing about what surrounds it.
A shell supplies the elements it draws into and answers what a window has an
opinion about: the title and how deep the screen is, what Done does, and how
to come back to an import the user has left.

Two shells implement it. `ImporterModal` is the ribbon and the command on
the desktop, and draws its own Back beside Continue; on mobile both open the
setting tab instead, where the platform's own screens fit the flow better. `ImporterSettingTab` sets
`ownsBackButton`: every screen is a page opened over the tab, and Settings
puts the way back in each page's titlebar, so a second one in the content
would only say less. `back()` is what that button reaches, and it is the
same journey Back makes in the modal — one step, to the screen behind.

Which is why a screen says how deep it is. The format list is 0, the method
picker 1, and a step counts on from there; the tab opens and closes pages
until it has one for each. Only the screen the flow is on draws: pages
beneath are covered, and one deep enough to have opened several at once
leaves those it passed empty.

A running import is the exception with nothing behind it. Its back leaves
the flow altogether, and unwinds however many pages that takes.

A screen also says whether it ended in a row of buttons, which is the bar
over the bottom of the page rather than a row after the settings — Continue
on a step, Done and Import more at the end of an import, the way the modal
has always drawn them. `setButtonBar` is told once the screen has drawn,
since only then is the page it drew into the one to lay out around it.
**Obsidian's CSS may not use `:has()`**, which is why the shell puts a class
on the page rather than the stylesheet asking what is inside it.

What the bar has to get around is `will-change: transform`, the hint a page
carries for the slide it arrives on: it makes the page the containing block
for anything positioned inside it, and the page is also the scroller, so a
bar anchored to its bottom scrolls away with the screen. Cleared, the bar
answers to the box the pages sit in, which does not scroll, while still
sliding in as a descendant of its page.

Settings are drawn in cards, one per group: `addSetting` keeps to the group
its step is on, and `startGroup` breaks it where two settings are not read
together. A group takes a heading only where one was already being shown —
the cards are the grouping.

A format you export from starts its source step with `addExportSetting`: what
to ask that app for. A format you connect to starts with the thing it
connects with — a token, an account, a folder on disk — since a row naming
the service and saying nothing else only repeats the title above it. The way
to the format's documentation is Help, in the bar at the bottom of every
screen, in both shells; a format whose export takes some finding says so
twice, and calls `addInstructions` on its export row as well. The permalink
comes from the registry, through `ImporterHost`, so a format names its
documentation once.

Settings pages are why the plugin asks for Obsidian 1.13. The published
`obsidian` types are still 1.12, so `SettingPage` is declared in
`src/augment.d.ts` rather than imported from types that have it.

A shell that goes away calls `flow.detach()`, and one that comes back calls
`flow.attach()`. Between those an import keeps running with only the notice
to report it, and the flow redraws the screen it was on when the shell
returns — so the settings window can be closed mid-import and reopened onto
the same progress, pages and all. `flow.leave()` is the other way out: the
user walked back past a running import rather than closing the window, so
the format list is what they get, and `awayFrom` remembers the screen the
notice returns them to. Closing the modal is different again: it calls
`dispose()`, which cancels.

Settings closing a whole stack of pages looks like a back button pressed
several times, so `pageClosed` answers a beat later, and does nothing if the
rest of the stack — or the tab — went with it. A teardown leaves the flow
where it stood, which is what it is reopened on.

Leaving a running import puts the list back in reach, and Import with it, so
one import can be asked for while another is still going. Stopping is
cooperative — the run ends at its next checkpoint, and is writing until it
does — so a second import waits on `importRun` before it starts. An import
the user has walked out of also finishes where they left it: `awayFrom`
becomes the finished screen rather than drawing it over the list.

## The conversion seam

An importer is split in two:

- **The conversion** — HTML, JSON or SQLite in, markdown out. No vault, no network, no settings it was not handed. This is what tests drive.
- **The importer** — picks files, downloads attachments, asks the vault for a path, writes. Stays in `src/formats/<name>.ts`.

Anything the conversion needs from the vault is passed in as a callback. `src/formats/html/convert.ts` is the pattern to copy: it takes `resolveAttachment`, and the importer supplies the one that enforces its size limits and path checks.

Extracting a conversion is a **faithful move** — copy the code, do not improve it on the way. A behaviour change and a refactor in one commit cannot be reviewed.

## Importing an outliner

Roam and Logseq are the same shape of problem, so three modules are shared
rather than written twice:

- `src/outline.ts` — `OutlineNode` and `deOutline`. In an outliner everything is
  a bullet, prose and headings included, so an import that keeps the outline is
  a vault where every note is a list. Flattening asks what each block was being
  used *as*. `anchorLines` lives here too: an anchor goes on the end of a block
  of one line and on a line of its own for a block of several — appended to a
  closing fence it is read as code.
- `src/block-refs.ts` — `BlockIndex`. One block names another by an id, and the
  block it names can be on any page, so no note is finished until the graph has
  been read. Where a block is and whether anything points at it are kept apart:
  only the second decides whether an anchor is written, and `((a passing
  thought))` reads as a reference in these formats while being nobody's id.
- `src/markdown.ts` — `outsideCodeSpans`. These sources document their own
  markup as examples in code, and a conversion that rewrote those too would
  mangle the page explaining the syntax.

An importer builds `OutlineNode`s from whatever it has. Roam is handed the tree
and builds them directly; a format stored as markdown on disk has to parse its
outline first and gets the same answers afterwards.

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

`tests/shims/obsidian.ts` reimplements `htmlToMarkdown` (turndown) and `stringifyYaml` (the `yaml` package). They agree with the app on the fixtures here, and each rule in the shim was added to close a difference that was measured rather than guessed.

When a recording depends on one of them, check it against the real thing rather than assuming:

1. Add `(window as any).__probe = <the API>;` to `onload()` in `src/main.ts`, `npm run build`, then `obsidian plugin:reload id=obsidian-importer`.
2. `obsidian eval code="..."` runs in the app. Write the result to a file with `require('fs')` and diff it against the shim's.
3. Revert the probe and rebuild.

`vault=<name>` targets a vault other than the focused one, but only as the **first** argument: `obsidian vault=Importer eval code="…"`. After the command it is ignored, and you get the focused vault instead — check `app.vault.getName()` if a result looks like it came from somewhere else.

## Localization

Every string the plugin shows comes from `src/i18n/en.ts`, reached through a
proxy that mirrors the shape of the table:

```ts
i18n.modal.buttonDone()
i18n.progress.statusStandardizing({ current, total })
i18n.nouns.fileWithCount({ count })          // the _plural key when count !== 1
i18n.importer(`${id}.name`)                  // a key only known at runtime
```

Keys are camelCase in TypeScript and kebab-case in a translation file, so
`msgPickFile` is `[common.msg-pick-file]`. `setLanguage()` is called once in
`onload()` with Obsidian's `getLanguage()`; left alone the lookup answers in
English, which is what a test wants.

`locale/en.txt` and `locale/*.txt` are in the obsidian-translations block
format, and `src/i18n/locales.ts` is the bundled result. All three are
generated:

```bash
npm run locales          # after adding or changing a string in en.ts
npm run locales -- check # what the test suite runs
```

Adding a string means adding it to `en.ts` and regenerating; the tests fail
otherwise. A translation is checked too: it must carry the same placeholders as
its English, a plural form if the English has one, and the same whitespace at
either end — a value ending in a space is what separates it from the link or
name drawn beside it.

A number goes through `toLocaleString` in the chosen language, so a count reads
`10 000` in French even when the machine underneath is set to English. Two
strings that meet on screen each need their own key: interpolating an internal
identifier (a block kind, an enum member) leaves English inside a translated
sentence. Close that set with a union type and a `Record` keyed by it —
`BlockContext` in `formats/notion-api/types.ts` — so a new member cannot compile
until it has a label.

A label dropped into a sentence carries whatever article its language needs:
French `du paragraphe` / `de la colonne`, because the sentence around it cannot
know the gender of the noun arriving.

What stays out of the table: console messages, the errors the scripted
`runImport` throws, and anything written into a note — a title, a folder name,
a property. Those have to read the same whoever ran the import.

`obsidianmd/ui/sentence-case-locale-module` lints `en.ts` the way
`obsidianmd/ui/sentence-case` lints a `setName()` call. Both read their brands
and exceptions from one object at the top of `eslint.config.mjs`.

## Rules

- **Never reach for a node module directly.** Everything goes through `src/filesystem.ts`, which is what lets a conversion run in a test, and one day in a browser. `obsidianmd/no-nodejs-modules` flags it — a warning here, a finding in the community review.
- **`requestUrl`, not `fetch`,** for anything the plugin downloads: it is not bound by CORS.
- **Await every vault write.** An unawaited `create` or `modify` races the next read of the same file.
- **A path built from user data is untrusted.** File names go through `sanitizeFileName`; a resolved `file:` URL is checked against the directory it is allowed to read.
- **Report, don't throw.** A single bad note should be `ctx.reportFailed(...)`, leaving the rest of the import to finish.
- **No new string literal on screen.** Text the user reads goes in `src/i18n/en.ts`, including the reason handed to `reportSkipped`/`reportFailed`.

## Common pitfalls

- `Element.createEl` **appends**; the global `createEl` does not. Using the wrong one on a document root attaches nodes to the page.
- `createEl` with a `null` attribute value omits the attribute; `undefined` writes the string `"undefined"`.
- **Don't add an `id` property to a Modal subclass.** Obsidian assigns one, and a getter with no setter swallows the write and hangs the app on open. Name it something else (`importerId`).
- **A field initialiser runs *after* `init()`.** `FormatImporter`'s constructor calls `init()`, and JavaScript runs a subclass's field initialisers after `super()` returns — so `private x: T | null = null` throws away whatever `init()` assigned to `x`, silently. Declare without an initialiser (`private x: T | null;`) for anything `init()` sets. It has caught three importers; the Notion API grew two workarounds around it — re-finding an element with `querySelector`, and capturing buttons in closures "to avoid constructor timing issues" — before the cause was named.
- From `eval`, close a modal with an `Escape` keydown. Clicking `.modal-close-button` does not close it, and detaching `.modal-container` wedges the app.
- linkedom has no `HTMLAudioElement`, `HTMLVideoElement` or `HTMLBRElement`, so check `tagName` rather than `instanceOf` in conversion code. It also does not specialise every tag it *does* have a constructor for — `p.instanceOf(HTMLParagraphElement)` is false under the shim while `img.instanceOf(HTMLImageElement)` is true. A missing constructor throws; an unspecialised one just returns false, so the predicate reads as working and the recording it produces looks green.
- `htmlToMarkdown` on a whole document drops `head`; turndown does not, which is why the shim removes it explicitly.
- Obsidian's markdown escapes nothing coming out of HTML, and percent-encodes spaces in link targets rather than wrapping them in `<>`.
