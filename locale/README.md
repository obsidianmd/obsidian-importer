# Translating the importer

Every piece of text the importer puts on screen lives in one of these files. The
format is the one used by [obsidian-translations](https://github.com/obsidianmd/obsidian-translations),
so if you have translated Obsidian itself, this will look familiar.

## Adding a language

Importer targets every language published by
[obsidian-help](https://github.com/obsidianmd/obsidian-help). The localization
workflow discovers that list, so a new Help language is picked up on its next
run. To add or edit one by hand:

1. Copy `en.txt` to `<language code>.txt` — `de.txt`, `pt-BR.txt`, and so on.
2. Fill in the `translation=` lines.
3. Run `npm run locales`. That folds your file into the plugin's bundled string
   data and refreshes the `original=` lines. Commit what it writes.

A regional code falls back to its base language, so `pt-BR` is used for a reader
set to `pt-BR`, and `pt` covers the rest.

## Automated updates

When English strings change on `master`, the `Localize` GitHub Action updates a
single `automation/importer-locales` pull request. It runs once per language in
parallel, preserves translations whose English source did not change, and then
validates and bundles the results.

The Action follows the same sources as Obsidian Help:

- `obsidian-help/scripts/locales.json` is the list of supported languages.
- `obsidian-translations/terms.txt` supplies important product terms.
- `obsidian-translations/translations/<language>.txt` supplies exact wording
  already used in the Obsidian app.

Set the repository secret `ANTHROPIC_API_KEY` before running the workflow. The
repository must also allow GitHub Actions to create pull requests. A manual run
bootstraps newly added locales; its optional `from_ref` input can force every
English string changed since that ref to be translated again.

For a local preview, keep `obsidian-help` and `obsidian-translations` beside this
repository and run:

```
pnpm translate-locales de --dry-run
```

## Translating

Each block is one string:

```
[modal.button-done]
original=Done
translation=
```

Write your translation after `translation=`:

```
[modal.button-done]
original=Done
translation=Terminer
```

The key in brackets says where the text appears. `original=` is the English it
was written from — leave it alone; the generator keeps it in step, and when the
English changes you will see it change in the diff, which is your signal that
the translation below it needs another look.

A block you leave empty falls back to English, so a partial translation is
perfectly usable. That is also the right thing to do for a string with nothing
to translate — a product name like `Bear`, or a line that is only punctuation.

### Placeholders

```
[modal.title-import-from]
original=Import from {{format}}
translation=Importer depuis {{format}}
```

`{{format}}` is replaced when the plugin runs. Move it wherever your language
needs it, but do not rename or drop it — the name inside the braces is not text.

A few strings mention `{{field_name}}`. That one is different: it is showing the
reader what to type, so leave it exactly as it is.

### Counted things

A key ending `_plural` is used whenever the count is anything but 1:

```
[nouns.note-with-count]
original={{count}} note
translation={{count}} note

[nouns.note-with-count_plural]
original={{count}} notes
translation={{count}} notes
```

There are only these two forms. If your language has more, pick the one that
reads best for the general case.

Translate both or neither. A singular with no plural beside it means a count in
your language and a count in English can appear in the same sentence, which the
test suite will refuse.

### Spacing at the ends

Some strings end with a space because something else follows them on screen — a
link, or a file name. Keep whatever spacing the `original=` line has at either
end; if your editor trims trailing whitespace on save, turn that off for these
files. The test suite compares the two, so a lost space is caught rather than
shipped.

### Newlines

A string that spans lines carries `\n` inside it, because a block is read line
by line. Keep them.

## What is not here

Messages that only reach the developer console, and text written into the notes
an import creates. A note has to read the same whoever imported it, so its
contents stay in the source language.
