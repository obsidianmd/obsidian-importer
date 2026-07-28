# Logseq Importer: Transformation Reference

This document is the authoritative, up-to-date reference for **every transformation the Logseq
importer performs** and **every option that controls it**. It reflects the actual implementation
under `src/formats/logseq/`. The companion
[implementation summary](./logseq-importer-assessment.md) records the design considerations,
decisions, and tradeoffs behind it.

Tests and implementation comments cross-reference this document with letter-number labels: one
letter per top-level section (`A` through `M`) plus a rule number, such as `[G1]`. Older
development-phase labels are no longer used as public references.

Guiding principle throughout: preserve source content when there is no safe automatic mapping.
Intentional cleanup is limited to documented defaults and user-selected drop options. Files that
cannot be imported are reported through `ctx.reportSkipped` / `reportFailed`; individual syntax
cleanup inside an imported note is governed by the options in section B.

## Contents

- [A. Pipeline overview](#a-pipeline-overview)
- [B. Options reference](#b-options-reference)
- [C. Document structure & de-outlining](#c-document-structure--de-outlining)
- [D. Tasks](#d-tasks)
- [E. Journals & dates](#e-journals--dates)
- [F. Pages, namespaces & output paths](#f-pages-namespaces--output-paths)
- [G. Links, references & embeds](#g-links-references--embeds)
- [H. Tags](#h-tags)
- [I. Properties](#i-properties)
- [J. Inline syntax & blocks](#j-inline-syntax--blocks)
- [K. Media & assets](#k-media--assets)
- [L. Logseq-only content](#l-logseq-only-content)
- [M. Name collisions & disambiguation](#m-name-collisions--disambiguation)

---

## A. Pipeline overview

The import runs in **two passes** so that cross-file references can be resolved against a
vault-wide index that only exists once every file has been planned and locally converted.

**Planning.** Markdown files under `pages/` and `journals/` are enumerated recursively. Each is
assigned a canonical name and an output path (section F). During planning, files are skipped when:

- A scanned Markdown path contains `/whiteboards/` — not supported.
- Two sources would map to the *same output path* — the first wins; later colliders are reported
  and skipped (no silent overwrite).

From the surviving plans we build:

- a **basename disambiguation index** (`basename → [full path, …]`, section M).

**Pass 1 — per-file local conversion** (`convertLocal` in `pipeline.ts`). Everything that can be
done on a single file without the vault index. In order:

1. `extractPageProperties` — leading `key:: value` block → YAML frontmatter (section I).
2. `convertHeadingProperty` — `heading:: N` → `#`×N prefix on the block.
3. `convertTasks` — task keywords + metadata → chosen task format (section D).
4. `convertNumberedLists` — `logseq.order-list-type:: number` → `1.`/`2.`/…
5. `convertOrgBlocks` — `#+BEGIN_*`/`#+END_*` → callouts / blockquotes / comments.
6. `convertHighlights` — `^^text^^` → `==text==`.
7. `convertMediaEmbeds` — `{{video|youtube|tweet URL}}` → `![](URL)`.
8. `fixHeadingChildLists` — heading immediately followed by an indented list gets a `- ` prefix.
9. `fixCodeBlocksInLists` — align a list-nested code block's closing fence.
10. `convertAssetLinks` — `![alt](../assets/x.png)` → `![[x.png]]`, collecting assets to copy.
11. `convertAliasLinks` — `[display]([[Page]])` → `[[Page|display]]`.
12. `convertJournalDateLinks` — `[[Aug 30th, 2024]]` → `[[2024-08-30]]`.
13. `attachBlockIds` — `id:: <uuid>` → `^shortid` anchor on the block; collect the id index.
14. `removeLeftoverBlockProperties` — drop or serialize remaining block properties.
15. `normalizeWhitespace` — optionally normalize non-breaking spaces, trailing whitespace, and
    empty bullets.

While iterating, pass 1 also builds the **block-id index** (`uuid → {page, shortId}`), the
**alias index** (`alias → canonical page`, including `title::` — ambiguous aliases removed
afterward), and the **asset plan** (absolute source → filename). Logseq-only content (queries,
flashcards) is applied after `convertLocal`; section L documents how this ordering affects advanced
query blocks and flashcard tags.

After pass 1, the **known-pages set** is built from the lower-cased canonical names of intermediates
whose YAML or body is non-empty. Pages that are blank after pass-1 transforms are excluded so that
tag conversion doesn't create links to pages that will never be written. A basename by itself does
not represent a namespaced page in this set. A page that becomes empty only after pass-2 cleanup can
still be present in the set.

> Tag conversion is **deliberately deferred to pass 2** because the `onlyExistingPages` option
> needs the complete known-pages set, which is only available after pass 1 is complete.

**Pass 2 — cross-file resolution + write** (in `logseq.ts`). For each file, in order:

1. `resolveBlockRefs` — `((uuid))` → `[[Page#^shortid]]`, `{{embed ((uuid))}}` → `![[Page#^shortid]]`,
   `{{embed [[Page]]}}` → `![[Page]]`.
2. `removeOrphanBlockRefs` — *(option)* strip references whose uuid was never defined.
3. `rewriteAliasReferences` — `[[Alias]]` → `[[Canonical|Alias]]`.
4. `disambiguateBasenameLinks` — bare `[[name]]` → `[[full/path|name]]` when the basename is shared.
5. `convertTags` — keep / sanitize / link / drop tags (section H).
6. `linkifyTagValuesInFrontmatter` — apply the same tag-to-link policy to scalar frontmatter values.
7. ISO date-link reformat — `[[YYYY-MM-DD]]` → target Daily-Notes format if it differs.
8. `deOutline` — *(option)* flatten the outline for journals and/or pages.
9. **[A1] Empty-page check** — if the resulting body is blank and there is no YAML frontmatter, the page
   is skipped (reported via `ctx.reportSkipped`) rather than written as an empty file.
10. Write or replace the note (`yaml + body`). After all notes, copy planned assets.

---

## B. Options reference

All options live in `src/formats/logseq/options.ts` (`LogseqImportOptions`). Defaults below are
`DEFAULT_LOGSEQ_OPTIONS`. The settings UI (`logseq.ts`) groups them into the sections shown.

### Tasks

| Option | Type | Default | Effect |
|---|---|---|---|
| `taskFormat` | `'tasks-emoji' \| 'tasks-dataview' \| 'plain'` | `tasks-emoji` | How rich task metadata is serialized (section D). |

### Journals

| Option | Type | Default | Effect |
|---|---|---|---|
| `useDailyNotes` | boolean | `true` | Migrate journals into the Daily Notes folder using its date format. When on, the folder/format fields are filled from Daily Notes config and disabled. |
| `journalFolder` | string | from Daily Notes, else `Journals` | Vault folder (relative to output) for journals. |
| `journalDateFormat` | string | from Daily Notes, else `YYYY-MM-DD` | moment.js format for journal filenames. |
| `deOutlineJournals` | boolean | `false` | Flatten journal outlines to paragraphs/headings (section C). |

### Pages

| Option | Type | Default | Effect |
|---|---|---|---|
| `pagesFolder` | string | `''` | Vault folder (relative to output) for pages. Empty = output root. |
| `deOutlinePages` | boolean | `false` | Flatten page outlines to paragraphs/headings (section C). |

### Links & tags

| Option | Type | Default | Effect |
|---|---|---|---|
| `convertTagsToLinks` | boolean | `false` | Turn `#tags` into `[[wikilinks]]` instead of keeping them as tags. |
| `convertTagsOnlyExistingPages` | boolean | `true` | When converting, only link tags that have a matching page; others stay `#tags`. |
| `dropTags` | string[] | `['card']` | Tags removed entirely from body **and** frontmatter. |

### Logseq-only content

| Option | Type | Default | Effect |
|---|---|---|---|
| `queries` | `'keep' \| 'drop'` | `keep` | Simple `{{query}}` macros. Org `#+BEGIN_QUERY` blocks are always converted to fenced `query` blocks earlier in pass 1 (section L). |
| `flashcards` | `'keep' \| 'drop'` | `keep` | `#card` markers and `{{cloze}}` wrappers; `#card` is subsequently subject to `dropTags` (section L). |
| `logbook` | `'keep' \| 'drop'` | `drop` | `:LOGBOOK:` / `CLOCK:` time-tracking drawers on any block. |

### Assets

| Option | Type | Default | Effect |
|---|---|---|---|
| `keepAssetAltText` | boolean | `false` | Preserve image alt text as the embed display text (`![[x\|alt]]`). |

### Block references

| Option | Type | Default | Effect |
|---|---|---|---|
| `shortenBlockIds` | boolean | `true` | Shorten Logseq UUID block IDs to short Obsidian-style anchors. |
| `removeOrphanBlockRefs` | boolean | `false` | Remove `((uuid))` references that could not be resolved to a known block. |
| `alwaysEmbedBlockRefs` | boolean | `false` | Convert bare `((uuid))` block references to embeds (`![[…]]`) instead of plain links (`[[…]]`). |

### Properties

| Option | Type | Default | Effect |
|---|---|---|---|
| `dropPageProperties` | string[] | `['public', 'exclude-from-graph-view', 'icon']` | Page-level property keys excluded from frontmatter. `icon` is dropped by default because it carries a Logseq private-use glyph that renders as a tofu box (□) in Obsidian. |
| `dropBlockProperties` | string[] | `[]` | **Additional** inline block-property keys to strip (beyond the always-dropped set). |
| `blockProperties` | `keep` \| `wrap` \| `drop` | `wrap` | How retained (unknown) inline block properties are emitted. `keep` leaves the raw `key:: value` line; `wrap` rewrites it to a Dataview inline field `[key:: value]` (label hidden in reading view, value stays queryable); `drop` removes the line. The always-dropped set and `dropBlockProperties` keys win in every mode. |
| `snakeCasePageProperties` | boolean | `false` | Convert kebab-case page-property keys to snake_case (e.g. `test-hyphen` → `test_hyphen`). Drop-list matching (`dropPageProperties`) still uses the original kebab-case key. Hyphenated keys can break or complicate Bases/Dataview query syntax (`note["test-hyphen"]` vs. `test_underscore`). |
| `snakeCaseBlockProperties` | boolean | `false` | Same as `snakeCasePageProperties`, but for retained inline block-property keys (applies in both `keep` and `wrap` modes). |

### Cleanup

| Option | Type | Default | Effect |
|---|---|---|---|
| `normalizeWhitespace` | boolean | `true` | **[B1]** Trim trailing whitespace, remove lone empty bullets (`- `), and convert non-breaking spaces (U+00A0) to regular spaces. Fenced code blocks (both standard ` ``` ` and bullet-prefixed `- ``` ` fences) and intentional blank lines are left untouched; empty bullets that carry a `^anchor` are kept. This runs before Logseq-only drop operations and pass 2, not as a final cleanup pass. |

---

## C. Document structure & de-outlining

Logseq treats every document as an outline of nested `- ` bullets; indentation *is* the structure.
Obsidian uses flat markdown.

**Preserve (default).** Every block stays a `- ` bullet at its original indentation — lossless.
The only structural touch-up is `fixHeadingChildLists` (a heading directly above an indented list
gets a `- ` prefix so Obsidian renders the children correctly).

**De-outline (opt-in, per kind).** Controlled by two independent toggles — `deOutlineJournals` and
`deOutlinePages` — so you can flatten one kind and keep the other as an outline (there is no
dynamic UI; both are always-visible switches). `deOutline` (`de-outline.ts`) parses the bullet tree
and re-serializes it as idiomatic markdown using these heuristics:

- **[C1]** A bullet whose content is a **heading** (`# …`) de-nests to a real heading; its children become
  the body under it. Multiline heading continuations get a blank line separator, **except**
  when the only continuation is a `^anchor` — in that case the anchor lands directly on the next
  line with no gap (required for Obsidian block-reference resolution).
- **[C1]** A subtree that is a **genuine list** (2+ siblings where all are list-compatible — leaves, tasks,
  or recursively list-compatible nodes with their own children — but **not headings**) stays a
  list, re-indented from depth 0. Headings are never list-compatible and always promoted to real
  headings, even when siblings of list items.
- **[C1]** A **single-child chain** of prose collapses into one paragraph (avoids one-item lists), provided
  the descendants remain a simple non-heading, non-task chain without branching.
- **[C1]** Other prose bullets become paragraphs separated by blank lines.
- **[C1]** **Tasks** always remain list items; consecutive tasks are grouped into a compact list.
- **[C1]** **Code blocks** with a trailing `^anchor` on the closing fence are recognized as terminated.
- **[C1]** **Tab-aware de-indent:** continuation lines are stripped of their actual whitespace prefix
  (not a fixed character count), so tabs and spaces are both handled correctly.

De-outline runs **last** in pass 2, after all other conversions, so tasks/properties/links are
already in their final form. It is heuristic and may restructure incidental nesting — which is why
Preserve is the default.

---

## D. Tasks

Logseq tasks are bullets whose text starts with a workflow keyword. Recognized keywords:
`TODO, DOING, DONE, LATER, NOW, WAITING, WAIT, IN-PROGRESS, CANCELLED, CANCELED`.

A colon may follow the keyword (`- TODO: do the thing`); **[D1]** it is recognized as a task and the colon is
dropped from the emitted text.

**[D1]** The task line plus its indented continuation lines (`SCHEDULED:`, `DEADLINE:`, `:LOGBOOK:`, and
`created/completed/done/cancelled` properties) are parsed as one unit and re-emitted. A Logseq
set-literal date value (`completed:: #{"Mar 3rd, 2025"}`) is unwrapped to its quoted date; a
malformed set literal emits no completion date.

### Checkbox state mapping

| Logseq state | `plain` | `tasks-emoji` / `tasks-dataview` |
|---|---|---|
| `TODO` / `LATER` / `WAITING` / `WAIT` / `IN-PROGRESS` | `[ ]` | `[ ]` |
| `DOING` / `NOW` | `[ ]` | `[/]` |
| `DONE` | `[x]` | `[x]` |
| `CANCELLED` / `CANCELED` | `[x]` | `[-]` |

### Metadata mapping

| Logseq | `tasks-emoji` | `tasks-dataview` | `plain` |
|---|---|---|---|
| priority `[#A]` / `[#B]` / `[#C]` | `⏫` / `🔼` / `🔽` | `[priority:: high\|medium\|low]` | left in text |
| `SCHEDULED: <date>` | `⏳ date` | `[scheduled:: date]` | dropped from metadata |
| `DEADLINE: <date>` | `📅 date` | `[due:: date]` | dropped from metadata |
| repeater (`.+1w` / `++2d`) | `🔁 every N unit [when done]` | `[repeat:: <raw>]` | — |
| `created::` | `➕ date` | `[created:: date]` | — |
| `completed::` / `done::` | `✅ date` | `[completion:: date]` | — |
| `cancelled::` / `canceled::` | `❌ date` | `[cancelled:: date]` | — |
| `:LOGBOOK:` … `:END:` | see `logbook` option | see `logbook` option | see `logbook` option |

Notes:
- In **plain** format, priority and scheduling are not extracted into metadata — continuation lines
  are kept as-is, so no information is destroyed (it just stays inline).
- The **repeater** emoji form distinguishes `.+`/`++` (→ "when done") from `+` (fixed).
- **[D1]** Task metadata dates normalize ISO and Logseq long-date values to `YYYY-MM-DD`; unparsable values
  such as template tokens are consumed but not emitted in the rich task formats. Plain mode keeps
  those continuation lines verbatim.
- **[D1]** **LOGBOOK** has no Obsidian target; with `logbook: 'drop'` (default) it is removed cleanly,
  with `logbook: 'keep'` the `:LOGBOOK:`/`CLOCK:` lines are preserved verbatim. The drop pass applies
  to drawers on non-task blocks as well as tasks.

---

## E. Journals & dates

Journals have two distinct source patterns:

- **Source filename** — `journals/2024_08_30.md` style. `journalFilenameToISO` parses the built-in
  `YYYY[_-]M[_-]D` pattern to ISO `YYYY-MM-DD`. Other source filename formats are not read from
  `logseq/config.edn`; an unrecognized journal basename is retained.
- **Source date links** — `[[Aug 30th, 2024]]` style. `convertJournalDateLinks` parses the
  English-month `MMM do, yyyy` family to `[[2024-08-30]]`. Custom source page-title formats are not
  read from `config.edn`.

**Target.** The journal filename is produced from the ISO date via moment using
`journalDateFormat`. When `useDailyNotes` is on, the folder and format come from the **Daily Notes**
core plugin (`app.internalPlugins.getPluginById('daily-notes')`), falling back to `Journals` /
`YYYY-MM-DD` in the settings UI. When off, the user's `journalFolder` / `journalDateFormat` are
used. Periodic Notes settings are not read.

**[E1]** If the target format differs from ISO, pass 2 reformats every in-content
`[[YYYY-MM-DD]]` link, including links with a `#^anchor`, so links keep matching the filenames.

---

## F. Pages, namespaces & output paths

- **[F1]** **Pages** are placed under `pagesFolder` (or the output root if empty). A namespaced Logseq page
  filename is converted to a folder path: `namespaceToPath` splits on `%2F` if present, otherwise
  on the `___` separator, percent-decodes each segment (`decodeLogseqName`, tolerant of malformed
  escapes), and joins with `/`. So `a___b.md` → `a/b.md` and `Encoded%3AColon.md` → `Encoded:Colon.md`.
- **Journals** are placed under `journalFolder` with the date-formatted filename.
- All names are run through `sanitizeFileNameKeepPath` to remove OS-illegal characters while
  keeping the folder hierarchy.
- The **canonical name** (the namespace/date path without `.md`) is what block references and
  wikilinks target.
- The scan is recursive, but output planning uses each source file's basename; physical
  subdirectories under `pages/` or `journals/` are not preserved unless encoded in the basename.
- The importer does not scan the graph-level `whiteboards/` directory. A Markdown path containing
  `whiteboards/` below a scanned note directory is reported as unsupported and skipped.
---

## G. Links, references & embeds

| Logseq | Obsidian | When |
|---|---|---|
| `[[Page]]` | `[[Page]]` (namespace text matches output path) | always |
| `[display]([[Page]])` | `[[Page\|display]]` | **[G1]** pass 1, skips code fences; strips any pre-existing pipe in target |
| `[[Alias]]` (reference *by alias*) | `[[Canonical\|Alias]]` | pass 2 |
| `id:: <uuid>` block property | `^shortid` appended to the block line | pass 1 |
| `((uuid))` | `[[Page#^shortid]]` | pass 2, if resolved |
| `{{embed ((uuid))}}` | `![[Page#^shortid]]` | pass 2, if resolved |
| `{{embed [[Page]]}}` | `![[Page]]` | pass 2 |

**[G1] Aliases are not interchangeable between the two apps.** Logseq resolves `[[Some Alias]]` to the
canonical page anywhere; Obsidian links must target the canonical note name. So the importer builds
an **alias → canonical** map from every page's `alias::`/`aliases::` property (and `title::`) and
rewrites any reference that targets an alias into `[[Canonical|Alias]]` (keeping the alias as
display text). **Self-aliases** (where the alias matches the canonical page name) are skipped to
avoid redundant `[[Name|Name]]` rewrites. Alias rewriting also skips inline-code spans.
The alias values still go into the note's `aliases:` frontmatter so Obsidian autocomplete works.
**Ambiguous aliases** (the same alias claimed by multiple pages) are dropped from the map and left
unrewritten. If a page defines both `alias::` and `aliases::`, both contribute to frontmatter, but
`alias::` takes precedence when building the cross-file rewrite index.

**[G1] Block IDs.** Logseq UUIDs (e.g. `64ab9aa4-459a-41b1-8c21-dbb38dc0c79b`) are shortened to a stable
6-char anchor (`^64ab9a`) when `shortenBlockIds` is on (default), or kept full when off. Short-id
collisions **within one note** are disambiguated by appending `-1`, `-2`, … The same mapping is
used to rewrite every `((uuid))` reference, so anchors and links stay consistent. Anchor placement
is context-aware:

- On a closing code fence (`` ``` ``): the anchor goes on a **new line after** the fence (appending
  to the fence would break CommonMark).
- On a **bullet-heading** line (`- ## Title`): the anchor goes on the **next line, indented** to
  content level (so it stays part of the block in outline mode). When the heading is later
  de-outlined to `## Title`, the anchor appears directly below with no blank-line gap — enabling
  both `[[Page#^anchor]]` and `[[Page#Title]]` reference styles.
- On a plain heading line (`## Title`, rare outside de-outline): the anchor goes on the next line
  with no blank-line gap, for the same reason.
- After retained block properties: the anchor lands on the **last non-blank line** (including kept
  property lines), not the content line before them.

If the same full UUID is defined in more than one file, the later pass-1 definition replaces the
earlier entry in the graph-wide index.

**[G1] Block references inside code blocks.** `resolveBlockRefs` converts `((uuid))` and
`{{embed ((uuid))}}` references **everywhere**, including inside fenced code blocks. The guard is
that the UUID must exist in the block index — unrecognised UUIDs are left as-is. This means
copy-pasteable code examples that include Logseq embed syntax are updated to the equivalent Obsidian
form. Inline-code spans (single backticks) are still protected and never rewritten.

**[G1] Always-embed option (`alwaysEmbedBlockRefs`).** By default, bare `((uuid))` references become
plain links `[[Page#^id]]`. With `alwaysEmbedBlockRefs: true`, they become embeds `![[Page#^id]]`
instead — useful because Obsidian displays embeds inline while plain links just show the anchor
text. Block embeds (`{{embed ((uuid))}}`) always produce `![[...]]` regardless of this option.

**[G1] Orphan block references.** A `((uuid))` whose target was never defined in the graph is left
untouched by default (the raw text survives). With `removeOrphanBlockRefs` on, such unresolved
`((uuid))` references and `{{embed ((uuid))}}` embeds are removed cleanly (including lines that
become empty). This runs *after* `resolveBlockRefs`, so only genuine orphans remain to remove.

---

## H. Tags

Tag handling happens in pass 2 (`convertTags`), outside code fences. Two syntaxes are recognized:
`#simple-tag` and `#[[multi word tag]]`. Tags must follow the start of line, whitespace, or an
opening bracket/paren (`([`). For each tag, in order:

1. **[H1] Hex color?** Pure 6-digit hex tokens (`#FF0000`) are never treated as tags — left as-is.
2. **Drop?** If the tag (or its hyphenated form) is in `dropTags`, it is removed entirely.
   Default `dropTags` is `['card']`.
3. **Convert to link?** Only if `convertTagsToLinks` is on:
   - If `convertTagsOnlyExistingPages` is on (default), the tag becomes `[[tag]]` **only when a
     page with that name exists** in the graph; otherwise it stays a `#tag`. This is the "smart"
     conversion: real pages become links, ad-hoc tags stay tags. Matching is case-insensitive against
     the page's full canonical name; the bare basename of a namespaced page is not added separately.
   - If `convertTagsOnlyExistingPages` is off, every tag becomes `[[tag]]`.
4. **Keep as tag (default).** Multi-word `#[[multi word]]` is sanitized to `#multi-word`; simple
   tags are left as-is.

Tags listed in `dropTags` are also removed from frontmatter `tags:` (section I).

---

## I. Properties

### Page properties → frontmatter

**[I1]** The leading block of unindented `key:: value` lines becomes YAML frontmatter
(`extractPageProperties`):

- `alias` / `aliases` → an `aliases:` list (wikilink brackets stripped).
- `tags` → a `tags:` list (`#` and `[[…]]` stripped; comma- and space-separated values both
  handled; values in `dropTags` removed; if all are removed, no `tags:` key is emitted).
- `title` → registered as an additional alias (so the page is findable by title in Obsidian);
  removed from YAML as a standalone key. It does not replace the filename.
- Keys listed in `dropPageProperties` → dropped. Default: `public`, `exclude-from-graph-view`,
  `icon`. (`icon` carries a Logseq private-use glyph that renders as □ in Obsidian.)
- **Always dropped** (Logseq-internal, never meaningful in Obsidian — not user-overridable):
  `collapsed`, `filters`, `background-color`, `heading`, `template`, `template-including-parent`,
  plus **any key starting with `logseq.`**, **`query-`**, **`hl-`**, or **`ls-`**.
  These keys cannot be un-dropped via `dropPageProperties`.
- **[I1]** **Tag-style values → links (pass-2):** a scalar value that is a single tag (`status:: #IN-PROGRESS`,
  `area:: #[[Page One]]`) is emitted as quoted text (`status: "#IN-PROGRESS"`) by default. When tag
  conversion is enabled (`convertTagsToLinks`), the value is linkified to a wikilink
  (`status: "[[IN-PROGRESS]]"`) using the vault-wide page set, respecting
  `convertTagsOnlyExistingPages`. With tag conversion off (the default) these values stay quoted text,
  so default output is unchanged. `tags:` / `aliases:` lists are never affected.
- **[I1]** **YAML quoting:** values that are YAML-unsafe (contain `: `, `#`, start with `[`, `{`, are
  boolean words, integers, floats, or reserved YAML tokens) are double-quoted. Wikilink-valued
  scalars are also quoted (`project: "[[Big Project]]"`); multiple wikilink values become a quoted
  list.
- **[I1]** **Date extraction:** `created` and `updated` values containing a plain
  `[[YYYY-MM-DD]]` are unwrapped and emitted as bare ISO dates. Other property keys and date
  formats follow the normal scalar/list rules.
- **[I1]** **List splitting:** comma-separated values are split with wikilink-bracket awareness so
  `[[a, b]]` is not split mid-link.
- **[I1]** **Duplicate keys:** when the same key appears multiple times, last value wins; insertion order
  of first occurrence is preserved in the YAML output.
- **[I1]** Empty-valued properties (key with no value) are silently dropped.

If a file starts with a `- ` bullet, it has no page-property block.

### Block properties → cleaned from body

**[I1]** Indented `key:: value` continuation lines are stripped by `removeLeftoverBlockProperties` (after
`heading::`, `id::`, and `logseq.order-list-type::` have been handled by their own converters).
Both standard indented form (`  key:: value`) and bullet form (`- key:: value`) are recognized.

**Always dropped** (Logseq-internal, never meaningful in Obsidian — not user-overridable):
`alias`, `aliases`, `collapsed`, `background-color`, `heading`, `filters`, `public`,
`exclude-from-graph-view`, `template`, `template-including-parent`,
`query-table`, `query-properties`, `query-sort-by`, `query-sort-desc`, `query-flag`, plus **any key
starting with `logseq.`**, **`query-`**, **`hl-`**, or **`ls-`** (highlight/annotation-related).

(`alias`/`aliases` are always dropped from blocks because they are only meaningful as page-level
properties, where they are already handled by the frontmatter converter.)

**Additionally dropped:** any key the user lists in `dropBlockProperties` (default empty).

**[I1] Retained (unknown) block properties** (e.g. `rating:: 5`, `participants:: [[Alice]], [[Bob]]`) are
handled by the `blockProperties` option:

- `keep` — the raw `key:: value` line is left as-is.
- `wrap` (default) — rewritten to a Dataview inline field `[key:: value]`, preserving leading
  indentation and any trailing `^anchor` (which stays outside the brackets). The label is hidden in
  reading view while the value stays queryable. Values containing a stray `]`/`[` (outside a
  `[[wikilink]]`) fall back to `keep` so the inline-field syntax isn't broken; property-like lines
  inside standard fenced code blocks are never touched.
- `drop` — the line is removed entirely.

The always-dropped set and `dropBlockProperties` keys win in every mode.

### Special property conversions

| Logseq | Obsidian |
|---|---|
| `heading:: N` (1–6) | `#`×N prefix on the owning bullet; the property line is dropped |
| `heading:: true` (auto) | property line dropped, no prefix |
| `logseq.order-list-type:: number` | bullet becomes `1.`, `2.`, … (counter per indent level) |
| `id:: <uuid>` | `^shortid` anchor (section G) |

---

## J. Inline syntax & blocks

| Logseq | Obsidian | Notes |
|---|---|---|
| `^^highlight^^` | `==highlight==` | **[J1]** skips fenced **and** inline code |
| `#+BEGIN_QUOTE` … `#+END_QUOTE` | `> ` blockquote | **[J1]** |
| `- #+BEGIN_QUOTE` (bullet-prefixed) | `- > text` blockquote under bullet | **[J1]** preserves list structure |
| `#+BEGIN_NOTE/TIP/WARNING/IMPORTANT/CAUTION/EXAMPLE` | `> [!type]` callout | **[J1]** first `**bold**` line becomes the callout title |
| `- #+BEGIN_TIP` (bullet-prefixed) | `- > [!tip]` callout under bullet | **[J1]** |
| `#+BEGIN_COMMENT` | `%% … %%` | |
| `#+BEGIN_QUERY` … `#+END_QUERY` | `` ```query `` … `` ``` `` | **[J1]** preserves query DSL in a fenced block; this happens before the `queries` keep/drop option |
| other `#+BEGIN_*` (CENTER/VERSE/PINNED/…) | `> [!note]` fallback | nesting supported |
| `#+BEGIN_*` inside a fenced code block | left unchanged | **[J1]** fence-aware: org markers in code are inert |
| numbered list (bullet + `logseq.order-list-type:: number`) | `1.` `2.` `3.` | **[J1]** counter resets on level change / non-numbered sibling |
| code fences in bullets | code fence with aligned closing fence | **[J1]** `fixCodeBlocksInLists` (tab-safe indent) |
| heading followed by indented list | `- # Heading` + list | `fixHeadingChildLists` |
| `$inline$` / `$$block$$` math | unchanged | both apps use MathJax |

---

## K. Media & assets

| Logseq | Obsidian | Notes |
|---|---|---|
| `![alt](../assets/x.png)` | `![[x.png]]` | **[K1]** bytes copied to `<output>/assets/` |
| `[label](../assets/x.pdf)` | `[[x.pdf]]` | **[K1]** plain (non-embed) asset links also converted |
| `[label [nested] label](../assets/x.pdf)` | `[[x.pdf]]` | **[K1]** label allows one level of nested brackets |
| `![alt](../assets/x.png){:height H, :width W}` | `![[x.png\|WxH]]` | dimensions always win over alt text |
| `![alt](../assets/x.png)` with `keepAssetAltText` | `![[x.png\|alt]]` | only when no dimensions and alt is non-empty |
| `![](../assets/Book_(2024).pdf)` | `![[Book_(2024).pdf]]` | **[K1]** paren-balanced path matching |
| `{{video URL}}` / `{{youtube URL}}` | `![](URL)` | |
| `{{tweet URL}}` | `![](URL)` | |

**[K1]** Only links whose path contains `assets/` are treated as local assets; URLs (`http:`, `https:`,
`data:`) and other paths are left alone. Asset links inside fenced code blocks **and inline code
spans** are not converted. The byte copy resolves the source relative to the note's directory
(tolerant of `../` prefixes) and flattens assets into `<output>/assets/`. If that destination
filename already exists—whether from the vault or an earlier planned asset—it is retained and the
later asset is not copied. Asset basename collisions are therefore not renamed or reported. If a
rewritten source path cannot be resolved on disk, no asset is planned and the rewritten link remains
without a corresponding copy.

---

## L. Logseq-only content

The importer exposes independent controls for simple queries, flashcard syntax, and LOGBOOK
drawers. Their exact behavior reflects pipeline ordering and the separate tag controls:

| Feature | Syntax | Option | Default | If kept | If dropped |
|---|---|---|---|---|---|
| Simple queries | `{{query …}}` | `queries` | `keep` | left verbatim and a report entry is added | matching macro removed |
| Advanced queries | `#+BEGIN_QUERY … #+END_QUERY` | none after normalization | retained | converted to a fenced `query` block | same as keep; conversion happens before `applyLogseqOnly` sees it |
| Flashcards | `#card`, `{{cloze …}}` | `flashcards` | `keep` | cloze wrapper retained and a report entry is added; `#card` continues through tag handling | `{{cloze X}}` → `X`, `#card` removed |
| Time tracking | `:LOGBOOK:` / `CLOCK:` drawers | `logbook` | `drop` | drawer lines kept | drawer lines removed |

Because only Markdown under `pages/` and `journals/` is scanned, graph-level whiteboard `.edn`
files are outside the import rather than individually reported.

`dropTags` is applied after the flashcard keep/drop pass. With the defaults, `card` is in
`dropTags`, so choosing `flashcards: 'keep'` preserves `{{cloze}}` wrappers but still removes
`#card`. Remove `card` from `dropTags` to preserve the marker too.

**Template-field macros are out of scope.** Dynamic template placeholders such as `{{date:…}}`,
`{{sunday:…}}`, `{{monday:…}}` and similar are left as literal text; converting them to Obsidian
Templater/QuickAdd syntax is not attempted.

---

## M. Name collisions & disambiguation

Because namespaces become folders, two notes in different folders can share a basename
(e.g. `projects/notes` and `personal/notes`). This is **valid in Obsidian** — a note's canonical
identity is its full vault path, and a link can carry the full path while displaying only the
basename: `[[personal/notes|notes]]`.

The importer handles this natively, with no flattening:

- **Output-path collisions** (two sources mapping to the *exact same* path) are detected during
  planning. The first writer wins; later colliders are reported and skipped — no silent overwrite.
- A note that already exists in the vault at a planned output path is replaced via
  `vault.modify`; collision detection only covers sources within the current import plan.
- **[M1] Ambiguous bare links.** A `basename → [paths]` index is built from all plans. In pass 2,
  `disambiguateBasenameLinks` rewrites any bare `[[name]]` whose basename maps to 2+ notes into
  `[[full/path|name]]` (using the first path as canonical, and preserving any explicit display
  text). If one of the paths is an **exact top-level match** (no namespace / folder), the link is
  left as-is — it already resolves unambiguously in Obsidian's shortest-path resolution. Links that
  already contain a `/` (namespace-style) or a `#` (block/heading ref) are also left untouched.

This uses Obsidian's full-path link syntax so same-named notes can remain in their namespaces
without global renaming.
