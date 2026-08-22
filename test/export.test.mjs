import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse, serialise, hashFor } from '../src/format.js';
import { withEdits, exportSource, filenameFor } from '../src/export.js';

// Export is the exit from Explore mode: the reader leaves with a real file
// rather than work that lives in a page and dies with it (docs/modes.md §3).
// These tests are mostly about one thing — that the file cannot claim more than
// it knows.

const SOURCE = readFileSync(new URL('../notebooks/ch04-cut.prolog.md', import.meta.url), 'utf8');
const chapter = () => parse(SOURCE);

test('an untouched notebook exports as the bytes it came from', () => {
  // The canonical round-trip, through the export path rather than around it.
  assert.equal(exportSource(chapter(), new Map()), SOURCE);
});

test("a reader's program reaches the file", () => {
  const out = exportSource(chapter(), new Map([['p-fixes', { source: 'son_c(X) :- male(X).' }]]));
  assert.match(out, /son_c\(X\) :- male\(X\)\./);
});

test("a reader's answers serialise, and parse back as answers", () => {
  // The regression this file exists for. An output is more than its solutions —
  // it carries the fence's language and the author's attributes, and serialise()
  // iterates them. Answers built by the browser rather than by the parser were
  // missing that shape, and every export after a Run threw a TypeError instead
  // of producing a file. Nothing serialised a reader-shaped output until now.
  const edits = new Map([['q-son-a', {
    goal: 'son_a(X)',
    output: { solutions: ['X = edward', 'X = alfred'], terminator: 'X = george.' },
  }]]);
  const text = exportSource(chapter(), edits);
  const reparsed = parse(text);
  const cell = reparsed.cells.find((c) => c.id === 'q-son-a');
  assert.deepEqual(cell.output.solutions, ['X = edward', 'X = alfred']);
  assert.equal(cell.output.terminator, 'X = george.');
});

test('a query the reader half-ran exports with no answers at all', () => {
  // A partial sequence has no honest terminator: writing one would claim the
  // search was exhausted when the reader stopped it after two of six. A query
  // cell with no output block is already valid, and says the true thing.
  const text = exportSource(chapter(), new Map([['q-son-a', { goal: 'son_a(X)', output: null }]]));
  const reparsed = parse(text);
  assert.equal(reparsed.cells.find((c) => c.id === 'q-son-a').output, null);
  // and its neighbours are untouched
  assert.ok(reparsed.cells.find((c) => c.id === 'q-son-b').output);
});

test("the author's answers keep the author's hash", () => {
  // THE RULE. The reader edits a program and downloads without re-running: the
  // answers below are still the chapter's, so they keep the chapter's hash, and
  // the file opens with them marked stale — which is exactly what the page they
  // downloaded it from was showing. Rehashing them would certify the author's
  // answers as following from the reader's program.
  const before = chapter().cells.find((c) => c.id === 'q-son-b').output.inputHash;
  const text = exportSource(chapter(), new Map([['p-fixes', { source: 'x(1).' }]]));
  const after = parse(text).cells.find((c) => c.id === 'q-son-b').output.inputHash;
  assert.equal(after, before, 'an untouched output must not be re-certified');
});

test("the reader's own answers are hashed against the reader's program", () => {
  const edits = new Map([
    ['p-fixes', { source: 'son_a(X) :- male(X).' }],
    ['q-son-a', { goal: 'son_a(X)', output: { solutions: [], terminator: 'X = albert.' } }],
  ]);
  const text = exportSource(chapter(), edits);
  const reparsed = parse(text);
  const cell = reparsed.cells.find((c) => c.id === 'q-son-a');
  const published = chapter().cells.find((c) => c.id === 'q-son-a');
  assert.notEqual(cell.output.inputHash, published.output.inputHash);
  // Fresh, not stale: the file says these answers follow from the program in it,
  // and on reload the renderer agrees.
  assert.equal(cell.output.inputHash, hashFor(reparsed, cell));
});

test('withEdits does not mutate the notebook it was given', () => {
  // The model is the published chapter; an export is a view of it. Mutating it
  // would make the second download differ from the first for no reason a reader
  // could see.
  const notebook = chapter();
  const before = serialise(notebook);
  withEdits(notebook, new Map([
    ['p-fixes', { source: 'x(1).' }],
    ['q-son-a', { goal: 'son_a(X)', output: { solutions: [], terminator: 'true.' } }],
  ]));
  assert.equal(serialise(notebook), before);
});

test('the filename comes from the source, not the title', () => {
  assert.equal(filenameFor('../notebooks/ch04-cut.prolog.md'), 'ch04-cut.prolog.md');
  assert.equal(filenameFor('/a/b/c.prolog.md?v=2#top'), 'c.prolog.md');
  assert.equal(filenameFor(''), 'notebook.prolog.md');
});
