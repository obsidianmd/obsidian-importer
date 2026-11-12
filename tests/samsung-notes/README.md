# Samsung Notes fixtures

The `.sdocx` files come from the [SDOCX Compatibility Corpus](https://huggingface.co/datasets/twangodev/sdocx-compatibility) by twangodev, licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). They're unchanged; the corpus pairs each with the PDF Samsung Notes exported, which isn't copied here.

- `01-basic-formatting.sdocx` covers typed text: bold, italic, underline, strikethrough, headings, bullet, nested, and numbered lists, links, a table, and a code block.
- `03-image-placement.sdocx` places one PNG seven times in the text.
- `04-marker4-highlighter.sdocx` is mostly handwriting, which the importer reports instead of converting.

The corpus's `02-shapes-and-dot-calibration.sdocx` is left out because it's handwriting only, like 04, and 250 KB.
