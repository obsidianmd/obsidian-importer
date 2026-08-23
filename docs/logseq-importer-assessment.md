# Logseq Importer: Implementation Summary and Design Decisions

This document summarizes the implemented Logseq Markdown-graph importer, the main design
considerations, and the decisions made while building it. It is intended as a concise technical
record and as source material for an upstream pull-request description.

The exact behavior and defaults are documented in the
[transformation reference](./logseq-importer-transformations.md).

## 1. What was implemented

The importer adds **Logseq (Markdown graph)** as a first-class source format in the Obsidian
Importer plugin. It is registered in `src/importers.ts` and implemented by
`LogseqImporter` in `src/formats/logseq.ts`.

The user selects a Logseq graph root containing `pages/`, `journals/`, and optionally
`assets/`. The importer:

- recursively reads Markdown notes under `pages/` and `journals/`;
- maps namespaced pages to folders and journals to the configured Daily Notes format;
- converts Logseq tasks, properties, block references, embeds, aliases, tags, org blocks,
  highlights, numbered lists, media, and local assets;
- optionally de-outlines pages and journals into flatter Markdown;
- plans notes and assets through the shared importer framework, including templates, source
  identity, duplicate handling, and the vault's attachment-location setting;
- reports note, attachment, skipped-file, and failure progress through `ImportContext`.

Graph selection and reads use the importer's platform-neutral picked-file abstraction. The importer
targets Logseq's Markdown/file graph format, not the newer database graph format.

## 2. Architecture

### 2.1 Obsidian integration at the boundary

`src/formats/logseq.ts` owns the Obsidian-specific concerns:

- settings UI and graph-folder selection through `PickedFolder`;
- Daily Notes configuration lookup;
- graph traversal and source-path resolution;
- integration with shared output planning, duplicate handling, templates, vault writes, and
  attachment placement;
- the vault-wide indexes required for cross-file conversion.

All modules under `src/formats/logseq/` are pure and Obsidian-independent. This keeps the
transformation logic directly testable with Node:

| Module | Responsibility |
|---|---|
| `options.ts` | option types and defaults |
| `pipeline.ts` | ordered per-file conversion |
| `paths.ts` | namespace and percent-encoded filename handling |
| `properties.ts` | frontmatter and block properties |
| `tasks.ts` | task states, metadata, repeaters, and LOGBOOK drawers |
| `blocks.ts` | org blocks, highlights, numbered lists, media, and fence fixes |
| `block-ids.ts` | block anchors, references, embeds, and orphan handling |
| `links.ts` | aliases, tags, and rewrites to planned vault paths |
| `journals.ts` | source date parsing and target date-link formatting |
| `assets.ts` | local asset-link conversion and copy planning |
| `de-outline.ts` | optional outline-to-Markdown restructuring |
| `normalize.ts` | whitespace cleanup |

### 2.2 Why the importer uses two passes

Logseq block references and alias references can target content in another file. Tag conversion can
also depend on whether a page exists anywhere in the graph. A single-file streaming conversion
cannot resolve those cases reliably.

The implemented pipeline therefore has three stages:

1. **Plan:** determine logical names, ask the shared framework for collision-safe final paths, and
   retain source IDs and timestamps for duplicate handling.
2. **Pass 1:** convert each file locally while collecting block IDs, aliases, referenced assets,
   and non-empty canonical page names.
3. **Pass 2:** resolve block references and aliases, rewrite links to planned paths, convert tags
   and tag-like frontmatter values, reformat date links, optionally de-outline, skip empty output,
   and write the note.

This design follows the useful precedent of the existing Roam importer while accounting for
Logseq's on-disk Markdown layout and the current shared output framework.

## 3. Main design decisions

### 3.1 Preserve outlines by default; flatten only by explicit choice

Logseq uses indentation and bullets as its document model. Automatically flattening every graph
would be more idiomatic in Obsidian but could change meaning in mixed prose/list trees.

The importer therefore preserves the outline by default. Independent **De-outline pages** and
**De-outline journals** toggles allow users to opt in for either kind of note. The de-outliner:

- promotes heading blocks to real Markdown headings;
- keeps tasks and genuine sibling lists as lists;
- collapses simple single-child prose chains;
- turns other prose blocks into paragraphs;
- preserves block anchors and list-nested fenced code.

The separate toggles were chosen instead of one global mode because long-form pages and journal
logs often need different treatment. The feature remains marked experimental because the
paragraph/list distinction is necessarily heuristic.

### 3.2 Keep task conversion inline

The implementation supports three targets:

- **Tasks emoji** (default);
- **Tasks Dataview fields**;
- **Plain checkboxes**.

All three keep tasks in their original notes and outline context. The converter recognizes Logseq's
common workflow states, priorities, scheduled and deadline dates, repeaters, creation/completion/
cancellation dates, and LOGBOOK drawers.

The default Tasks emoji format gives the best balance of fidelity, readability, and implementation
risk. Dataview fields expose the same metadata in queryable text. Plain mode requires no community
plugin and keeps continuation metadata as source text, but collapses workflow states to open/done
checkboxes.

TaskNotes-style extraction into one file per task was considered but not implemented. It would
preserve richer status and time-tracking semantics at the cost of breaking in-note context,
creating potentially thousands of files, and adding a plugin-specific data model.

### 3.3 Treat block references as a graph-wide integrity problem

Logseq stores a full UUID in `id::` and references it as `((uuid))`. Obsidian expects an anchor on
the target block and a page-qualified wikilink.

Pass 1 builds a graph-wide UUID index and replaces each definition with an Obsidian anchor. By
default the anchor is the UUID's first six alphanumeric characters, with a per-note suffix for
short-ID collisions. Users can retain full UUIDs instead.

Pass 2 rewrites:

- bare block references to `[[Page#^anchor]]`, or embeds when configured;
- block embeds to `![[Page#^anchor]]`;
- page embeds to `![[Page]]`.

Anchors are placed carefully around headings and fenced code blocks so both Markdown rendering and
Obsidian block resolution remain valid. Unresolved references are preserved by default; users can
choose to remove them.

### 3.4 Rewrite references made through aliases

Logseq treats a page alias as an alternate target name. Obsidian aliases improve lookup and display
but do not make `[[Alias]]` target the canonical note automatically.

The importer therefore:

- writes `alias::`, `aliases::`, and `title::` values to Obsidian's `aliases` frontmatter;
- builds a case-insensitive alias-to-canonical map;
- rewrites `[[Alias]]` as `[[Canonical|Alias]]`;
- leaves an alias unchanged when multiple pages claim it.

This avoids creating dangling notes named after aliases while preserving the user's display text.

### 3.5 Preserve namespace paths and handle ambiguity explicitly

Logseq's `___` and `%2F` namespace encodings become folder separators, and valid percent escapes are
decoded before filename sanitization. The resulting full path is the page's canonical name.

The shared planner handles exact path and existing-vault collisions according to the selected
duplicate mode. Two same-named sources remain distinct, and links are rewritten to the actual
collision-safe paths selected during planning. Same basenames in different namespaces remain valid;
a bare basename is rewritten only when it identifies one source unambiguously (or an exact
top-level page exists), so an inherently ambiguous link is not guessed.

This keeps namespace structure instead of flattening or globally renaming notes.

### 3.6 Make properties safe and useful in Obsidian

Leading page properties become YAML frontmatter. Aliases and tags receive dedicated list handling;
YAML-sensitive values are quoted; duplicate keys use the last value; and `created`/`updated`
wikilink dates are normalized when they are plain ISO dates.

Properties used only by Logseq's UI, queries, templates, or internal metadata are always removed.
Additional page and block keys can be dropped by the user. Retained block properties default to
Dataview inline-field syntax, with options to keep the raw `key:: value` line or drop it.

Optional kebab-case-to-snake_case conversion was added independently for page and block keys
because hyphenated property names are awkward to query in Bases and Dataview. Drop-list matching
still uses the original source key.

### 3.7 Keep tag conversion conservative

Tags remain tags by default. Multi-word Logseq tags are converted to Obsidian-compatible hyphenated
tags, and six-digit hex colors are protected from tag parsing.

Users can convert tags to wikilinks. The default guard only performs that conversion when the full,
case-insensitive canonical page name exists in the graph; otherwise the tag remains a tag. The same
policy applies to scalar frontmatter values such as `status:: #State`.

The separate `dropTags` list applies to body tags and frontmatter tags. `card` is dropped by default
because it is commonly Logseq SRS metadata rather than a durable topic.

### 3.8 Integrate journals with Daily Notes without assuming more than implemented

The importer reads the target folder and date format from Obsidian's Daily Notes core plugin and
allows both values to be overridden. Journal filenames matching `YYYY_MM_DD` or `YYYY-MM-DD` are
normalized through ISO and formatted for the target. English month-name date links are normalized
and then reformatted to the same target format.

The implementation deliberately does not claim arbitrary source-format support: it does not parse
Logseq's `config.edn`, custom journal filename/page-title formats, or Periodic Notes settings.
Unrecognized journal basenames are retained.

### 3.9 Prefer documented preservation or explicit cleanup for Logseq-only syntax

Where there is no direct Obsidian equivalent:

- simple `{{query}}` macros can be kept or removed;
- org `#+BEGIN_QUERY` blocks become fenced `query` blocks;
- flashcard cloze wrappers can be kept or unwrapped;
- `#card` continues through the normal tag/drop-tag pipeline;
- LOGBOOK drawers can be kept or removed and default to removal;
- template macros and dynamic variables remain literal text.

Kept simple queries and flashcard syntax add an import report entry so the user can find content
that may need manual follow-up. Query translation to Dataview, SRS schedule migration, template
execution, PDF annotation geometry, and whiteboard-to-Canvas conversion are not attempted.

### 3.10 Convert referenced assets, but keep the copy model simple

Markdown links and embeds whose path contains `assets/` become Obsidian wikilinks. Image dimensions
take precedence over optional alt text. Referenced bytes are resolved relative to the source note
and placed using the vault's attachment setting. Same-name collisions receive numbered paths;
same-byte existing files are reused. A missing or unreadable source leaves its original Markdown
link intact and is reported without aborting the rest of the graph.

## 4. User-facing options and defaults

| Area | Default decision |
|---|---|
| Task format | Tasks emoji |
| Journal target | Daily Notes folder and format |
| Page/journal structure | Preserve outlines |
| Tags | Keep as tags; only-existing-page guard ready when conversion is enabled |
| Dropped tags | `card` |
| Queries / flashcards | Keep |
| LOGBOOK drawers | Drop |
| Block IDs | Shorten |
| Unresolved block references | Preserve |
| Bare block references | Link, not embed |
| Unknown block properties | Wrap as Dataview inline fields |
| Property key style | Preserve kebab-case |
| Asset alt text | Drop unless dimensions are present |
| Whitespace cleanup | Enabled |

The defaults favor low-loss note content and broadly readable Markdown while removing Logseq-only
operational metadata that has no useful Obsidian meaning.

## 5. Testing and maintainability

The transformation modules are covered by focused Node tests under `tests/logseq/`:

- unit suites for paths, journals, tasks, properties, links, blocks, block IDs, assets,
  de-outlining, normalization, and orchestration helpers;
- a multi-file end-to-end fixture graph covering cross-file references, aliases, namespaces,
  journals, tasks, org blocks, tags, properties, and assets;
- regression cases for code fences, headings, retained anchors, duplicate names, YAML safety, and
  option variants.

Fixtures use synthetic graph data. Keeping pure transforms independent of `obsidian` allows the
same pipeline to be exercised without a running vault, while the orchestrator remains responsible
for the comparatively small integration surface.

## 6. Known limitations and conscious tradeoffs

- Only Markdown/file-based graphs are supported.
- Only Markdown under `pages/` and `journals/` is scanned. Graph-level whiteboards are outside the
  import and are not individually reported.
- Physical subdirectories below `pages/` and `journals/` are not preserved by output planning;
  namespace structure must be encoded in the filename.
- Source journal formats are pattern-based; `config.edn`, Periodic Notes, weekly/monthly journals,
  and locale-specific date titles are not parsed.
- De-outlining is heuristic and therefore opt-in.
- Rich task modes consume malformed or template-based task date properties without emitting a
  replacement date; plain mode retains those lines.
- Advanced org queries are converted to fenced query blocks before the simple-query keep/drop
  option runs, so they are currently always retained.
- With the defaults, `flashcards: keep` preserves cloze wrappers but `dropTags: ['card']` still
  removes `#card`.
- Ambiguous aliases and ambiguous bare same-basename links are left unresolved rather than guessed.
- Duplicate block UUID definitions use the later pass-1 target.
- Asset placement follows the vault setting rather than preserving the graph's physical asset
  subfolders.
- Existing notes are handled by the shared Update, Skip, or Create a copy modes. Source identity
  enables later imports to find notes users have renamed or moved.
- There is no TaskNotes extraction, query-language translation, SRS schedule migration,
  template/macro execution, PDF geometry migration, or whiteboard conversion.

These constraints keep the first-class importer understandable, testable, and conservative while
covering the Markdown conventions that most directly affect whether a migrated graph remains
navigable and useful.
