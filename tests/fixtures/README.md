# Test Fixtures

This directory documents the fixture files available for testing the various importers.

## Directory Layout

Each subdirectory corresponds to an import format supported by obsidian-importer:

| Directory      | Format                      | File types                    |
|----------------|-----------------------------|-------------------------------|
| `bear/`        | Bear                        | `.bear2bk` archives           |
| `csv/`         | CSV                         | `.csv` files                  |
| `evernote/`    | Evernote (ENEX)             | `.enex` XML exports           |
| `html/`        | Generic HTML                | `.html` files + attachments   |
| `journal/`     | Apple Journal               | `.html` input, `.md` expected |
| `keep/`        | Google Keep                 | `.json` notes, `.zip` takeout |
| `notion/`      | Notion                      | `.zip` workspace export       |
| `roam/`        | Roam Research               | `.json` graph exports         |
| `textbundle/`  | TextBundle / TextPack       | `.textbundle`, `.textpack`    |
| `tomboy/`      | Tomboy / Gnote              | `.note` XML files             |

## Using Fixtures in Tests

### Reading fixture files

```ts
import { readFileSync } from 'fs';
import { resolve } from 'path';

const fixturePath = resolve(__dirname, '../evernote/test-file-with-many-dots.enex');
const content = readFileSync(fixturePath, 'utf-8');
```

### Snapshot testing pattern

For importer output validation, the recommended approach is **snapshot testing**.
Convert a fixture through the importer's parsing logic, then snapshot the result:

```ts
import { describe, it, expect } from 'vitest';

describe('Evernote ENEX parser', () => {
  it('matches snapshot for a basic note', () => {
    const enex = readFileSync(fixturePath, 'utf-8');
    const result = parseEnexNote(enex);
    expect(result).toMatchSnapshot();
  });
});
```

Snapshots are stored in `__snapshots__/` directories next to the test files.
Run `npx vitest run -u` to update snapshots after intentional changes.

### Fixture-driven test generation

You can use `describe.each` or loop over fixture files to auto-generate test
cases for every fixture in a directory:

```ts
import { readdirSync } from 'fs';

const fixtures = readdirSync(resolve(__dirname, '../tomboy'))
  .filter(f => f.endsWith('.note'));

describe.each(fixtures)('Tomboy note: %s', (filename) => {
  it('parses without throwing', () => {
    const xml = readFileSync(resolve(__dirname, '../tomboy', filename), 'utf-8');
    expect(() => parseTomboyNote(xml)).not.toThrow();
  });
});
```

## Adding New Fixtures

1. Place fixture files in the appropriate format directory.
2. Keep fixtures small and focused on specific edge cases.
3. Avoid including real user data — use synthetic test content.
4. If a format directory does not exist yet, create it and add a brief
   `README.md` (see `csv/README.md` for an example).
