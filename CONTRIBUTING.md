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
- Avoid concurrency. It's easy to accidentally run out of memory when using concurrent processing in JavaScript. This also avoids making the code complicated and difficult to follow due to the mapping of promises.

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
7. **Merging and payment** — once your PR is merged, we will submit payment via [Obsidian Credit](https://help.obsidian.md/Licenses+and+payment/Obsidian+Credit), PayPal, GitHub Sponsors, Ko-Fi, or Buy Me a Coffee.
