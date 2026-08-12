# Roam fixtures

`help-graph-excerpt.json` is seventeen pages taken from Roam Research's public
Help graph, chosen so that between them they use every piece of Roam markup the
converter rewrites: TODO and DONE, `__italic__`, `^^highlight^^`, block
references and aliases, embeds, attributes, tables, code blocks, LaTeX, video
and tweet embeds, namespaced page titles, and daily notes.

It is an excerpt rather than the whole graph, which was 1,107 pages and 1.8 MB.
That graph was converted on every run but never recorded, so it only ever
caught a page that threw. Seventeen pages are small enough to record, which
checks what the conversion produces rather than only that it finished.

Anonymised: people named in the original are replaced with invented names,
account ids, storage tokens, and video and tweet ids with placeholders.
Organisations and product names are kept - they are not personal data, and how
`[[Roam Research]]` converts is part of what these recordings check.

`small-test-graph.json` is one page of theme-testing markup, contributed with
the importer.

`shapes.json` is written rather than exported, and covers what the two real
graphs cannot. An excerpt only holds what its pages happened to use, and every
block reference and embed in these two points at a block on a page that was
left out - so the recordings showed refs to nowhere, and nothing checked what a
resolved one looks like. Here both ends are present.

It is a page per thing that broke, so a failure names itself:

- `Sapiens`, `Dune` - attributes at the top of a page, which become properties;
  one nested and one with children, which stay in the outline (#245)
- `References` - a block referred to twice, an aliased reference, a reference
  standing after a `{{[[TODO]]}}`, `((a parenthetical))` that is nobody's id,
  and a reference to a block that is not in the graph (#247)
- `Embeds` - a block embed whose block has children, both spellings of it,
  `embed-path`, an embedded page, and an embed of a block that is missing (#246)
- `Source` - what those two point at, including a block of several lines, which
  is where an anchor cannot go on the end
- `Tables` - a cell covering several rows, a row that stops short, markup and a
  pipe in a cell, a marker with no rows, and an unbalanced `{{[[table}}` (#180)
- `Queries` - `and`, `or`, `not`, a nested clause, the `{between:}` that has no
  counterpart, and one written as an example inside backticks (#180)
- `Headings` - a heading whose children are a list, one whose child is a lone
  paragraph, and one whose body is another heading, which is what flattening
  has to tell apart
- `Colliding [name]`, `Colliding name` - two titles that sanitise to one file
  name, which used to leave one page written over by the other
- `roam/css`, `January 1st, 2021` - a title that makes a folder, and a daily
  note, both of which a link has to name the way the note was written

Nothing in it is anyone's data: the names are invented and the block ids are
words rather than Roam's.

It is recorded twice, in `expected/shapes/` as the outline Roam kept and in
`expected/shapes-flat/` with the outline flattened, so the difference the
setting makes is a diff rather than a description.

## Whole graphs, in local/

Two are worth converting but not recording, so they go in the gitignored
`local/` and are counted rather than compared:

- `help-graph-full.json` - the 1,107-page Help graph the excerpt was cut from
- `roam-to-git-demo.json` - the public roam-to-git demo graph, 1,864 pages

Neither is much use as a *recording*: the demo graph is 1,864 pages holding 196
blocks, nearly all of them empty daily notes, with no table, kanban or query in
it. What they are good for is a page shape that throws, which is what found the
250-character page title that a link could not reach.

Anonymised on the way in: storage tokens and any address are replaced. Both
were published by their authors as demonstrations.
