# Logseq importer transformations

This document describes the transformations performed by the Logseq importer and the options that control them. When no safe automatic conversion exists, the importer preserves the source text.

Tests cross-reference some rules using section labels such as `[G1]`.

## Contents

- [A. Pipeline](#a-pipeline)
- [B. Options](#b-options)
- [C. Document structure](#c-document-structure)
- [D. Tasks](#d-tasks)
- [E. Journals and dates](#e-journals-and-dates)
- [F. Pages, namespaces, and output paths](#f-pages-namespaces-and-output-paths)
- [G. Links, references, and embeds](#g-links-references-and-embeds)
- [H. Tags](#h-tags)
- [I. Properties](#i-properties)
- [J. Inline syntax and blocks](#j-inline-syntax-and-blocks)
- [K. Media and assets](#k-media-and-assets)
- [L. Logseq-only content](#l-logseq-only-content)
- [M. Name collisions](#m-name-collisions)

## A. Pipeline

The import uses two passes so cross-file references can be resolved after every note has a planned output path.

During planning, the importer reads the configured page and journal directories, assigns each Markdown file a logical name and source identity, and uses the shared importer framework to plan its final path. Templates and duplicate handling are applied here.

Pass 1 performs per-file conversion in this order:

1. Convert leading page properties to frontmatter.
2. Convert `heading:: N` properties.
3. Convert tasks and task metadata.
4. Convert numbered lists.
5. Convert Org blocks, including advanced queries.
6. Convert simple `{{query …}}` macros.
7. Convert highlights.
8. Convert media macros.
9. Repair headings followed by child lists.
10. Align closing fences in list-nested code blocks.
11. Collect and rewrite asset links.
12. Convert Markdown links whose targets are wikilinks.
13. Normalize English journal-date links to ISO dates.
14. Convert `id::` properties to block anchors and collect the block index.
15. Remove internal block properties while retaining unknown properties.
16. Normalize non-breaking spaces, trailing whitespace, and empty bullets.

Asset paths are finalized after collision-safe attachment paths are known. Note-title planning is then repeated so a `{{content}}` title template sees the final attachment links.

Pass 2 performs cross-file resolution and writing:

1. Resolve block references and embeds.
2. Rewrite references that target page aliases.
3. Sanitize tags and remove disabled `#card` markers.
4. Reformat ISO date links to the target Daily Notes format when needed.
5. Rewrite source page links to their planned vault paths.
6. Flatten outlines when enabled.
7. **[A1]** Skip a note if both its body and frontmatter are empty.
8. Write, update, skip, or copy the note according to the selected duplicate mode, then write planned assets.

## B. Options

| Option | Default | Effect |
|---|---:|---|
| `useDailyNotes` | On | Write journals to the Daily Notes folder and use its date format. When off, write them to `Journals` under the selected output folder using `YYYY-MM-DD`. |
| `flattenOutlines` | Off | Convert page and journal outlines to paragraphs, headings, and conventional lists. |
| `queries` | On | Preserve queries as inert fenced blocks or inline code. |
| `flashcards` | On | Preserve `#card` markers and `{{cloze …}}` wrappers. |
| `timeTracking` | Off | Preserve `:LOGBOOK:` and `CLOCK:` time-tracking drawers. |

## C. Document structure

Logseq uses nested bullets as document structure. By default, the importer preserves that outline structure while still applying the syntax conversions documented below.

When `flattenOutlines` is enabled, `deOutline` parses the bullet tree and serializes it as conventional Markdown:

- **[C1]** Heading bullets become real headings, with their children placed beneath them. A block anchor remains directly below its heading.
- **[C1]** A subtree with at least two list-compatible siblings remains a list. Headings are never treated as list items.
- **[C1]** A simple single-child prose chain becomes one paragraph.
- **[C1]** Other prose bullets become paragraphs separated by blank lines.
- **[C1]** Tasks remain list items. Consecutive tasks within a section are grouped; independent top-level tasks remain separate blocks.
- **[C1]** Fenced code blocks remain intact, including closing fences followed by a block anchor.
- **[C1]** Continuation lines are de-indented using their actual whitespace, so tabs and spaces are both supported.

De-outlining runs after every other content conversion.

## D. Tasks

Recognized workflow keywords are `TODO`, `DOING`, `DONE`, `LATER`, `NOW`, `WAITING`, `WAIT`, `STARTED`, `IN-PROGRESS`, `CANCELLED`, and `CANCELED`. An optional colon after the keyword is removed.

| Logseq state | Checkbox marker |
|---|---|
| `TODO`, `LATER`, `WAITING`, `WAIT` | `[ ]` |
| `DOING`, `NOW`, `STARTED`, `IN-PROGRESS` | `[/]` |
| `DONE` | `[x]` |
| `CANCELLED`, `CANCELED` | `[-]` |

Recognized metadata is appended as readable text after an em dash:

| Logseq metadata | Imported text |
|---|---|
| `[#A]`, `[#B]`, `[#C]` | `priority A`, `priority B`, `priority C` |
| `SCHEDULED: <2024-06-15 Sat>` | `scheduled [[2024-06-15]]` |
| `DEADLINE: <2024-06-20 Thu>` | `due [[2024-06-20]]` |
| `created::`, `completed::`, `done::`, `cancelled::`, `canceled::` | A readable label followed by a linked date |
| `+1w`, `++1w`, `.+1w` | A readable recurrence followed by the original token |

**[D1]** Unrecognized task metadata is retained. Existing block anchors remain at the end of the task line. When time tracking is off, `:LOGBOOK:` drawers are removed from task and non-task blocks; when it is on, they are retained verbatim.

## E. Journals and dates

The importer reads `:journal/file-name-format` and `:journal/page-title-format` from `logseq/config.edn`.

- A configured journal filename format is used to parse source paths such as `15-06-2024` or `2024/06/15` into ISO dates.
- Without a configured format, `YYYY_M_D` and `YYYY-M-D` filenames are recognized.
- The configured page-title format is registered as another source name so links using that title can resolve to the planned journal note.
- English date links such as `[[Aug 30th, 2024]]` are converted directly to `[[2024-08-30]]`.
- An unrecognized journal path is retained instead of being guessed.

When `useDailyNotes` is on, the target folder and filename format come from the Daily Notes core plugin, falling back to `Journals` and `YYYY-MM-DD`. When it is off, journals are written to `Journals` under the selected output folder using `YYYY-MM-DD`.

**[E1]** If the target format differs from ISO, pass 2 reformats `[[YYYY-MM-DD]]` links, including links with a `#^anchor`, so they continue to match journal filenames.

## F. Pages, namespaces, and output paths

- **[F1]** Pages are written beneath the selected output folder.
- In the `triple-lowbar` filename format, `a___b.md` becomes `a/b.md`. Percent-encoded characters and slashes are decoded safely.
- In the legacy filename format, dots separate namespaces.
- Page source subdirectories are not reproduced; page hierarchy comes from the encoded filename.
- Journal paths are parsed using the configured journal format. If a path is not recognized as a date, its relative stem is retained.
- Parent paths and filenames are sanitized separately before planning.
- Journals use the Daily Notes folder when enabled, or `Journals` beneath the selected output folder when disabled.
- Graph-level whiteboards are not imported and are reported once as unsupported.

## G. Links, references, and embeds

| Logseq | Obsidian |
|---|---|
| `[display]([[Page]])` | `[[Page\|display]]` |
| `[[Alias]]` | `[[Canonical\|Alias]]` when the alias resolves unambiguously |
| `id:: <uuid>` | A `^shortid` block anchor |
| `((uuid))` | `[[Page#^shortid]]` when resolved |
| `{{embed ((uuid))}}` | `![[Page#^shortid]]` when resolved |
| `{{embed [[Page]]}}` | `![[Page]]` |

**[G1] Aliases.** The importer builds an alias index from `alias::`, `aliases::`, and `title::`. Both alias properties contribute equally. Aliases claimed by multiple pages, or names already owned by real pages, are excluded from rewriting. Alias values are still included in frontmatter. Rewriting skips code and avoids redundant self-alias links.

**[G1] Block IDs.** UUIDs are shortened to stable six-character anchors. Collisions within one note receive `-1`, `-2`, and so on. The same mapping is used for references. Anchors are placed after closing code fences, directly below headings, and after retained block-property lines. If the same UUID is defined more than once, the later definition supplies the graph-wide target.

**[G1] Code examples.** Character-level rewrites skip inline and fenced code. Line-oriented conversions skip fenced code. Backtick and tilde fences, including list-prefixed fences, are supported.

**[G1] Orphan references.** Unresolved `((uuid))` references are retained. Resolved bare references become links; explicit embeds remain embeds.

## H. Tags

Tag conversion runs outside Markdown code. Tags must follow the start of a line, whitespace, or an opening bracket or parenthesis.

- **[H1]** Simple tags are preserved. This includes six-digit color-like tags such as `#FF0000`.
- `#[[multi word]]` becomes a sanitized tag such as `#multi-word`.
- `#card` is retained when flashcards are enabled and removed when they are disabled, including in frontmatter tags.

## I. Properties

### Page properties

**[I1]** A leading block of unindented `key:: value` lines becomes YAML frontmatter. A file beginning with a bullet has no page-property block.

- `alias` and `aliases` become an `aliases` list.
- `title` becomes an additional alias and does not replace the filename.
- `tags` becomes a tag list. Wikilink brackets and leading `#` markers are removed.
- `created` and `updated` are emitted as bare ISO dates only when their complete value is an ISO date or an ISO-date wikilink.
- Comma-separated wikilinks become a list without splitting commas inside a wikilink. Properties named by Logseq's `:property/separated-by-commas` setting are also emitted as lists.
- Duplicate keys use the last value while retaining the first key's position.
- Empty properties are omitted.
- Values are quoted when required by the converter, including booleans, numeric-looking strings, wikilinks, tag-style values, and strings with YAML-sensitive leading characters or separators.

The following page properties are removed: `collapsed`, `filters`, `background-color`, `heading`, `public`, `exclude-from-graph-view`, `icon`, `template`, and `template-including-parent`. Keys beginning with `logseq.`, `query-`, `hl-`, or `ls-` are also removed.

### Block properties

Internal block properties are removed after their relevant conversions run. Unknown properties such as `rating:: 5` remain in their original form.

The following block properties are removed: `alias`, `aliases`, `collapsed`, `background-color`, `heading`, `filters`, `public`, `exclude-from-graph-view`, `template`, `template-including-parent`, `query-table`, `query-properties`, `query-sort-by`, `query-sort-desc`, and `query-flag`. Keys beginning with `logseq.`, `query-`, `hl-`, or `ls-` are also removed.

### Special property conversions

| Property | Result |
|---|---|
| `heading:: N` for 1–6 | Add the corresponding heading prefix to the owning bullet |
| `heading:: true` | Remove the property without adding a heading prefix |
| `logseq.order-list-type:: number` | Convert the owning bullet to a numbered-list item |
| `id:: <uuid>` | Add a block anchor as described in section G |

## J. Inline syntax and blocks

| Logseq | Obsidian | Notes |
|---|---|---|
| `^^highlight^^` | `==highlight==` | **[J1]** Skips inline and fenced code |
| `#+BEGIN_QUOTE` | Blockquote | Bullet-prefixed blocks remain under their bullet |
| `#+BEGIN_NOTE/TIP/WARNING/IMPORTANT/CAUTION/EXAMPLE` | Corresponding callout | A bold first line becomes the callout title |
| `#+BEGIN_COMMENT` | `%% … %%` | |
| `#+BEGIN_QUERY` | Fenced `query` block | Removed when queries are disabled |
| `#+BEGIN_SRC` or `#+BEGIN_EXPORT` | Fenced code block | Uses the first block argument as the language when valid |
| Other `#+BEGIN_*` blocks | `note` callout | Nested blocks are supported |
| `{{query …}}` alone on a block | Fenced `query` block | Removed when queries are disabled |
| Inline `{{query …}}` | Inline code | Removed when queries are disabled |
| `logseq.order-list-type:: number` | Numbered list | Counter resets by indentation and sibling type |
| `$inline$` and `$$block$$` math | Unchanged | Both apps use MathJax |

**[J1]** Org markers inside fenced code are unchanged. List-nested code fences keep their indentation and support a trailing block anchor on the closing fence.

## K. Media and assets

| Logseq | Obsidian |
|---|---|
| `![alt](../assets/x.png)` | `![[planned/path/x.png]]` |
| `[label](../assets/x.pdf)` | `[[planned/path/x.pdf]]` |
| `![alt](../assets/x.png){:height H, :width W}` | `![[planned/path/x.png\|WxH]]` |
| `{{video URL}}`, `{{youtube URL}}`, `{{tweet URL}}` | `![](URL)` |

**[K1]** Only links whose paths contain `assets/` are treated as graph assets. URLs and other paths are unchanged. Asset conversion skips inline and fenced code, supports balanced parentheses in paths and one nested bracket pair in labels, preserves dimensions, and drops alt text.

Assets use the shared attachment-location and collision planner. Existing files with identical bytes may be reused; name collisions receive numbered paths. A missing or unreadable asset leaves the source link intact and is reported without aborting the import. Copied assets retain source creation and modification times when available.

## L. Logseq-only content

| Feature | When enabled | When disabled |
|---|---|---|
| Simple queries | A query-only block becomes a fenced `query` block; an inline query becomes inline code | The macro is removed |
| Advanced queries | Converted to a fenced `query` block | The block is removed |
| Flashcards | `#card` and `{{cloze …}}` are retained | Cloze wrappers are removed while their text is retained; `#card` is removed |
| Time tracking | `:LOGBOOK:` drawers are retained | Drawers are removed |

Dynamic template macros such as `{{date:…}}` are left as literal text.

## M. Name collisions

Obsidian identifies notes by full vault path, so namespaced notes can share a basename.

- Every source note is planned before writing. Case-insensitive path collisions receive distinct filenames.
- Existing notes follow the selected update, skip, or copy mode. The managed `logseq-source` identity allows updates to find previously imported notes after they are moved or renamed.
- **[M1]** Links using a source page's full logical name are rewritten to the final planned path. A bare basename is rewritten only when it identifies one page or an exact top-level page owns that name. Ambiguous bare links remain unchanged.
