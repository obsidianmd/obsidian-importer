# ENEX fixtures from Yarle

The Evernote conversion here started as [Yarle](https://github.com/akosbalasko/yarle),
and these are its test exports: the notes its author collected while working out
what Evernote actually emits - the styles, the list shapes, the link forms, the
note attributes.

They convert through our own conversion and settings, so what is recorded in
`expected/` is what this importer produces, not what Yarle does.

Taken from `test/data` at Yarle 6.17.0 (1ab3ef4), with one author address
replaced by a placeholder. Left behind: the fixtures for Yarle's
own options and output formats (templates, Tana, Logseq, Hepta, Zettelkasten),
and the megabyte web clips - a fixture nobody reads the recording of is not
worth its bytes.

Yarle is MIT licensed:

```
Copyright (c) 2018 Akos Balasko

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
