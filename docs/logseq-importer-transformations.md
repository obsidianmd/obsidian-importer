# Logseq Importer: Transformation Reference

This document is the authoritative, up-to-date reference for **every transformation the Logseq
importer performs** and **every option that controls it**. It reflects the actual implementation
under `src/formats/logseq/`.

Tests and implementation comments cross-reference this document with letter-number labels: one
letter per top-level section (`A` through `M`) plus a rule number, such as `[G1]`. Older
development-phase labels are no longer used as public references.

Guiding principle throughout: preserve source content when there is no safe automatic mapping.
Intentional cleanup is limited to documented defaults and the toggles in section B. Files that cannot be imported are reported through `ctx.reportSkipped` / `reportFailed`.

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
assigned a logical name, source identity, and collision-safe final path through the shared importer
framework (section F). This is also where templates and the selected duplicate mode are applied.

**Pass 1 — per-file local conversion** (`convertLocal` in `pipeline.ts`). Everything that can be
done on a single file without the vault index. In order:

1. `extractPageProperties` — leading `key:: value` block → YAML frontmatter (section I).
2. `convertHeadingProperty` — `heading:: N` → `#`×N prefix on the block.
3. `convertTasks` — task keywords → native checkbox markers while preserving source metadata (section D).
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
14. `removeLeftoverBlockProperties` — drop Logseq-internal properties and retain unknown properties.
15. `normalizeWhitespace` — normalize non-breaking spaces, trailing whitespace, and empty bullets.

The local conversion initially leaves asset links unchanged while collecting their references.
After attachments receive collision-safe vault paths, only those links are rewritten; the rest of
the conversion is not repeated. Note-title preflight then runs again with the final links so a
`{{content}}` title template sees the same content that will be written. The importer builds the
**block-id index** (`uuid → {page, shortId}`), the **alias index** (`alias → planned page`, including
both `alias::` and `aliases::`; ambiguous aliases and names owned by real pages are excluded), and a
source-name-to-planned-path link map. Logseq-only content (queries, flashcards) is applied after
`convertLocal`; section L documents how this ordering affects advanced query blocks and flashcard
tags.

**Pass 2 — cross-file resolution + write** (in `logseq.ts`). For each file, in order:

1. `resolveBlockRefs` — `((uuid))` → `[[Page#^shortid]]`, `{{embed ((uuid))}}` → `![[Page#^shortid]]`,
   `{{embed [[Page]]}}` → `![[Page]]`.
2. `rewriteAliasReferences` — `[[Alias]]` → `[[Canonical|Alias]]`.
3. `convertTags` — keep simple tags, sanitize multi-word tags, and remove disabled flashcard markers (section H).
4. ISO date-link reformat — `[[YYYY-MM-DD]]` → target Daily Notes format if it differs.
5. `rewritePlannedPageLinks` — point source page names at their actual collision-safe vault paths.
6. `deOutline` — flatten page and journal outlines when enabled.
7. **[A1] Empty-page check** — if the resulting body is blank and there is no YAML frontmatter, the page
   is skipped (reported via `ctx.reportSkipped`) rather than written as an empty file.
8. Write, update, skip, or copy the note according to shared duplicate handling. After all notes,
    write planned assets that were not safely reused.

---

## B. Options reference

All options live in `src/formats/logseq/options.ts` (`LogseqImportOptions`). Defaults below are `DEFAULT_LOGSEQ_OPTIONS`.

### Journals

| Option | Type | Default | Effect |
|---|---|---|---|
| `useDailyNotes` | boolean | `true` | Write journals to the Daily Notes folder using its date format. When off, journals go under `Journals` in the selected output folder and use `YYYY-MM-DD`. |

### Note structure

| Option | Type | Default | Effect |
|---|---|---|---|
| `flattenOutlines` | boolean | `false` | Flatten page and journal outlines to paragraphs, headings, and lists (section C). |

### Logseq-only content

| Option | Type | Default | Effect |
|---|---|---|---|
| `queries` | boolean | `true` | Keep simple `{{query}}` macros and converted query blocks. |
| `flashcards` | boolean | `true` | Keep `#card` markers and `{{cloze}}` wrappers. |
| `timeTracking` | boolean | `false` | Keep `:LOGBOOK:` / `CLOCK:` time-tracking drawers. |

---

## C. Document structure & de-outlining

Logseq treats every document as an outline of nested `- ` bullets; indentation *is* the structure.
Obsidian uses flat markdown.

**Preserve (default).** Every block stays a `- ` bullet at its original indentation — lossless.
The only structural touch-up is `fixHeadingChildLists` (a heading directly above an indented list
gets a `- ` prefix so Obsidian renders the children correctly).

**De-outline (opt-in).** The `flattenOutlines` toggle applies to both pages and journals. `deOutline` (`de-outline.ts`) parses the bullet tree and re-serializes it as idiomatic markdown using these heuristics:

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

Logseq tasks are bullets whose text starts with a workflow keyword. Recognized keywords: `TODO, DOING, DONE, LATER, NOW, WAITING, WAIT, STARTED, IN-PROGRESS, CANCELLED, CANCELED`.

A colon may follow the keyword (`- TODO: do the thing`); **[D1]** it is recognized as a task and the colon is dropped from the emitted text.

### Checkbox state mapping

| Logseq state | Obsidian checkbox |
|---|---|
| `TODO` / `LATER` / `WAITING` / `WAIT` | `[ ]` |
| `DOING` / `NOW` / `STARTED` / `IN-PROGRESS` | `[/]` |
| `DONE` | `[x]` |
| `CANCELLED` / `CANCELED` | `[-]` |

Priority markers, scheduling and deadline lines, repeaters, and created/completed/cancelled properties remain in their original Logseq form so the importer does not impose a third-party metadata convention.

**[D1]** `:LOGBOOK:` has no direct Obsidian target. Time tracking is disabled by default, which removes `:LOGBOOK:`/`CLOCK:` lines cleanly. Enabling it preserves the drawer verbatim. The drop pass applies to drawers on non-task blocks as well as tasks.

---

## E. Journals & dates

Journals have two distinct source patterns:

- **Source filename** — `journals/2024_08_30.md` style. `journalFilenameToISO` parses the built-in
  `YYYY[_-]M[_-]D` pattern to ISO `YYYY-MM-DD`. Other source filename formats are not read from
  `logseq/config.edn`; an unrecognized journal basename is retained.
- **Source date links** — `[[Aug 30th, 2024]]` style. `convertJournalDateLinks` parses the
  English-month `MMM do, yyyy` family to `[[2024-08-30]]`. Custom source page-title formats are not
  read from `config.edn`.

**Target.** When `useDailyNotes` is on, the journal folder and filename format come from the **Daily Notes** core plugin (`app.internalPlugins.getPluginById('daily-notes')`), falling back to `Journals` / `YYYY-MM-DD`. When off, journals are written under `Journals` in the selected output folder and use `YYYY-MM-DD`. Periodic Notes settings are not read.

**[E1]** If the target format differs from ISO, pass 2 reformats every in-content
`[[YYYY-MM-DD]]` link, including links with a `#^anchor`, so links keep matching the filenames.

---

## F. Pages, namespaces & output paths

- **[F1]** **Pages** are placed in the selected output folder. A namespaced Logseq page filename is converted to a folder path: `namespaceToPath` splits on `%2F` if present, otherwise on the `___` separator, percent-decodes each segment (`decodeLogseqName`, tolerant of malformed escapes), and joins with `/`. So `a___b.md` → `a/b.md` and `Encoded%3AColon.md` → `Encoded:Colon.md`.
- **Journals** use the Daily Notes folder when `useDailyNotes` is on, or `Journals` under the selected output folder when it is off.
- All names are run through `sanitizeFileNameKeepPath` to remove OS-illegal characters while
  keeping the folder hierarchy.
- The **canonical name** (the namespace/date path without `.md`) is what block references and
  wikilinks target.
- The scan is recursive, but output planning uses each source file's basename; physical
  subdirectories under `pages/` or `journals/` are not preserved unless encoded in the basename.
- The importer does not scan the graph-level `whiteboards/` directory. If that directory is
  present, it is reported once as unsupported and skipped.
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

**[G1] Block IDs.** Logseq UUIDs (e.g. `64ab9aa4-459a-41b1-8c21-dbb38dc0c79b`) are shortened to a stable 6-char anchor (`^64ab9a`). Short-id collisions **within one note** are disambiguated by appending `-1`, `-2`, … The same mapping is used to rewrite every `((uuid))` reference, so anchors and links stay consistent. Anchor placement is context-aware:

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

**[G1] Code examples are inert.** Character-level rewrites such as block references, tags, links,
and assets run through `outsideMarkdownCode`, which protects inline and fenced code. Line-oriented
passes such as task/property conversion and whitespace normalization run through
`outsideMarkdownFences`, which protects fenced blocks without splitting a line at inline code.
This distinction preserves line anchors, spaces around inline code, and task continuation metadata.
Backtick or tilde fenced blocks (including list-prefixed fences) retain the exact Logseq syntax they
document. An `id::`-shaped line inside a fence is not indexed or removed. Keeping block references
inside code inert is deliberate: code examples describe Logseq syntax and are not graph references.

**[G1] Orphan block references.** A `((uuid))` whose target was never defined in the graph is left untouched so the source text is not silently lost. Bare references with a known target become plain links; explicit block embeds remain embeds.

---

## H. Tags

Tag handling happens in pass 2 (`convertTags`), outside code fences. Two syntaxes are recognized: `#simple-tag` and `#[[multi word tag]]`. Tags must follow the start of line, whitespace, or an opening bracket/paren (`([`).

1. **[H1]** Pure 6-digit hex tokens (`#FF0000`) are never treated as tags and are left as-is.
2. Multi-word `#[[multi word]]` tags are sanitized to `#multi-word`; simple tags are left as-is.
3. The `#card` marker is kept when Flashcards is on and removed when it is off. This also applies to frontmatter `tags:` (section I).

---

## I. Properties

### Page properties → frontmatter

**[I1]** The leading block of unindented `key:: value` lines becomes YAML frontmatter
(`extractPageProperties`):

- `alias` / `aliases` → an `aliases:` list (wikilink brackets stripped).
- `tags` → a `tags:` list (`#` and `[[…]]` stripped; comma- and space-separated values both handled). The `card` value is removed when Flashcards is off; if no tags remain, no `tags:` key is emitted.
- `title` → registered as an additional alias (so the page is findable by title in Obsidian);
  removed from YAML as a standalone key. It does not replace the filename.
- `public`, `exclude-from-graph-view`, and `icon` → dropped. (`icon` carries a Logseq private-use glyph that renders as □ in Obsidian.)
- **Always dropped** (Logseq-internal, never meaningful in Obsidian — not user-overridable):
  `collapsed`, `filters`, `background-color`, `heading`, `template`, `template-including-parent`,
  plus **any key starting with `logseq.`**, **`query-`**, **`hl-`**, or **`ls-`**.
  These keys are not user-overridable.
- **[I1]** **Tag-style values:** a scalar value that is a single tag (`status:: #IN-PROGRESS`, `area:: #[[Page One]]`) is emitted as quoted text (`status: "#IN-PROGRESS"`). `tags:` and `aliases:` lists are handled separately as described above.
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

**[I1] Retained (unknown) block properties** (e.g. `rating:: 5`, `participants:: [[Alice]], [[Bob]]`) are left in their original `key:: value` form. The always-dropped set above is removed in every case.

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
| `#+BEGIN_QUERY` … `#+END_QUERY` | `` ```query `` … `` ``` `` | **[J1]** preserves query DSL in a fenced block when Queries is on; removes it when Queries is off |
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
| `![alt](../assets/x.png)` | `![[planned/path/x.png]]` | **[K1]** bytes placed using the vault attachment setting |
| `[label](../assets/x.pdf)` | `[[x.pdf]]` | **[K1]** plain (non-embed) asset links also converted |
| `[label [nested] label](../assets/x.pdf)` | `[[x.pdf]]` | **[K1]** label allows one level of nested brackets |
| `![alt](../assets/x.png){:height H, :width W}` | `![[x.png\|WxH]]` | dimensions always win over alt text |
| `![](../assets/Book_(2024).pdf)` | `![[Book_(2024).pdf]]` | **[K1]** paren-balanced path matching |
| `{{video URL}}` / `{{youtube URL}}` | `![](URL)` | |
| `{{tweet URL}}` | `![](URL)` | |

**[K1]** Only links whose path contains `assets/` are treated as local assets; URLs (`http:`, `https:`,
`data:`) and other paths are left alone. Asset links inside backtick or tilde fenced code blocks
(including list-prefixed fences) **and inline code spans** are not converted. The byte copy resolves the source relative to the note's directory
(tolerant of `../` prefixes), then uses the shared attachment-location and collision planner. An
existing same-byte file may be reused; different same-name files receive numbered paths. Planning
holds only attachment metadata: bytes used for deduplication are released immediately and a new
buffer is read only when the attachment is written. If a
source path is missing or unreadable, the original Markdown link is preserved and the failure is
reported without aborting unrelated files. Copied assets retain the source file's creation and
modification times when the filesystem exposes them.

---

## L. Logseq-only content

The importer exposes independent toggles for queries, flashcard syntax, and LOGBOOK drawers:

| Feature | Syntax | Toggle default | When on | When off |
|---|---|---|---|---|
| Simple queries | `{{query …}}` | On | left verbatim and a report entry is added | matching macro removed |
| Advanced queries | `#+BEGIN_QUERY … #+END_QUERY` | On | converted to a fenced `query` block | removed |
| Flashcards | `#card`, `{{cloze …}}` | On | syntax retained and a report entry is added | `{{cloze X}}` → `X`, `#card` removed |
| Time tracking | `:LOGBOOK:` / `CLOCK:` drawers | Off | drawer lines kept | drawer lines removed |

Graph-level whiteboards are skipped and reported once because Obsidian cannot read Logseq's
whiteboard format.

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

- Every source note is preflighted through the shared planner before anything is written. Two
  sources requesting the same path receive distinct names, including case-insensitive collisions.
- Existing vault notes follow the selected Update, Skip, or Create a copy mode. The managed
  `logseq-source` identity lets an update find an imported note after the user moves or renames it.
- **[M1] Planned links.** Links using a source page's full logical name are rewritten to the final
  planned path, preserving the source basename as display text when collision handling changed the
  filename. A bare basename is mapped when it identifies exactly one page, or when an exact
  top-level page owns that name. If several namespaced pages share a basename and none is the
  top-level page, the bare link remains untouched rather than choosing an arbitrary target.

This uses Obsidian's full-path link syntax so same-named notes can remain in their namespaces
without global renaming.
