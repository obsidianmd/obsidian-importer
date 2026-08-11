# OneNote fixture provenance

None of these files were authored here. Every one is copied unchanged from a
project that publishes it as test data, at a pinned commit, under a licence that
allows redistribution. The licence texts sit beside them.

A fixture is only an anchor if it is the same bytes the upstream assertions were
written against, so the SHA-256 of each is recorded below and checked by
`tests/onenote-file/fixtures.test.ts`.

## The `.one` sections — Apache Tika, Apache-2.0

Five sections copied from the Apache Tika test corpus at commit
`63e22d08ef249cc73a6d02da7bc199fc3623a607`, upstream path:

`tika-parsers/tika-parsers-standard/tika-parsers-standard-modules/tika-parser-microsoft-module/src/test/resources/test-documents/`

`LICENSE-APACHE-2.0.txt` and `NOTICE.txt` carry the redistribution terms and the
Tika attribution. These are test inputs only; no Tika parser code is used here.

They matter because they cover both packagings. `testOneNote2016.one` is a
desktop-authored revision store; the two `testOneNoteFromOffice365*.one` are
FSSHTTP-packaged, which is the only shape `onenote.rs` can read.

## The ink section — onenote.rs, MPL-2.0

`handwriting_recognition.one` is copied from the `onenote.rs` corpus at commit
`5138a39a3f4e72b840932f9872fecde52fa9da60`, path
`crates/parser/tests/samples/handwriting_recognition.one`. `LICENSE-MPL-2.0.txt`
retains that licence. Test input only; no `onenote.rs` code is used here.

Samples under that project's `joplin/` directory are deliberately not copied —
they carry AGPL-3.0-or-later terms, which is not a licence this repository can
take test data under.

## The Cabinet oracles — OfficeIMO, MIT

The `makecab-*` files come from `OfficeIMO.OneNote.Tests/Fixtures/`
(github.com/EvotecIT/OfficeIMO, MIT). They are what makes the LZX port
checkable against something other than its own output: each was produced by the
Windows `makecab` utility, so expanding one and getting the source bytes back
proves agreement with Microsoft's compressor rather than with a recording.

- `makecab-lzx-testOneNote2016.cab` and `makecab-lzx-testOneNoteFromOffice365-2.cab`
  expand to the identically-named `.one` fixtures, byte for byte.
- `makecab-lzx{,15,16,17,18,19,20}-e8.cab` hold a deterministic 4,096-byte
  pattern containing three x86 `E8` relative-call sequences, at every Cabinet
  window size from 15 to 21 bits. They cover E8 postprocessing across the whole
  supported range; the test rebuilds the expected bytes rather than storing a
  second copy.
- `makecab-lzx-notebook.onepkg` is a small notebook packaged with `makecab`,
  exercising the `.onetoc2` plus `.one` path through the package reader. Its
  contents were authored by OfficeIMO's writer, so it anchors the container and
  not the semantics.

## Hashes

| File | Size | SHA-256 |
|---|---:|---|
| `testOneNote.one` | 30,288 | `b614dc94b890b53db7cb2d3053382cb398c59385533c256e2509850cc3247270` |
| `testOneNote2016.one` | 14,744 | `fcfc3c2e65482dc6f70f6a613b058e908f67db2ebb16a343bc2367e02bbb471c` |
| `testOneNoteEmbeddedWordDoc.one` | 33,096 | `cf38e39cb5ced46f377c832e5ff0fa5e789945930f77c294ba5e866429a2a028` |
| `testOneNoteFromOffice365.one` | 29,387 | `093f20ecb2196f8e6c07cfa6d7c7acb65a50ad3126a95444fe33086a37aaa4d5` |
| `testOneNoteFromOffice365-2.one` | 69,986 | `8cd245ed549043534118a00ce29715147c880c38ca88c3481acc19ae28e980c2` |
| `handwriting_recognition.one` | 180,020 | `2cff8769ccf0af6209d96d5e0650661077edba2d2bae4e4aa691f06caea35456` |
