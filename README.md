![Obsidian Importer screenshot](/images/social.png)

This Obsidian plugin allows you to import notes from other apps and file formats into your Obsidian vault. Notes are converted to plain text Markdown files.

## Supported formats

Currently supports import from Evernote `.enex` with more formats to be added. You can help — see contribution guide below.

Planned formats:

- [x] Evernote `.enex` (powered by [Yarle](https://github.com/akosbalasko/yarle))
- [ ] HTML, folder of files
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

## Contribution guide

You can create a new importer by adding a class under the `formats` folder that implements the `FormatImporter` class.

If you need to add settings, add the setting UI to `this.modal.contentEl` like how you would add them to a plugin. After you're done, simply add your importer to `ImporterPlugin.importers` in `main.ts`.

We're still experimenting with contributions, if you have any questions, please hop onto the [#importer thread under #plugin-dev channel](https://discord.com/channels/686053708261228577/1133074995271188520) on our Discord.

### Code standards

- Follow our [Plugin guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines).
- Your contribution needs to be implemented in TypeScript.
- Lightweight - the fewer the dependencies, the better. For example, if you import `lodash` and only use two functions don't it, re-consider.
- Be extremely performance minded. Your code might be used in vaults with 10,000 or even 100,000 notes.
- Your code should be self-explanatory. There's no need to over-comment your code, class names and function names should explain most things. Reserve comments for unusual situations and avoid commenting for the sake of commenting.

### Bounties

Some issues have been [tagged with #bounty](https://github.com/obsidianmd/obsidian-importer/labels/bounty)

1. **Apply for a bounty** — to apply reply to the issue with a 1-2 sentence description of why you would be a good fit, and links to code samples (e.g. Obsidian community plugins)
2. **Receive assignment** — the bounty will be assigned to one developer. We will notify you on the issue if you are selected.
3. **Fork repo** — if you have questions during the development you can ask in the bounties channel on Obsidian Discord in *#importer* (under #plugin-dev)
4. **Submit your PR** — submit your code within the bounty timeframe. If the timeframe elapses, the bounty will be reassigned to another developer.
5. **Pass code review** — your code must meet the requirements listed in the issue, and the code standards above
6. **Merging and payment** — once your PR is merged, we will submit payment via PayPal, GitHub Sponsors, Ko-Fi, or Buy Me a Coffee.

## Credits

This plugin relies on important contributions:

- [Yarle](https://github.com/akosbalasko/yarle) (MIT) by [@akosbalasko](https://github.com/akosbalasko) is used for `.enex` conversion, [support his work](https://www.buymeacoffee.com/akosbalasko)
