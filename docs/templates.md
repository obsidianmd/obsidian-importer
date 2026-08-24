# Import templates

Every note importer has a Markdown template preview step. The importer starts with a generated template, so a template file is not required. The rendered preview shows how imported notes will appear, including their Properties panel and any source ID property enabled in the importer's output settings. Previous and Next switch between up to ten examples from the user's selection. Previewing does not write or place attachments; formats that cannot fully resolve an attachment or nested remote item show the source link or a placeholder instead. An existing Markdown (`.md`) template in the current vault can replace the generated template for this import.

When **Save … ID** is enabled, Edit shows the importer ID as a managed property, for example `bear-id: {{sourceId}}`. The property name is editable and remembered; the `{{sourceId}}` value is disabled because the importer supplies it for each note. The managed row is applied during import rather than written into the selected template file.

Templates use the shared Knap language and the same [variable syntax](https://obsidian.md/help/web-clipper/variables), [filters](https://obsidian.md/help/web-clipper/filters), and [template logic](https://obsidian.md/help/web-clipper/logic) as Obsidian Web Clipper. Importers expose a different set of variables, documented below. The default template for most importers is `{{content}}`, which keeps the importer's generated Markdown unchanged.

Before previewing or writing any imported Markdown note, Importer enforces Obsidian's built-in list types for `tags`, `aliases`, and `cssclasses`. This applies both to importer-generated frontmatter and properties produced by a custom template. Empty properties stay empty. Populated tags and CSS classes split on spaces or commas; aliases split on commas or newlines; leading `#` characters are removed from tags. A bracketed list can preserve a comma inside an alias, for example `["Doe, John", "John Doe"]`.

CSV generates a template from its headers. Each header becomes a variable and, by default, a frontmatter property. Its first row is used for the preview. The generated template uses bracket notation so punctuation in a header is safe, for example `{{source["Project: status"]}}`. It uses the shared `yaml` filter to serialize each cell as a YAML scalar, for example `Status: {{source["Status"] | yaml}}`. **Note title** and **Note location** are configured on this same template page and use Knap syntax, including filters and logic.

## Importer-specific filter

In addition to the Web Clipper filters, Importer provides the `yaml` filter. It serializes a value as a YAML scalar while preserving strings such as zero-padded IDs.

## Shared variables

These variables are available to every note importer.

| Variable | Description |
| --- | --- |
| `{{title}}` | Note title. In the **Note title** template this is the title provided by the importer; in the note template it is the rendered title, before filename sanitization or conflict suffixes. |
| `{{noteName}}` | Final target filename without the `.md` extension. |
| `{{path}}` | Final vault-relative path, including the `.md` extension. |
| `{{folder}}` | Final vault-relative parent folder. Empty at the vault root. |
| `{{content}}` | Complete generated Markdown before applying the selected template. |
| `{{body}}` | Generated Markdown body without its frontmatter, when frontmatter is present. |
| `{{properties}}` | Object containing the generated frontmatter properties. |
| `{{source}}` | Object containing generated properties and importer-specific values. |
| `{{sourceId}}` | Stable source identifier when the importer provides one; otherwise empty. |
| `{{importer}}` | Importer ID, such as `keep`, `html`, or `notion-api`. |
| `{{ctime}}` | Source creation time as an ISO 8601 timestamp; empty when unavailable. |
| `{{mtime}}` | Source modification time as an ISO 8601 timestamp; empty when unavailable. |
| `{{date}}` | Current date and time when the template is rendered, as an ISO 8601 timestamp. |
| `{{time}}` | Alias for `{{date}}`. |

Generated frontmatter properties and importer-specific values are also exposed as top-level variables for convenience. Shared names take precedence. A source value that collides with a shared name remains available below `{{source}}`.

For example, a source property named `content` is available as `{{source.content}}`, while `{{content}}` remains the complete generated note.

## Importer-specific variables

| Importer | Additional variables |
| --- | --- |
| Airtable | Every Airtable field, addressed by its field name. |
| Apple Notes | `isPinned`, indicating whether the note was pinned. |
| CSV | Every CSV column, addressed by its column header or generated column name. |
| Google Keep | `isArchived`, `isPinned`, `isTrashed`, `color`, `labels`, `sharees`, and `annotations`. The source title remains available as `source.title`; labels are exposed as an array of names. |
| HTML | `author`, `contentHtml`, `description`, `domain`, `favicon`, `fullHtml`, `image`, `language`, `published`, `site`, `url`, and `words`, plus extractor-specific values returned by Defuddle. |

## Examples

```twig
---
created: {{ctime | date:"YYYY-MM-DD"}}
modified: {{mtime | date:"YYYY-MM-DD"}}
source: {{importer}}
---
# {{title}}

{{body}}
```

```twig
{% if tags %}
## Tags
{% for tag in tags %}
- {{tag}}
{% endfor %}
{% endif %}
```
