# Translating the importer

Every piece of text the importer puts on screen lives in one of these files. The
format is the one used by [obsidian-translations](https://github.com/obsidianmd/obsidian-translations),
so if you have translated Obsidian itself, this will look familiar.

## Adding a language

1. Copy `en.txt` to `<language code>.txt`, using the
   [ISO 639-1 code](https://en.wikipedia.org/wiki/List_of_ISO_639-1_codes) for
   your language — `de.txt`, `pt-BR.txt`, and so on.
2. Fill in the `translation=` lines.
3. Run `npm run locales`. That folds your file into the plugin's bundled string
   data and refreshes the `original=` lines. Commit what it writes.

A regional code falls back to its base language, so `pt-BR` is used for a reader
set to `pt-BR`, and `pt` covers the rest.

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
translation=Terminé
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

### Newlines

A string that spans lines carries `\n` inside it, because a block is read line
by line. Keep them.

## What is not here

Messages that only reach the developer console, and text written into the notes
an import creates. A note has to read the same whoever imported it, so its
contents stay in the source language.
