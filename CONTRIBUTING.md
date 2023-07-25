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

Some issues have been [tagged with #bounty](https://github.com/obsidianmd/obsidian-importer/labels/bounty). How to claim a bounty:

1. **Apply for a bounty** — to apply reply to the issue with a 1-2 sentence description of why you would be a good fit, and links to code samples (e.g. Obsidian community plugins)
2. **Receive assignment** — the bounty will be assigned to one developer. We will notify you on the issue if you are selected.
3. **Fork repo** — if you have questions during the development you can ask in the Obsidian Discord channel *#importer* (under #plugin-dev)
4. **Submit your PR** — submit your code within the bounty timeframe. If the timeframe elapses, the bounty will be reassigned to another developer.
5. **Pass code review** — your code must meet the requirements listed in the issue, and the code standards above
6. **Merging and payment** — once your PR is merged, we will submit payment via PayPal, GitHub Sponsors, Ko-Fi, or Buy Me a Coffee.
