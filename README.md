![Obsidian Importer screenshot](/images/social.png)

This Obsidian plugin allows you to import notes from other apps and file formats into your Obsidian vault. Notes are converted to plain text Markdown files.

## Supported formats

Currently supports import from Evernote `.enex` with more formats to be added later.

Planned formats:

- [x] Evernote `.enex` (powered by [Yarle](https://github.com/akosbalasko/yarle))
- [ ] HTML, folder of files
- [ ] Notion
- [ ] Apple Notes

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

## Contribution guide

You can create a new importer by adding a class under the `formats` folder that implements the `FormatImporter` class.

If you need to add settings, add the setting UI to `this.modal.contentEl` like how you would add them to a plugin. After you're done, simply add your importer to `ImporterPlugin.importers` in `main.ts`.

We're still experimenting with contributions, if you have any questions, please hop onto the [#importer thread under #plugin-dev channel](https://discord.com/channels/686053708261228577/1133074995271188520) on our Discord.

## Credits

This plugin relies on important contributions:

- [Yarle](https://github.com/akosbalasko/yarle) (MIT) by [@akosbalasko](https://github.com/akosbalasko) is used for `.enex` conversion, [support his work](https://www.buymeacoffee.com/akosbalasko)
