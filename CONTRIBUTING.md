## Contribution guide

You can create a new importer by adding a class under the `formats` folder that implements the `FormatImporter` class.

If you need to add settings, add the setting UI to `this.modal.contentEl` like how you would add them to a plugin. After you're done, simply add your importer to `ImporterPlugin.importers` in `main.ts`.

Please refrain from using NodeJS or Electron imports. If you must use Node's `fs` or `path` modules, please import them from `filesystem.ts` instead of directly from node. This makes it a soft-dependency that will resolve to null at runtime on mobile. For all other Node imports, please use the following

```ts
import type * as NodeModuleName from 'node:modulename';

const modulename: typeof NodeModuleName = Platform.isDesktopApp ? window.require('node:modulename') : null;
```

We're still experimenting with contributions, if you have any questions, please hop onto the [#importer thread under #plugin-dev channel](https://discord.com/channels/686053708261228577/1133074995271188520) on our Discord.

### Code standards

- Follow our [Plugin guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines).
- Your contribution must be implemented in TypeScript.
- Keep it lightweight. The fewer the dependencies, the better. For example, please do not import `lodash` to use two functions from it.
- Your code should be self-explanatory. Class and function names should explain most things, but you should add comments for anything non-obvious. Also add examples in your comments to describe any unusual conversion that has to be done.
- Be performance minded. Your code will be used in vaults with 10,000 or even 100,000 notes.
- Text the user will read belongs in `src/i18n/en.ts`, not in a string literal at the call site. See [Localization](#localization).
- Avoid concurrency. It's easy to accidentally run out of memory when using concurrent processing in JavaScript. This also avoids making the code complicated and difficult to follow due to the mapping of promises.

### Localization

The importer is translated into every language Obsidian Help publishes. Both halves live in this repository: `src/i18n/en.ts` holds the English each string is written in, and `locale/*.txt` hold the translations.

#### Adding or changing a string

Text the reader sees goes in `src/i18n/en.ts` and is reached by the path it has there:

```ts
new Setting(contentEl).setName(i18n.output.nameDuplicates());
ctx.status(i18n.progress.statusStandardizing({ current, total }));
```

Then run `npm run locales`, which folds the new string into `locale/*.txt` and `src/i18n/locales.ts`. Commit what it writes — the test suite fails otherwise, so a string cannot ship with nowhere to translate it.

Some text stays in English on purpose: console messages, and anything written into a note, such as a title, a folder name or a property. A note has to read the same whoever imported it.

Two strings that meet on screen each need their own key. Interpolating an identifier into a sentence leaves English inside a translated one, and a name dropped into a sentence carries whatever article its language needs — French writes *du paragraphe* but *de la colonne*, and the sentence around it cannot know the gender of the noun arriving.

`locale/README.md` covers the rest: placeholders, plural forms, and why some strings end in a space.

#### Correcting a translation

The translations are machine-generated, so a correction from someone who speaks the language is the most valuable thing you can send — including a one-line fix.

`locale/<language>.txt` is plain text, one block per string:

```
[modal.button-done]
original=Done
translation=Terminer
```

Edit the `translation=` line and leave `original=` alone. It records the English the translation was made from, so when the English changes you see it move in the diff, which is your signal that the line below it needs another look.

Run `npm run locales` before opening the pull request and commit what it writes, including `src/i18n/locales.ts` — that generated file is what the plugin actually ships, and the tests check the two agree. Never edit it by hand, or `locale/en.txt`, which is generated too.

Your correction stays put. When the English changes, an action asks a model only for strings that are missing, whose English moved, or that fail a check; a line you have corrected is left alone.

A blank `translation=` falls back to English, so a partial translation is perfectly usable — and is the right thing for a string with nothing to translate, such as a product name.

### Bounties

Some issues have been [tagged with #bounty](https://github.com/obsidianmd/obsidian-importer/labels/bounty). We're looking for developers who have experience with the relevant import formats, and TypeScript/Obsidian development. How to claim a bounty:

1. **Apply for a bounty** — to apply reply to the issue with the following details:
	- 1-2 sentences about why you would be a good fit
	- 1-2 sentences about how you would approach the requirements
	- Links to code samples, e.g. Obsidian community contributions
2. **Receive assignment** — the bounty will be assigned to one developer. We will notify you on the issue if you are selected.
3. **Fork repo** — if you have questions during the development you can ask in the Obsidian Discord channel *#importer* (under #plugin-dev)
4. **Submit your PR** — submit your code within the bounty timeframe. If the timeframe elapses, the bounty will be reassigned to another developer.
5. **Pass code review** — your code must meet the requirements listed in the issue, and the code standards above
6. **Agree to CLA** — the [Contributor License Agreement](https://github.com/obsidianmd/obsidian-releases/blob/master/cla.md) grants Obsidian license to use your code.
7. **Merging and payment** — once your PR is merged, we will submit payment via [Obsidian Credit](https://obsidian.md/help/Licenses+and+payment/Obsidian+Credit), PayPal, GitHub Sponsors, Ko-Fi, or Buy Me a Coffee.
