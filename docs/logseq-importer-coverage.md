# Logseq Importer: External Coverage Check

A second implementation is a free review. [`sercxanto/logseq_to_obsidian`][ext] (MIT, Python) is
the closest independent Logseq→Obsidian converter to this one — page properties to YAML, task
states, block ids and refs, org blocks to callouts, highlights, `logseq.order-list-type::`
numbered lists, LOGBOOK, `{{video}}`/`{{youtube}}`/`{{tweet}}` — and it keeps its behaviour as 70
numbered requirements in `docs/spec/requirements.yml`.

This document walks that list against our implementation. It is a coverage check, not a
specification: the [transformation reference](./logseq-importer-transformations.md) remains
authoritative for what we do. Where the two disagree on purpose, the reason is recorded here so
the difference stays a decision rather than an oversight.

Every row was verified by running our code, not by reading it.

Legend: **✓** same behaviour · **≈** different on purpose · **✗** we do not do this.

[ext]: https://github.com/sercxanto/logseq_to_obsidian

## Frontmatter and page properties

| Req | Behaviour | | Where |
|---|---|---|---|
| FRONTMATTER-001 | Leading `key:: value` becomes YAML | ✓ | `properties.ts` `extractPageProperties` |
| FRONTMATTER-002 | `alias::`/`aliases::` → `aliases:` | ✓ | both keys are read |
| FRONTMATTER-003 | `tags::` normalised, no `#`, stable order | ✓ | `tagsFromItem` |
| FRONTMATTER-004 | Unknown page properties kept as scalars | ✓ | |
| FRONTMATTER-005 | Only top-of-file unindented properties become YAML | ✓ | later/indented ones stay in the body |
| FRONTMATTER-006 | Wikilink values quoted; comma-separated become a list | ✓ | |
| SPACING-001 | Exactly one blank line after the frontmatter | ✓ | |
| TITLE-001 | Drop `title::`, warn when it mismatches the path | ≈ | We make `title::` an **alias** instead, so a link by the old title still resolves. No warning: nothing is lost to warn about. |
| PROPS-001/002 | `collapsed::` filtered, including on the bullet head | ✓ | `ALWAYS_DROP_BLOCK_PROPS` |
| LOGSEQPROP-001 | Remaining `logseq.*` properties removed | ✓ | prefix rule also covers `hl-`, `ls-`, `query-` |

## Tasks

| Req | Behaviour | | Where |
|---|---|---|---|
| TASKS-001/002/004/005 | State keywords → checkbox states | ✓ | `tasks.ts` `KEYWORDS` |
| TASKS-006 | Only `-` bullets, only uppercase states | ✓ | `* TODO` and `- todo` are not tasks |
| TASKS-PRIO-001…004 | `[#A]`/`[#B]`/`[#C]` after the state only | ✓ | emoji and Dataview forms |
| TASKS-DATE-003 | `.+N`/`++N` "when done"; `+N` plain; pluralised | ✓ | `formatRepeaterEmoji` |
| TASKS-DATE-004/005 | Tokens stripped, fields appended before any `^anchor` | ✓ | `attachBlockIds` runs after |
| TASKS-DATE-006 | Both SCHEDULED and DEADLINE, scheduled first | ✓ | |
| TASKS-DATE-007 | Tokens on continuation lines | ✓ | |
| TASKDATE-001 | `created`/`completed`/`done`/`cancelled` → ➕/✅/❌ | ✓ | with or without `[[…]]` |
| LOGBOOK-001 | `:LOGBOOK:`…`:END:` removed | ✓ | ours is an option, dropped by default |
| **TASKS-DATE-001/002** | **SCHEDULED/DEADLINE inline in the task text** | **✗→✓** | **Was a gap. Fixed; see below.** |

## Links, references and embeds

| Req | Behaviour | | Where |
|---|---|---|---|
| BLOCKID-001 | `id:: X` becomes a trailing `^X` on the previous line | ✓ | `block-ids.ts` |
| BLOCKID-002 | Do **not** anchor when a property line sits between | ≈ | We anchor onto the property line, which `wrap` mode then renders as `[type:: note] ^abc123`. Keeping the anchor beats dropping it. |
| BLOCKID-003 | `id::` alone on a bullet keeps the property line | ✓ | no id registered |
| BLOCKREF-001/002 | `((id))` → `[[path#^id]]`; unknown ids untouched | ✓ | |
| LINKPATH-001 | Vault-relative, no extension, forward slashes | ✓ | |
| LINKALIAS-001 | `[Display]([[Page]])` → `[[Page\|Display]]` | ✓ | outside code |
| EMBED-001/002 | `{{embed ((id))}}`, `{{embed [[Page]]}}` | ✓ | |
| EMBED-003/004 | `{{video}}`, `{{youtube}}`, `{{tweet}}` → `![](URL)` | ✓ | |
| IMAGE-001 | Asset links → `![[file]]`, alt text dropped | ✓ | `keepAssetAltText` can keep it |
| IMAGE-002 | `{:height H, :width W}` → `![[file\|WxH]]` | ✓ | |
| LINKNS-001…003 | `[[key/value]]` → Dataview `[key::value]` | ✗ | Not a feature we have. A namespaced page is a real page here, and turning one into an inline field would break the link. Not planned. |

## Structure

| Req | Behaviour | | Where |
|---|---|---|---|
| JOURNALS-001 | `YYYY_MM_DD.md` → `YYYY-MM-DD.md` | ✓ | and any configured daily-note format |
| JOURNALS-002 | Journals under a configurable folder | ✓ | Daily Notes settings by default |
| STRUCTURE-001 | `pages/` flattened to the root, `___` → subfolders | ✓ | `paths.ts` |
| STRUCTURE-002 | Non-Markdown files copied as-is | ✓ | assets, when referenced |
| STRUCTURE-003/006 | `logseq/` and `.git/` not processed | ✓ | only `pages/` and `journals/` are read |
| STRUCTURE-005 | Warn on percent-encoded filenames, preserve them | ≈ | We **decode** them instead (`%3A` → `:`), then sanitise. A decoded title is what the user saw in Logseq. |
| **STRUCTURE-004** | **`whiteboards/` skipped with a warning** | **✗** | **Open gap — see below.** |
| MTIME-001 | Source times preserved on output | ✓ | `fileTimes` |
| CLI-001 | A `--version` flag | — | Not applicable; we are a plugin. |

## Inline syntax and blocks

| Req | Behaviour | | Where |
|---|---|---|---|
| HIGHLIGHT-001/002 | `^^x^^` → `==x==`, not inside code | ✓ | |
| NUMLIST-001/002 | Numbered lists, resetting on indent change | ✓ | |
| HEADCHILD-001 | Heading followed by an indented list gets `- ` | ≈ | We fire on any indent; they require ≥4 spaces. |
| HEADCHILD-002/003 | Headings already in a list, and code, untouched | ✓ | |
| ORGBLOCK-001 | `#+BEGIN_QUOTE` → blockquote | ✓ | |
| ORGBLOCK-002 | NOTE/TIP/WARNING/… → callouts | ✓ | |
| ORGBLOCK-003 | First `**bold**` line becomes the callout title | ✓ | |
| ORGBLOCK-004 | `#+BEGIN_COMMENT` → `%%` | ✓ | |
| ORGBLOCK-005/006 | Nesting, and blocks inside indented list items | ✓ | |
| **ORGBLOCK-007** | **Code-bearing blocks not turned into callouts** | **✗→✓** | **Was a gap, and the worst one. Fixed; see below.** |

## What the check found

Three defects, each now fixed with a test that fails without the fix.

**`#+BEGIN_SRC` was destroyed** (ORGBLOCK-007). Any org block outside the callout set fell through
to `[!note]`, so source code became a blockquote: the language was dropped and the body's
indentation flattened, which for a language like Python is the meaning.

```
- #+BEGIN_SRC python      - > [!note]              - ```python
    def f():         →      > def f():        →      def f():
        return 1            >     return 1               return 1
  #+END_SRC                                          ```
```

`SRC` and `EXPORT` now join `QUERY` as fenced code blocks, taking the fence language from the
block's own argument. Prose blocks with no Obsidian equivalent (`VERSE`, `CENTER`, `PINNED`) still
fall back to a note, which is the right home for prose.

**Inline `SCHEDULED:`/`DEADLINE:` was left as org syntax** (TASKS-DATE-001/002). Logseq writes
these on a continuation line and we read them there, but a hand-edited graph can leave one inline,
where it survived into the vault verbatim. Both are now taken from the task text as well; the
continuation line still wins where a task has both.

**No non-ASCII tag was ever recognised.** `#([\w/-]+)` is ASCII-only, so `#café`, `#日本語` and
`#Ünicode` were neither converted to links nor matched against the user's drop list. Now
`#([\p{L}\p{N}_/-]+)`. Found via this project's changelog, which records the same bug.

One related repair while in there: the hex-colour guard ran before the drop list and covered the
three- and four-digit shorthands, so `#dad`, `#bad`, `#ace` and `#face` were read as colours and
could not even be dropped by name. The drop list is now read first, and where the graph has a page
matching the token, that settles it as a tag — evidence beats the shape of the token.

## Known gap

**`whiteboards/` is skipped in silence** (STRUCTURE-004). We read only `pages/` and `journals/`,
so a graph with whiteboards imports without them and without saying so. Reporting it needs a
user-facing string, which means a new key in `src/i18n/en.ts` and a `npm run locales`
regeneration across 34 files — a change wide enough to want its own commit, so it is left out of
this one deliberately.

## Sources worth knowing about

| Project | Licence | Use |
|---|---|---|
| [sercxanto/logseq_to_obsidian][ext] | MIT | Closest match. Requirements spec and golden-file fixtures are reusable. |
| [NishantTharani/LogSeqToObsidian](https://github.com/NishantTharani/LogSeqToObsidian) | **none** | Most popular (228★) and has an example vault, but no licence grants no permission to copy. Read only. |
| [logseq/mldoc](https://github.com/logseq/mldoc), [logseq/logseq](https://github.com/logseq/logseq) | **AGPL-3.0** | The authoritative parser and its corpus. Incompatible with our MIT licence — read to learn the grammar, never copy fixtures across. |
| [viktomas/logseq-export](https://github.com/viktomas/logseq-export) | MIT | Same golden-file shape, but targets Hugo, so only its inputs transfer — and they are tiny. |
| [sawhney17/logseq-schrodinger](https://github.com/sawhney17/logseq-schrodinger) | MIT | 344★, no tests at all. |
