![Obsidian Importer screenshot](/images/social.png)

This Obsidian plugin allows you to import notes from other apps and file formats into your Obsidian vault. Notes are converted to plain text Markdown files.

## Supported formats

Currently supports HTML files and Evernote `.enex` with more formats in progress. You can help! See our [Contribution guidelines](/CONTRIBUTING.md).

Planned formats:

- [x] Evernote `.enex` (powered by [Yarle](https://github.com/akosbalasko/yarle))
- [x] HTML, folder of files
- [ ] Notion
- [ ] Apple Notes
- [ ] Microsoft OneNote
- [ ] Google Keep
- [ ] Roam Research
- [ ] Other Markdown flavors

## Usage

First install Importer in Obsidian → Community Plugins

### Import notes from Evernote

- Export your Evernote files to `.enex` format. You can export a whole notebook in the desktop client by going to the Notebooks screen, click on **More actions** (`...` icon) and choose **Export Notebook...**
- Open the **Importer** plugin in Obsidian via the command palette or ribbon icon
- Under **File format** select **Evernote (.enex)**
- Choose the `.enex` file you want to import
- Optionally, select a folder for the import — your Markdown files will be created in this folder within your vault.
- Click **Import**

Currently, the import does not have any special settings, if you want more control over the output, consider using [Yarle](https://github.com/akosbalasko/yarle).

![Obsidian Importer screenshot](/images/screenshot.png)

## Contributing

This repo accepts contributions. Some issues have been [tagged with #bounty](https://github.com/obsidianmd/obsidian-importer/labels/bounty). See [Contribution guidelines](/CONTRIBUTING.md) for more information.

## Credits

This plugin relies on important contributions:

- [Yarle](https://github.com/akosbalasko/yarle) (MIT) by [@akosbalasko](https://github.com/akosbalasko) is used for `.enex` conversion, [support his work](https://www.buymeacoffee.com/akosbalasko)
