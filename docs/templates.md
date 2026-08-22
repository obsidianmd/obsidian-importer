# Import templates

Every note importer has a Markdown template preview step. The importer starts
with a generated template, so a template file is not required. The rendered
preview shows how imported notes will appear, including their Properties panel
and any source ID property enabled in the importer's output settings. Previous
and Next switch between up to ten examples from the user's selection. Previewing
does not write or place attachments; formats that cannot fully resolve an
attachment or nested remote item show the source link or a placeholder instead.
An existing Markdown (`.md`) template in the current vault can replace the
generated template for this import.

When **Save … ID** is enabled, Edit shows the importer ID as a managed property,
for example `bear-id: {{id}}`. The property name is editable and remembered;
the `{{id}}` value is disabled because the importer supplies it for each note.
The managed row is applied during import rather than written into the selected
template file.

Templates use the shared Knap language, including filters, conditionals, loops,
and assignments. The default template for most importers is `{{content}}`, which
keeps the importer's generated Markdown unchanged.

The Files importer is excluded because it copies existing files without
rewriting their contents.

CSV generates a template from its headers. Each header becomes a variable and,
by default, a frontmatter property. Its first row is used for the preview. The
generated template uses bracket notation so punctuation in a header is safe,
for example `{{source["Project: status"]}}`. It uses the shared `yaml` filter
to serialize each cell as a YAML scalar, for example
`Status: {{source["Status"] | yaml}}`. **Note title** and **Note location** are
configured on this same template page and use Knap syntax, including filters
and logic.

## Importer filters

All importers can use the standard Knap and HTML filters, plus these
Importer-provided filters:

| Filter | Description |
| --- | --- |
| `yaml` | Serialize a value as a YAML scalar while preserving strings such as zero-padded IDs. |
| `markdown` | Convert HTML to Markdown. An optional URL parameter supplies the page URL used while converting links. |
| `fragment_link` | Create a text-fragment link, using the imported page URL when the template does not provide one. |

## Shared variables

These variables are available to every note importer.

| Variable | Description |
| --- | --- |
| `{{title}}` | Imported note title used to plan the target file. |
| `{{noteName}}` | Final target filename without the `.md` extension. |
| `{{path}}` | Final vault-relative path, including the `.md` extension. |
| `{{folder}}` | Final vault-relative parent folder. Empty at the vault root. |
| `{{content}}` | Complete generated Markdown before applying the selected template. |
| `{{body}}` | Generated Markdown body without its frontmatter, when frontmatter is present. |
| `{{properties}}` | Object containing the generated frontmatter properties. |
| `{{source}}` | Object containing generated properties and importer-specific values. |
| `{{sourceId}}` | Stable source identifier when the importer provides one; otherwise empty. |
| `{{id}}` | Alias for `{{sourceId}}`, used by the managed source-ID property in the template editor. |
| `{{importer}}` | Importer ID, such as `keep`, `html`, or `notion-api`. |
| `{{ctime}}` | Source creation time as an ISO 8601 timestamp; empty when unavailable. |
| `{{mtime}}` | Source modification time as an ISO 8601 timestamp; empty when unavailable. |
| `{{date}}` | Current date and time when the template is rendered, as an ISO 8601 timestamp. |
| `{{time}}` | Alias for `{{date}}`. |

Generated frontmatter properties and importer-specific values are also exposed
as top-level variables for convenience. Shared names take precedence. A source
value that collides with a shared name remains available below `{{source}}`.

For example, a source property named `content` is available as
`{{source.content}}`, while `{{content}}` remains the complete generated note.

## Importer-specific variables

| Importer | Additional variables |
| --- | --- |
| Airtable | Every Airtable field, addressed by its field name. Values use the same conversion used by Airtable's existing title, location, and body templates. |
| CSV | Every CSV column, addressed by its column header or generated column name. |
| HTML | `author`, `contentHtml`, `description`, `domain`, `favicon`, `fullHtml`, `image`, `language`, `published`, `site`, `url`, and `words`, plus extractor-specific values returned by Defuddle. `content` and `title` are supplied by the shared variables. |
| Google Keep | `createdTimestampUsec`, `userEditedTimestampUsec`, `isArchived`, `isPinned`, `isTrashed`, `textContent`, `listContent`, `attachments`, `color`, `labels`, and `sharees`. The source's `title` remains available as `source.title`. |
| Tomboy/Gnote | `tags`, `createDate`, and `lastChangeDate`. Parsed rich-text data is available as `source.content`; the generated Markdown remains `content`. |
| Apple Notes | `originalTitle`, containing the title stored by Apple Notes before note-title templating or filename sanitization. Shared `ctime`, `mtime`, and `sourceId` provide its creation time, modification time, and identifier. |
| Apple Journal, Bear, Evernote, Markdown, Notion, OneNote, Roam, and Textbundle | No additional stable variables. Any properties generated by the importer are available directly and below `properties` and `source`. |

CSV and Airtable variable names depend on the imported table. Defuddle can add
extractor-specific HTML variables—for example, a transcript when the selected
extractor returns one—so that set can grow independently of Importer releases.

Apple Notes also has a **Note title** setting on the template page. It uses the
same Knap syntax, so `{{title}}`, `{{date}} {{title}}`, and
`{{ctime | date:"YYYY-MM-DD"}} {{title}}` are all valid. The default is
`{{title}}`. A saved filename date prefix from an earlier importer version is
automatically converted to the equivalent `ctime` expression.

## Examples

```liquid
---
created: {{ctime | date:"YYYY-MM-DD"}}
modified: {{mtime | date:"YYYY-MM-DD"}}
source: {{importer}}
---
# {{title}}

{{body}}
```

```liquid
{% if tags %}
## Tags
{% for tag in tags %}
- {{tag}}
{% endfor %}
{% endif %}
```
