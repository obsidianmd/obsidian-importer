# Logseq Importer: Transformation Reference

This document is the authoritative, up-to-date reference for **every transformation the Logseq
importer performs** and **every option that controls it**. It reflects the actual implementation
under `src/formats/logseq/`, including all adjustments made after the original
[assessment](./logseq-importer-assessment.md) (which remains the design-rationale and roadmap
document).

Guiding principle throughout: **never silently delete content.** Anything that cannot be faithfully
converted is either preserved verbatim or skipped with an explicit `ctx.reportSkipped` /
`reportFailed` entry, so the user always knows.

## Contents

1. [Pipeline overview](#1-pipeline-overview)
2. [Options reference](#2-options-reference)
3. [Document structure & de-outlining](#3-document-structure--de-outlining)
4. [Tasks](#4-tasks)
5. [Journals & dates](#5-journals--dates)
6. [Pages, namespaces & output paths](#6-pages-namespaces--output-paths)
7. [Links, references & embeds](#7-links-references--embeds)
8. [Tags](#8-tags)
9. [Properties](#9-properties)
10. [Inline syntax & blocks](#10-inline-syntax--blocks)
11. [Media & assets](#11-media--assets)
12. [Logseq-only content](#12-logseq-only-content)
13. [Name collisions & disambiguation](#13-name-collisions--disambiguation)

---

## 1. Pipeline overview

The import runs in **two passes** so that cross-file references can be resolved against a
vault-wide index that only exists once every file has been planned and locally converted.

**Planning.** Files under `pages/` and `journals/` are enumerated. Each is assigned a canonical
name and an output path (section 6). Output-path collisions are detected here: the first writer
wins; later colliders are reported via `ctx.reportSkipped` and skipped. From the plans we build:

- a **basename disambiguation index** (`basename → [full path, …]`, section 13),
- a **known-pages set** (`canonicalName` lower-cased, used for page-aware tag conversion).

**Pass 1 — per-file local conversion** (`convertLocal` in `pipeline.ts`). Everything that can be
done on a single file without the vault index. In order:

1. `extractPageProperties` — leading `key:: value` block → YAML frontmatter (section 9).
2. `convertHeadingProperty` — `heading:: N` → `#`×N prefix on the block.
3. `convertTasks` — task keywords + metadata → chosen task format (section 4).
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
14. `removeLeftoverBlockProperties` — strip remaining internal/user-listed block properties.

While iterating, pass 1 also builds the **block-id index** (`uuid → {page, shortId}`), the
**alias index** (`alias → canonical page`, ambiguous aliases removed afterward), and the
**asset plan** (absolute source → filename). Logseq-only content (queries, flashcards) is applied
here too (`applyLogseqOnly`).

> Tag conversion is **deliberately deferred to pass 2** because the `onlyExistingPages` option
> needs the complete known-pages set, which is only available after planning.

**Pass 2 — cross-file resolution + write** (in `logseq.ts`). For each file, in order:

1. `resolveBlockRefs` — `((uuid))` → `[[Page#^shortid]]`, `{{embed ((uuid))}}` → `![[Page#^shortid]]`,
   `{{embed [[Page]]}}` → `![[Page]]`.
2. `removeOrphanBlockRefs` — *(option)* strip references whose uuid was never defined.
3. `rewriteAliasReferences` — `[[Alias]]` → `[[Canonical|Alias]]`.
4. `disambiguateBasenameLinks` — bare `[[name]]` → `[[full/path|name]]` when the basename is shared.
5. `convertTags` — keep / sanitize / link / drop tags (section 8).
6. ISO date-link reformat — `[[YYYY-MM-DD]]` → target Daily-Notes format if it differs.
7. `deOutline` — *(option)* flatten the outline for journals and/or pages.
8. Write the note (`yaml + body`), then copy assets.

---

## 2. Options reference

All options live in `src/formats/logseq/options.ts` (`LogseqImportOptions`). Defaults below are
`DEFAULT_LOGSEQ_OPTIONS`. The settings UI (`logseq.ts`) groups them into the sections shown.

### Tasks

| Option | Type | Default | Effect |
|---|---|---|---|
| `taskFormat` | `'tasks-emoji' \| 'tasks-dataview' \| 'plain'` | `tasks-emoji` | How rich task metadata is serialized (section 4). |

### Journals

| Option | Type | Default | Effect |
|---|---|---|---|
| `useDailyNotes` | boolean | `true` | Migrate journals into the Daily Notes folder using its date format. When on, the folder/format fields are filled from Daily Notes config and disabled. |
| `journalFolder` | string | from Daily Notes, else `Journals` | Vault folder (relative to output) for journals. |
| `journalDateFormat` | string | from Daily Notes, else `YYYY-MM-DD` | moment.js format for journal filenames. |
| `deOutlineJournals` | boolean | `false` | Flatten journal outlines to paragraphs/headings (section 3). |

### Pages

| Option | Type | Default | Effect |
|---|---|---|---|
| `pagesFolder` | string | `''` | Vault folder (relative to output) for pages. Empty = output root. |
| `deOutlinePages` | boolean | `false` | Flatten page outlines to paragraphs/headings (section 3). |

### Links & tags

| Option | Type | Default | Effect |
|---|---|---|---|
| `convertTagsToLinks` | boolean | `false` | Turn `#tags` into `[[wikilinks]]` instead of keeping them as tags. |
| `convertTagsOnlyExistingPages` | boolean | `true` | When converting, only link tags that have a matching page; others stay `#tags`. |
| `dropTags` | string[] | `['card']` | Tags removed entirely from body **and** frontmatter. |

### Logseq-only content

| Option | Type | Default | Effect |
|---|---|---|---|
| `queries` | `'keep' \| 'drop'` | `keep` | `{{query}}` / `#+BEGIN_QUERY` blocks (section 12). |
| `flashcards` | `'keep' \| 'drop'` | `keep` | `#card` markers and `{{cloze}}` wrappers (section 12). |
| `logbook` | `'keep' \| 'drop'` | `drop` | `:LOGBOOK:` / `CLOCK:` time-tracking blocks on tasks. |

### Assets

| Option | Type | Default | Effect |
|---|---|---|---|
| `keepAssetAltText` | boolean | `false` | Preserve image alt text as the embed display text (`![[x\|alt]]`). |

### Block references

| Option | Type | Default | Effect |
|---|---|---|---|
| `shortenBlockIds` | boolean | `true` | Shorten Logseq UUID block IDs to short Obsidian-style anchors. |
| `removeOrphanBlockRefs` | boolean | `false` | Remove `((uuid))` references that could not be resolved to a known block. |

### Properties

| Option | Type | Default | Effect |
|---|---|---|---|
| `dropPageProperties` | string[] | `['public', 'exclude-from-graph-view']` | Page-level property keys excluded from frontmatter. |
| `dropBlockProperties` | string[] | `[]` | **Additional** inline block-property keys to strip (beyond the always-dropped set). |

---

## 3. Document structure & de-outlining

Logseq treats every document as an outline of nested `- ` bullets; indentation *is* the structure.
Obsidian uses flat markdown.

**Preserve (default).** Every block stays a `- ` bullet at its original indentation — lossless.
The only structural touch-up is `fixHeadingChildLists` (a heading directly above an indented list
gets a `- ` prefix so Obsidian renders the children correctly).

**De-outline (opt-in, per kind).** Controlled by two independent toggles — `deOutlineJournals` and
`deOutlinePages` — so you can flatten one kind and keep the other as an outline (there is no
dynamic UI; both are always-visible switches). `deOutline` (`de-outline.ts`) parses the bullet tree
and re-serializes it as idiomatic markdown using these heuristics:

- A bullet whose content is a **heading** (`# …`) de-nests to a real heading; its children become
  the body under it. Multiline heading continuations get a blank line separator (F6).
- A subtree that is a **genuine list** (2+ siblings where all are list-compatible — leaves, tasks,
  or recursively list-compatible nodes with their own children) stays a list, re-indented from
  depth 0.
- A **single-child chain** of prose collapses into one paragraph (avoids one-item lists), provided
  the leaf has no children of its own.
- Other prose bullets become paragraphs separated by blank lines.
- **Tasks** always remain list items; consecutive tasks are grouped into a compact list.
- **Code blocks** with a trailing `^anchor` on the closing fence are recognized as terminated (F1).
- **Tab-aware de-indent** (F2): continuation lines are stripped of their actual whitespace prefix
  (not a fixed character count), so tabs and spaces are both handled correctly.

De-outline runs **last** in pass 2, after all other conversions, so tasks/properties/links are
already in their final form. It is heuristic and may restructure incidental nesting — which is why
Preserve is the default.

---

## 4. Tasks

Logseq tasks are bullets whose text starts with a workflow keyword. Recognized keywords:
`TODO, DOING, DONE, LATER, NOW, WAITING, WAIT, IN-PROGRESS, CANCELLED, CANCELED`.

The task line plus its indented continuation lines (`SCHEDULED:`, `DEADLINE:`, `:LOGBOOK:`, and
`created/completed/done/cancelled` properties) are parsed as one unit and re-emitted.

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
| `:LOGBOOK:` … `:END:` | see `logbook` option | see `logbook` option | preserved as continuation |

Notes:
- In **plain** format, priority and scheduling are not extracted into metadata — continuation lines
  are kept as-is, so no information is destroyed (it just stays inline).
- The **repeater** emoji form distinguishes `.+`/`++` (→ "when done") from `+` (fixed).
- **LOGBOOK** has no Obsidian target; with `logbook: 'drop'` (default) it is removed cleanly,
  with `logbook: 'keep'` the `:LOGBOOK:`/`CLOCK:` lines are preserved verbatim.

---

## 5. Journals & dates

Journals have two distinct format ends, neither hard-coded:

- **Source filename** — `journals/2024_08_30.md` style. `journalFilenameToISO` parses
  `YYYY[_-]M[_-]D` to ISO `YYYY-MM-DD`.
- **Source date links** — `[[Aug 30th, 2024]]` style. `convertJournalDateLinks` parses the
  `MMM do, yyyy` family to `[[2024-08-30]]`.

**Target.** The journal filename is produced from the ISO date via moment using
`journalDateFormat`. When `useDailyNotes` is on, the folder and format come from the **Daily Notes**
core plugin (`app.internalPlugins.getPluginById('daily-notes')`), falling back to `Journals` /
`YYYY-MM-DD`. When off, the user's `journalFolder` / `journalDateFormat` are used.

If the target format differs from ISO, pass 2 reformats every in-content `[[YYYY-MM-DD]]` link to
the target format so links keep matching the filenames.

---

## 6. Pages, namespaces & output paths

- **Pages** are placed under `pagesFolder` (or the output root if empty). A namespaced Logseq page
  filename is converted to a folder path: `namespaceToPath` splits on `%2F` if present, otherwise
  on the `___` separator, percent-decodes each segment (`decodeLogseqName`, tolerant of malformed
  escapes), and joins with `/`. So `a___b.md` → `a/b.md` and `Encoded%3AColon.md` → `Encoded:Colon.md`.
- **Journals** are placed under `journalFolder` with the date-formatted filename.
- All names are run through `sanitizeFileNameKeepPath` to remove OS-illegal characters while
  keeping the folder hierarchy.
- The **canonical name** (the namespace/date path without `.md`) is what block references and
  wikilinks target.
- `whiteboards/` files are reported as unsupported and skipped. The scan only includes `pages/`
  and `journals/`.

---

## 7. Links, references & embeds

| Logseq | Obsidian | When |
|---|---|---|
| `[[Page]]` | `[[Page]]` (namespace text matches output path) | always |
| `[display]([[Page]])` | `[[Page\|display]]` | pass 1, skips code fences; strips any pre-existing pipe in target (L2) |
| `[[Alias]]` (reference *by alias*) | `[[Canonical\|Alias]]` | pass 2 |
| `id:: <uuid>` block property | `^shortid` appended to the block line | pass 1 |
| `((uuid))` | `[[Page#^shortid]]` | pass 2, if resolved |
| `{{embed ((uuid))}}` | `![[Page#^shortid]]` | pass 2, if resolved |
| `{{embed [[Page]]}}` | `![[Page]]` | pass 2 |

**Aliases are not interchangeable between the two apps.** Logseq resolves `[[Some Alias]]` to the
canonical page anywhere; Obsidian links must target the canonical note name. So the importer builds
an **alias → canonical** map from every page's `alias::`/`aliases::` property (and `title::`) and
rewrites any reference that targets an alias into `[[Canonical|Alias]]` (keeping the alias as
display text). **Self-aliases** (where the alias matches the canonical page name) are skipped to
avoid redundant `[[Name|Name]]` rewrites. Alias rewriting also skips inline-code spans.
The alias values still go into the note's `aliases:` frontmatter so Obsidian autocomplete works.
**Ambiguous aliases** (the same alias claimed by multiple pages) are dropped from the map and left
unrewritten.

**Block IDs.** Logseq UUIDs (e.g. `64ab9aa4-459a-41b1-8c21-dbb38dc0c79b`) are shortened to a stable
6-char anchor (`^64ab9a`) when `shortenBlockIds` is on (default), or kept full when off. Short-id
collisions **within one note** are disambiguated by appending `-1`, `-2`, … The same mapping is
used to rewrite every `((uuid))` reference, so anchors and links stay consistent. Anchor placement
is context-aware:

- On a closing code fence (`` ``` ``): the anchor goes on a **new line after** the fence (appending
  to the fence would break CommonMark).
- On a heading line: the anchor goes on its own line **below** the heading (Obsidian renders anchors
  on heading lines as literal text).
- After retained block properties: the anchor lands on the **last non-blank line** (including kept
  property lines), not the content line before them.

**Orphan block references.** A `((uuid))` whose target was never defined in the graph is left
untouched by default (the raw text survives). With `removeOrphanBlockRefs` on, such unresolved
`((uuid))` references and `{{embed ((uuid))}}` embeds are removed cleanly (including lines that
become empty). This runs *after* `resolveBlockRefs`, so only genuine orphans remain to remove.

**Code protection.** Block reference resolution (`resolveBlockRefs`) skips both fenced code blocks
and inline-code spans — `((uuid))` appearing inside code is not rewritten.

---

## 8. Tags

Tag handling happens in pass 2 (`convertTags`), outside code fences. Two syntaxes are recognized:
`#simple-tag` and `#[[multi word tag]]`. Tags must follow the start of line, whitespace, or an
opening bracket/paren (`([`). For each tag, in order:

1. **Hex color?** Pure 6-digit hex tokens (`#FF0000`) are never treated as tags — left as-is.
2. **Drop?** If the tag (or its hyphenated form) is in `dropTags`, it is removed entirely.
   Default `dropTags` is `['card']`.
3. **Convert to link?** Only if `convertTagsToLinks` is on:
   - If `convertTagsOnlyExistingPages` is on (default), the tag becomes `[[tag]]` **only when a
     page with that name exists** in the graph; otherwise it stays a `#tag`. This is the "smart"
     conversion: real pages become links, ad-hoc tags stay tags.
   - If `convertTagsOnlyExistingPages` is off, every tag becomes `[[tag]]`.
4. **Keep as tag (default).** Multi-word `#[[multi word]]` is sanitized to `#multi-word`; simple
   tags are left as-is.

Tags listed in `dropTags` are also removed from frontmatter `tags:` (section 9).

---

## 9. Properties

### Page properties → frontmatter

The leading block of unindented `key:: value` lines becomes YAML frontmatter
(`extractPageProperties`):

- `alias` / `aliases` → an `aliases:` list (wikilink brackets stripped).
- `tags` → a `tags:` list (`#` and `[[…]]` stripped; comma- and space-separated values both
  handled; values in `dropTags` removed; if all are removed, no `tags:` key is emitted).
- `title` → registered as an additional alias (so the page is findable by title in Obsidian);
  removed from YAML as a standalone key. Also kept in `raw` for the filename / reporting.
- Keys listed in `dropPageProperties` → dropped. Default: `public`, `exclude-from-graph-view`.
- **YAML quoting:** values that are YAML-unsafe (contain `: `, `#`, start with `[`, `{`, are
  boolean words, integers, floats, or reserved YAML tokens) are double-quoted. Wikilink-valued
  scalars are also quoted (`project: "[[Big Project]]"`); multiple wikilink values become a quoted
  list.
- **Date extraction:** values wrapped in `[[…]]` that parse as dates are unwrapped and emitted as
  bare ISO dates (not quoted). Template tokens like `{{date}}` are left as-is.
- **List splitting:** comma-separated values are split with bracket-awareness (respects `[[…]]`
  and `(…)` boundaries so `[[a, b]]` is not split mid-link).
- **Duplicate keys:** when the same key appears multiple times, last value wins; insertion order
  of first occurrence is preserved in the YAML output.
- Empty-valued properties (key with no value) are silently dropped.

If a file starts with a `- ` bullet, it has no page-property block.

### Block properties → cleaned from body

Indented `key:: value` continuation lines are stripped by `removeLeftoverBlockProperties` (after
`heading::`, `id::`, and `logseq.order-list-type::` have been handled by their own converters).
Both standard indented form (`  key:: value`) and bullet form (`- key:: value`) are recognized.

**Always dropped** (Logseq-internal, never meaningful in Obsidian — not user-overridable):
`collapsed`, `background-color`, `heading`, `filters`, `public`, `exclude-from-graph-view`,
`query-table`, `query-properties`, `query-sort-by`, `query-sort-desc`, `query-flag`, plus **any key
starting with `logseq.`**, **`query-`**, **`hl-`**, or **`ls-`** (highlight/annotation-related).

**Additionally dropped:** any key the user lists in `dropBlockProperties` (default empty). Unknown
user block properties (e.g. `rating:: 5`) are **kept** by default.

### Special property conversions

| Logseq | Obsidian |
|---|---|
| `heading:: N` (1–6) | `#`×N prefix on the owning bullet; the property line is dropped |
| `heading:: true` (auto) | property line dropped, no prefix |
| `logseq.order-list-type:: number` | bullet becomes `1.`, `2.`, … (counter per indent level) |
| `id:: <uuid>` | `^shortid` anchor (section 7) |

---

## 10. Inline syntax & blocks

| Logseq | Obsidian | Notes |
|---|---|---|
| `^^highlight^^` | `==highlight==` | skips fenced **and** inline code |
| `#+BEGIN_QUOTE` … `#+END_QUOTE` | `> ` blockquote | |
| `- #+BEGIN_QUOTE` (bullet-prefixed) | `- > text` blockquote under bullet | Issue 1: preserves list structure |
| `#+BEGIN_NOTE/TIP/WARNING/IMPORTANT/CAUTION/EXAMPLE` | `> [!type]` callout | first `**bold**` line becomes the callout title |
| `- #+BEGIN_TIP` (bullet-prefixed) | `- > [!tip]` callout under bullet | |
| `#+BEGIN_COMMENT` | `%% … %%` | |
| `#+BEGIN_QUERY` … `#+END_QUERY` | `` ```query `` … `` ``` `` | preserves query DSL verbatim in a fenced block |
| other `#+BEGIN_*` (CENTER/VERSE/PINNED/…) | `> [!note]` fallback | nesting supported |
| `#+BEGIN_*` inside a fenced code block | left unchanged | fence-aware: org markers in code are inert |
| numbered list (bullet + `logseq.order-list-type:: number`) | `1.` `2.` `3.` | counter resets on level change / non-numbered sibling |
| code fences in bullets | code fence with aligned closing fence | `fixCodeBlocksInLists` (tab-safe indent) |
| heading followed by indented list | `- # Heading` + list | `fixHeadingChildLists` |
| `$inline$` / `$$block$$` math | unchanged | both apps use MathJax |

---

## 11. Media & assets

| Logseq | Obsidian | Notes |
|---|---|---|
| `![alt](../assets/x.png)` | `![[x.png]]` | bytes copied to `<output>/assets/` |
| `[label](../assets/x.pdf)` | `[[x.pdf]]` | plain (non-embed) asset links also converted |
| `![alt](../assets/x.png){:height H, :width W}` | `![[x.png\|WxH]]` | dimensions always win over alt text |
| `![alt](../assets/x.png)` with `keepAssetAltText` | `![[x.png\|alt]]` | only when no dimensions and alt is non-empty |
| `![](../assets/Book_(2024).pdf)` | `![[Book_(2024).pdf]]` | paren-balanced path matching |
| `{{video URL}}` / `{{youtube URL}}` | `![](URL)` | |
| `{{tweet URL}}` | `![](URL)` | |

Only links whose path contains `assets/` are treated as local assets; URLs (`http:`, `https:`,
`data:`) and other paths are left alone. Asset links inside fenced code blocks **and inline code
spans** are not converted. Assets are de-duplicated by filename when copied; the byte copy resolves
the source relative to the note's directory (tolerant of `../` prefixes).

---

## 12. Logseq-only content

Each Logseq-only feature has an independent keep/drop choice. "Keep" preserves the text verbatim
(and reports it via `ctx.reportSkipped` so the user can revisit it); "drop" removes it cleanly.

| Feature | Syntax | Option | Default | If kept | If dropped |
|---|---|---|---|---|---|
| Queries | `{{query …}}`, `#+BEGIN_QUERY … #+END_QUERY` | `queries` | `keep` | left verbatim + reported | block removed, no residue |
| Flashcards | `#card`, `{{cloze …}}` | `flashcards` | `keep` | left verbatim + reported | `{{cloze X}}` → `X`, `#card` removed |
| Time tracking | `:LOGBOOK:` / `CLOCK:` on tasks | `logbook` | `drop` | lines kept on the task | lines removed cleanly |

Whiteboards (`whiteboards/*.edn`) are always skipped and reported (not migratable).

---

## 13. Name collisions & disambiguation

Because namespaces become folders, two notes in different folders can share a basename
(e.g. `projects/notes` and `personal/notes`). This is **valid in Obsidian** — a note's canonical
identity is its full vault path, and a link can carry the full path while displaying only the
basename: `[[personal/notes|notes]]`.

The importer handles this natively, with no flattening:

- **Output-path collisions** (two sources mapping to the *exact same* path) are detected during
  planning. The first writer wins; later colliders are reported and skipped — no silent overwrite.
- **Ambiguous bare links.** A `basename → [paths]` index is built from all plans. In pass 2,
  `disambiguateBasenameLinks` rewrites any bare `[[name]]` whose basename maps to 2+ notes into
  `[[full/path|name]]` (using the first path as canonical, and preserving any explicit display
  text). If one of the paths is an **exact top-level match** (no namespace / folder), the link is
  left as-is — it already resolves unambiguously in Obsidian's shortest-path resolution. Links that
  already contain a `/` (namespace-style) or a `#` (block/heading ref) are also left untouched.

This mirrors exactly how Obsidian itself disambiguates same-named notes, so the output stays
idiomatic and no data is lost.
