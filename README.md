![Obsidian Importer screenshot](/images/social.png)

This Obsidian plugin allows you to import notes from other apps and file formats into your Obsidian vault. Notes are converted to plain text Markdown files.

## Get started

Install Importer in Obsidian → Community Plugins.

Import guides are hosted on the [official Obsidian Help site](https://help.obsidian.md/import). You can help contribute to the guides on the [obsidian-help](https://github.com/obsidianmd/obsidian-help) repo.

- [Import from Apple Notes](https://help.obsidian.md/import/apple-notes)
- [Import from Bear](https://help.obsidian.md/import/bear)
- [Import from CSV files](https://help.obsidian.md/import/csv)
- [Import from Evernote](https://help.obsidian.md/import/evernote)
- [Import from Google Keep](https://help.obsidian.md/import/google-keep)
- [Import from Microsoft OneNote](https://help.obsidian.md/import/onenote)
- [Import from Notion](https://help.obsidian.md/import/notion)
- [Import from Roam Research](https://help.obsidian.md/import/roam)
- [Import from HTML files](https://help.obsidian.md/import/html)
- [Import from Markdown files](https://help.obsidian.md/import/markdown)
- Import from Apple Journal (HTML export)

## Contributing

Importer is a community-led project. You can explore pull requests and see the credits below for reference. The Obsidian team is not actively working on adding new import capabilities, but we welcome pull requests for new formats and improvements.

Is a format missing? You can help! See our [Contribution guidelines](/CONTRIBUTING.md).

Some issues have been [tagged with #bounty](https://github.com/obsidianmd/obsidian-importer/labels/bounty).

## Developer guide: adding a new importer format

Every importer is a TypeScript class in `src/formats/` that extends `FormatImporter`. The modal calls three lifecycle methods in sequence:

```
init() → showTemplateConfiguration() [optional] → import()
```

### 1. Create the class

```ts
// src/formats/my-format.ts
import { FormatImporter } from '../format-importer';
import { ImportContext } from '../main';

export class MyFormatImporter extends FormatImporter {
    init(): void { /* register UI settings */ }
    async import(ctx: ImportContext): Promise<void> { /* convert files */ }
}
```

### 2. `init()` — declare settings UI

Called once when the user selects your format from the dropdown. Use the inherited helpers to add standard settings:

| Helper | Purpose |
|---|---|
| `addFileChooserSetting(name, extensions[], allowMultiple?)` | File/folder picker; populates `this.files` |
| `addOutputLocationSetting(defaultFolderName)` | Output folder input; populates `this.outputLocation` |

Add any additional format-specific settings via the Obsidian `Setting` API on `this.modal.contentEl`.

### 3. `showTemplateConfiguration()` — optional pre-import step

Override this to show a configuration UI before import begins (e.g. column mapping for tabular data). Return `null` to skip, `true` to proceed, or `false` to cancel.

For structured/tabular formats, use the built-in `TemplateConfigurator` from `src/template.ts`:

```ts
import { TemplateConfigurator, applyTemplate, generateFrontmatter } from '../template';

async showTemplateConfiguration(ctx: ImportContext, container: HTMLElement): Promise<boolean | null> {
    const configurator = new TemplateConfigurator({
        fields: myFields,   // { id, label, exampleValue }[]
        defaults: { titleTemplate: '{{Title}}', bodyTemplate: '{{Content}}' },
        placeholderSyntax: '{{field_name}}',
    });
    this.config = await configurator.show(container);
    return this.config !== null;
}
```

`applyTemplate(template, data)` replaces `{{fieldName}}` placeholders. `generateFrontmatter(data, propertyNames, propertyValues)` produces YAML frontmatter.

### 4. `import(ctx)` — perform the conversion

**`ImportContext` methods:**

| Method | When to call |
|---|---|
| `ctx.status(message)` | Update the status line with the current file/task |
| `ctx.reportProgress(current, total)` | Update the progress bar |
| `ctx.reportNoteSuccess(name)` | A note was successfully imported |
| `ctx.reportAttachmentSuccess(name)` | An attachment was successfully imported |
| `ctx.reportSkipped(name, reason?)` | A file was intentionally skipped |
| `ctx.reportFailed(name, reason?)` | A file failed to import |
| `ctx.isCancelled()` | Returns `true` if the user clicked Stop — check this in every loop |

**Vault helpers (inherited from `FormatImporter`):**

| Method | Purpose |
|---|---|
| `getOutputFolder()` | Returns/creates the configured output `TFolder` |
| `saveAsMarkdownFile(folder, title, content)` | Creates a sanitized `.md` file in the vault |
| `createFolders(path)` | Recursively creates folders |
| `getAvailablePathForAttachment(filename, claimedPaths, sourcePath?)` | Deduplicates attachment filenames respecting vault settings |

**Minimal `import()` skeleton:**

```ts
async import(ctx: ImportContext): Promise<void> {
    const { files } = this;
    if (files.length === 0) { new Notice('Please pick at least one file.'); return; }

    const folder = await this.getOutputFolder();
    if (!folder) { new Notice('Please select an output location.'); return; }

    ctx.reportProgress(0, files.length);
    for (let i = 0; i < files.length; i++) {
        if (ctx.isCancelled()) return;
        const file = files[i];
        ctx.status('Processing ' + file.name);
        try {
            const raw = await file.readText(); // or file.read() for binary
            const mdContent = convertToMarkdown(raw); // your conversion logic
            await this.saveAsMarkdownFile(folder, file.basename, mdContent);
            ctx.reportNoteSuccess(file.fullpath);
        }
        catch (e) { ctx.reportFailed(file.fullpath, e); }
        ctx.reportProgress(i + 1, files.length);
    }
}
```

### 5. Reading input files (`PickedFile` API)

`this.files` is a `PickedFile[]` — a platform-agnostic interface that works on both desktop (Electron/Node) and mobile (browser File API):

| Member | Type | Description |
|---|---|---|
| `file.name` | `string` | Full filename with extension |
| `file.basename` | `string` | Filename without extension |
| `file.extension` | `string` | Lowercase extension without dot |
| `file.readText()` | `Promise<string>` | Read as UTF-8 text |
| `file.read()` | `Promise<ArrayBuffer>` | Read as binary |
| `file.readZip(callback)` | `Promise<void>` | Open as ZIP archive via `@zip.js/zip.js` |

### 6. Utility functions

From `src/util.ts`:

| Function | Purpose |
|---|---|
| `sanitizeFileName(name)` | Strip illegal filename characters; returns `'Untitled'` if empty |
| `parseHTML(html)` | Parse an HTML string into a `HTMLElement` DOM |
| `serializeFrontMatter(cache)` | Serialize an object as YAML frontmatter with `---` delimiters |
| `extractErrorMessage(error)` | Safely extract `.message` from any thrown value |

From `src/filesystem.ts` — Node.js modules are available as `fs`, `fsPromises`, `path`, `os`, `zlib` but are `null` on mobile. Always guard with `Platform.isDesktopApp`.

### 7. OAuth / API-based importers

For formats requiring OAuth, use the `obsidian://importer-auth/` URI scheme:

```ts
import { AUTH_REDIRECT_URI } from '../main';

this.registerAuthCallback((data) => {
    const token = data.token; // OAuth response parameters
});
window.open(`https://provider.com/oauth?redirect_uri=${AUTH_REDIRECT_URI}`);
```

The callback is cleared after being called and must be re-registered for subsequent auth events.

### 8. Register in `main.ts`

```ts
// 1. Import at the top of main.ts
import { MyFormatImporter } from './formats/my-format';

// 2. Add to this.importers = { ... } inside onload()
'my-format': {
    name: 'My Format',
    optionText: 'My Format (.myfmt)',
    importer: MyFormatImporter,
    helpPermalink: 'import/my-format',       // optional
    formatDescription: 'Brief description.', // optional
},
```

### Data flow

```
User clicks "Import"
        │
        ▼
  showTemplateConfiguration(ctx, container)
  returns null (skip) / true (proceed) / false (abort)
        │
        ▼
  ImportContext created, progress UI shown
        │
        ▼
  import(ctx) called
        │
        ├── this.files          ← PickedFile[] from file picker
        ├── getOutputFolder()   ← TFolder (created if missing)
        │
        └── for each file:
              file.readText() / file.read() / file.readZip()
              [format-specific conversion]
              saveAsMarkdownFile(folder, title, mdContent)
              getAvailablePathForAttachment(...)  ← for attachments
              ctx.report{NoteSuccess,Failed,Skipped,AttachmentSuccess}()
              ctx.reportProgress(i, total)
              ctx.isCancelled() → return if true
        │
        ▼
  "Import more" / "Done" buttons shown
```

### Code standards

- TypeScript only; no raw `node:` imports — use the wrappers in `src/filesystem.ts`
- Avoid heavy dependencies — keep the bundle small
- Process files sequentially — avoid concurrency to prevent memory issues
- Performance-aware: vaults may contain 100,000+ notes
- Check `ctx.isCancelled()` at the start of every loop iteration

## Credits

This plugin relies on important contributions:

- [@akosbalasko](https://github.com/akosbalasko) for Evernote import via [Yarle](https://github.com/akosbalasko/yarle) (MIT)
- [@daledesilva](https://github.com/daledesilva) for Google Keep import
- [@arthurtyukayev](https://github.com/arthurtyukayev) for Bear import
- [@xheldon](https://github.com/Xheldon) for Notion API import
- [@joshuatazrein](https://github.com/joshuatazrein) for Notion file-based import
- [@polyipseity](https://github.com/polyipseity) for HTML attachments
- [@8bitgentleman](https://github.com/8bitgentleman) for Roam import
- [@p3rid0t](https://github.com/p3rid0t) for Microsoft OneNote import
- [@mirnovov](https://github.com/mirnovov) for Apple Notes import
- [@wzs](https://github.com/wzs) for Apple Journal import
