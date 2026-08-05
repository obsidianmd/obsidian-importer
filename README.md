![Obsidian Importer screenshot](/images/social.png)

This Obsidian plugin allows you to import notes from other apps and file formats into your Obsidian vault. Notes are converted to plain text Markdown files.

## Get started

Install Importer in Obsidian → Community Plugins.

Import guides are hosted on the [official Obsidian Help site](https://help.obsidian.md/import). You can help contribute to the guides on the [obsidian-help](https://github.com/obsidianmd/obsidian-help) repo.

- [Import from Apple Notes](https://help.obsidian.md/import/apple-notes)
- [Import from Bear](https://help.obsidian.md/import/bear)
- Import from Airtable (API)
- [Import from CSV files](https://help.obsidian.md/import/csv)
- [Import from Evernote](https://help.obsidian.md/import/evernote)
- [Import from Google Keep](https://help.obsidian.md/import/google-keep)
- [Import from Microsoft OneNote](https://help.obsidian.md/import/onenote)
- [Import from Notion](https://help.obsidian.md/import/notion)
- [Import from Roam Research](https://help.obsidian.md/import/roam)
- [Import from HTML files](https://help.obsidian.md/import/html)
- [Import from Markdown files](https://help.obsidian.md/import/markdown)
- Import from Apple Journal (HTML export)
- Import from Textbundle (.textbundle, .textpack)
- Import from Tomboy/Gnote (.note)

## Developers

```bash
npm install
npm run dev      # build, copy into a vault, reload the plugin
npm test         # convert every fixture and compare against its recording
npm run build    # typecheck and build for release
```

Set `OBSIDIAN_PATH` in `.env` to the plugin folder `npm run dev` should copy into,
relative to your home directory:

```
OBSIDIAN_PATH='/Documents/MyVault/.obsidian/plugins'
```

### Tests

Each importer is tested by converting a real file and comparing the result with
an output recorded beside it:

```
tests/notion/notion-testspace.zip           a fixture
tests/notion/expected/notion-testspace/…    what converting it produces
tests/notion/local/                         gitignored, for a file that cannot be committed
```

Run one importer's tests while working on it:

```bash
npm test -- notion
```

To record a new fixture's output, or update one after an intended change:

```bash
UPDATE_EXPECTED=1 npm test -- notion
```

That writes the output and then fails on purpose. Read what it wrote — `git diff`
if it already existed — before committing it. A recording nobody reads is not a
test.

Debugging an issue someone reported? Drop their export in `tests/<importer>/local/`.
It is gitignored, and so is the output recorded next to it, so you can work
against a real file without committing it.

### Testing against a live API

Airtable and Notion's API importers have no export file to use as a fixture, so
their fixtures are saved API responses. Those go stale quietly, so each has a
check that asks the real API whether its responses still have the shape the
fixture assumes. They skip unless a token is set in `.env`:

```
AIRTABLE_TOKEN=pat...
NOTION_TOKEN=ntn_...
```

These only read.

### Testing against Obsidian itself

`npm test` runs the conversions outside Obsidian, against a small stand-in for
its API in `tests/shims/`. To check that stand-in still agrees with the app:

```bash
npm run e2e
```

This imports fixtures through the running app — its `htmlToMarkdown`, its vault,
its link settings — and compares what lands in the vault with what `npm test`
recorded. It needs the [Obsidian CLI](https://help.obsidian.md/cli) and a build
of your working copy installed in the active vault. It writes one folder and
deletes it afterwards.

More detail, including how each importer is split so its conversion can run
without a vault, is in [CLAUDE.md](/CLAUDE.md).

## Contributing

Importer is a community-led project. You can explore pull requests and see the credits below for reference. The Obsidian team is not actively working on adding new import capabilities, but we welcome pull requests for new formats and improvements.

Is a format missing? You can help! See our [Contribution guidelines](/CONTRIBUTING.md).

Some issues have been [tagged with #bounty](https://github.com/obsidianmd/obsidian-importer/labels/bounty).

## Credits

This plugin relies on important contributions:

- [@akosbalasko](https://github.com/akosbalasko) for Evernote import via [Yarle](https://github.com/akosbalasko/yarle) (MIT)
- [@daledesilva](https://github.com/daledesilva) for Google Keep import
- [@arthurtyukayev](https://github.com/arthurtyukayev) for Bear import
- [@xheldon](https://github.com/Xheldon) for Notion API import and Airtable import
- [@joshuatazrein](https://github.com/joshuatazrein) for Notion file-based import
- [@polyipseity](https://github.com/polyipseity) for HTML attachments
- [@8bitgentleman](https://github.com/8bitgentleman) for Roam import
- [@p3rid0t](https://github.com/p3rid0t) for Microsoft OneNote import
- [@mirnovov](https://github.com/mirnovov) for Apple Notes import
- [@wzs](https://github.com/wzs) for Apple Journal import
