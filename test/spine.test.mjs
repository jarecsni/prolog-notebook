import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  SPINE, SPINE_FORMAT, booksOf, chaptersOf, findSpine, isSpine,
  parseSpine, resolveSpine, seedSpine, withEntry,
} from '../src/spine.js';

// The spine: what a book contains, and in what order (869eu5tg1).
//
// resolveSpine reads the disk, so these tests write real files. They are stubs —
// nothing here parses a notebook, only decides whether one is there — which keeps
// the whole file fast enough to leave in `npm test`.

/** A directory tree from a {path: contents} map, and the path of the root spine. */
function project(files) {
  const where = mkdtempSync(join(tmpdir(), 'prolog-notebook-spine-'));
  for (const [path, contents] of Object.entries(files)) {
    const full = join(where, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, contents);
  }
  return where;
}

const spine = (body) => `---\nformat: ${SPINE_FORMAT}\n---\n\n${body}`;
const CHAPTER = '# A chapter\n';

test('the H1 is the title, and everything else keeps its order', () => {
  const { title, blocks } = parseSpine(spine(`# Prolog Studies

Working through the classics.

## Part I — Foundations
- [Lists](notes/lists.prolog.md)

## Appendices
- [Operators](notes/ops.prolog.md)
`));
  assert.equal(title, 'Prolog Studies');
  // Document order, prose and headings included: the contents page is a
  // rendering of this file, not a list extracted from it.
  assert.deepEqual(blocks.map((b) => b.kind),
    ['prose', 'heading', 'link', 'heading', 'link']);
  assert.deepEqual(blocks.filter((b) => b.kind === 'heading').map((b) => b.text),
    ['Part I — Foundations', 'Appendices']);
  assert.deepEqual(blocks.filter((b) => b.kind === 'link').map((b) => b.title),
    ['Lists', 'Operators']);
});

test('the format key is what identifies a spine, not the filename', () => {
  assert.ok(isSpine(spine('# Book\n')));
  assert.ok(!isSpine('# Just a readme\n'));
  assert.ok(!isSpine('---\nformat: prolog-notebook/1\n---\n\n# A notebook\n'));
  assert.throws(() => parseSpine('# Just a readme\n'), /must carry format/);
  assert.throws(() => parseSpine('---\nformat: prolog-notebook-book/9\n---\n\n# x\n'),
    /unrecognised book format/);
});

test('a chapter is published under its filename, wherever the file lives', () => {
  const where = project({
    [SPINE]: spine('# Studies\n\n- [The hole at the end](deeply/nested/lists.prolog.md)\n'),
    'deeply/nested/lists.prolog.md': CHAPTER,
  });
  const book = resolveSpine(join(where, SPINE));
  const [chapter] = chaptersOf(book);
  // URLS COME FROM THE BINDER, NOT THE DISK. Moving the source three directories
  // down does not move the page, which is what makes the source tree the
  // author's business and the URL the reader's.
  assert.equal(chapter.url, 'lists/');
  assert.equal(chapter.title, 'The hole at the end');
  assert.equal(book.url, '');
});

test('books hold books, and their chapters land underneath them', () => {
  const where = project({
    [SPINE]: spine(`# Prolog Studies

- [Bratko — Programming for AI](bratko/${SPINE})
- [Clocksin & Mellish](cm/${SPINE})
`),
    [`bratko/${SPINE}`]: spine('# Bratko\n\n- [Lists](lists.prolog.md)\n'),
    'bratko/lists.prolog.md': CHAPTER,
    [`cm/${SPINE}`]: spine(`# C&M\n\n- [Deeper still](inner/${SPINE})\n`),
    [`cm/inner/${SPINE}`]: spine('# Inner\n\n- [Lists](lists.prolog.md)\n'),
    'cm/inner/lists.prolog.md': CHAPTER,
  });
  const book = resolveSpine(join(where, SPINE));

  // No depth limit, and a book's segment is its directory: two chapters with the
  // same filename coexist because their books do.
  assert.deepEqual(chaptersOf(book).map((c) => c.url),
    ['bratko/lists/', 'cm/inner/lists/']);
  // One contents page per book, the root included.
  assert.deepEqual(booksOf(book).map((b) => b.url), ['', 'bratko/', 'cm/', 'cm/inner/']);
  // The link text names the book in ITS binder; the spine's own H1 is its title.
  const bratko = book.blocks.find((b) => b.kind === 'book');
  assert.equal(bratko.title, 'Bratko — Programming for AI');
});

test('the same chapter bound into two books is two pages, not an error', () => {
  const where = project({
    [SPINE]: spine(`# Studies\n\n- [As read](a/${SPINE})\n- [As taught](b/${SPINE})\n`),
    [`a/${SPINE}`]: spine('# A\n\n- [Lists](../notes/lists.prolog.md)\n'),
    [`b/${SPINE}`]: spine('# B\n\n- [Lists again](../notes/lists.prolog.md)\n'),
    'notes/lists.prolog.md': CHAPTER,
  });
  // THE BINDER PREMISE (binding.md §1): a notebook must be able to appear in more
  // than one book unchanged. Two bindings, two URLs, one source file.
  assert.deepEqual(chaptersOf(resolveSpine(join(where, SPINE))).map((c) => c.url),
    ['a/lists/', 'b/lists/']);
});

test('it refuses what it cannot publish', () => {
  const twice = project({
    [SPINE]: spine('# S\n\n- [Lists](l.prolog.md)\n- [Lists again](l.prolog.md)\n'),
    'l.prolog.md': CHAPTER,
  });
  assert.throws(() => resolveSpine(join(twice, SPINE)),
    /bound twice in this book.*first bound on line/s);

  // Different files, same basename, same book: silently one overwriting the
  // other is exactly the collision the flat page name used to allow.
  const collide = project({
    [SPINE]: spine('# S\n\n- [One](a/l.prolog.md)\n- [Two](b/l.prolog.md)\n'),
    'a/l.prolog.md': CHAPTER,
    'b/l.prolog.md': CHAPTER,
  });
  assert.throws(() => resolveSpine(join(collide, SPINE)), /both be published at \/l\//);

  const missing = project({ [SPINE]: spine('# S\n\n- [Gone](nope.prolog.md)\n') });
  assert.throws(() => resolveSpine(join(missing, SPINE)),
    /no such notebook — nope\.prolog\.md/);
});

test('a book cannot contain itself, however indirectly', () => {
  const where = project({
    [SPINE]: spine(`# Top\n\n- [Down](a/${SPINE})\n`),
    [`a/${SPINE}`]: spine(`# A\n\n- [Down again](../b/${SPINE})\n`),
    [`b/${SPINE}`]: spine(`# B\n\n- [Back to the top](../${SPINE})\n`),
  });
  // A cycle is reported by name. Recursion made this reachable, and a stack
  // overflow is not a message anybody can act on.
  assert.throws(() => resolveSpine(join(where, SPINE)), /a book cannot contain itself/);
});

test('a link to something that is not a notebook is just a link', () => {
  const where = project({
    [SPINE]: spine('# S\n\nSee [the notes](notes.md) and [the plan](plan.md).\n\n- [Lists](l.prolog.md)\n'),
    'notes.md': '# Some notes\n',
    'l.prolog.md': CHAPTER,
  });
  const book = resolveSpine(join(where, SPINE));
  // notes.md exists but is not a spine; plan.md does not exist at all. §3 says
  // prose may link to anything freely, so neither is this file's business.
  assert.equal(chaptersOf(book).length, 1);
  assert.equal(book.blocks.filter((b) => b.kind === 'book').length, 0);
});

test('it finds the book a chapter belongs to — the site\'s, not the nearest', () => {
  const where = project({
    '.git/HEAD': 'ref: refs/heads/main\n',
    [SPINE]: spine(`# S\n\n- [Bratko](bratko/${SPINE})\n`),
    [`bratko/${SPINE}`]: spine('# B\n\n- [Lists](lists.prolog.md)\n'),
    'bratko/lists.prolog.md': CHAPTER,
  });
  // A SITE HAS EXACTLY ONE SPINE. Bratko's is a sub-book, reached by being linked
  // from the site's — never by standing next to it. Walking up would find it
  // first and publish its chapter at /lists/ instead of /bratko/lists/,
  // duplicating a page the full build puts somewhere else.
  assert.equal(findSpine(join(where, 'bratko/lists.prolog.md')), join(where, SPINE));
  assert.equal(findSpine(join(where, 'bratko')), join(where, SPINE));
  assert.equal(findSpine(join(tmpdir(), 'nothing-here')), null);
});

test('a seeded spine is a spine, and gains entries without being rearranged', () => {
  const seeded = seedSpine({
    title: 'Prolog Studies',
    entries: [{ title: 'Lists', target: 'notes/lists.prolog.md' }],
  });
  assert.ok(isSpine(seeded));
  assert.equal(parseSpine(seeded).title, 'Prolog Studies');

  const grown = withEntry(seeded, { title: 'Cut', target: 'notes/cut.prolog.md' });
  assert.deepEqual(parseSpine(grown).blocks.filter((b) => b.kind === 'link').map((b) => b.title),
    ['Lists', 'Cut']);

  // AFTER THE LAST ENTRY, never sorted into place and never after the author's
  // closing prose: the order in this file is their opinion.
  const written = `${spine('# S\n\n- [B](b.prolog.md)\n- [A](a.prolog.md)\n\nWritten while reading.\n')}`;
  const after = withEntry(written, { title: 'C', target: 'c.prolog.md' });
  assert.deepEqual(parseSpine(after).blocks.filter((b) => b.kind === 'link').map((b) => b.title),
    ['B', 'A', 'C']);
  assert.match(after, /- \[C\]\(c\.prolog\.md\)\n\nWritten while reading\.\n$/);
});
