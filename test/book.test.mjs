import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { SITE } from '../src/site.js';
import { SPINE, SPINE_FORMAT } from '../src/spine.js';

// `build` and the book it builds (869eu5tg1).
//
// spine.test.mjs tests the format and the tree. This tests the COMMAND: that a
// bare build writes a whole site, that naming a chapter writes one page, that a
// chapter dropped from the spine leaves the site, and that a project which has
// never had a spine keeps working exactly as it did in 0.8.

const exec = promisify(execFile);
const CLI = new URL('../bin/prolog-notebook.mjs', import.meta.url).pathname;
const run = (args, cwd) => exec('node', [CLI, ...args], {
  cwd,
  env: { NO_UPDATE_NOTIFIER: '1', ...process.env },
});

const NOTEBOOK = (title) => `---
format: prolog-notebook/1
---

# ${title}

\`\`\`prolog query id="q-1"
member(X, [1,2])
\`\`\`
`;

const spine = (body) => `---\nformat: ${SPINE_FORMAT}\n---\n\n${body}`;

async function project(files) {
  const where = await mkdtemp(join(tmpdir(), 'prolog-notebook-book-'));
  await mkdir(join(where, '.git'), { recursive: true });
  for (const [path, contents] of Object.entries(files)) {
    await mkdir(dirname(join(where, path)), { recursive: true });
    await writeFile(join(where, path), contents);
  }
  return where;
}

const page = (root, url) => join(root, SITE, url, 'index.html');

test('a bare build writes the whole book, nested books and all', async () => {
  const root = await project({
    [SPINE]: spine(`# Prolog Studies

Two books, one site.

## The classics
- [Bratko](bratko/${SPINE})
- [Clocksin & Mellish](cm/${SPINE})
`),
    [`bratko/${SPINE}`]: spine('# B\n\n- [Cut and commit](cut.prolog.md)\n'),
    'bratko/cut.prolog.md': NOTEBOOK('Where does the fence go?'),
    [`cm/${SPINE}`]: spine('# C\n\n- [Cut, again](cut.prolog.md)\n'),
    'cm/cut.prolog.md': NOTEBOOK('Where does the fence go?'),
  });

  const { stderr } = await run(['build'], root);
  assert.match(stderr, /2 chapters → /);

  // TWO CHAPTERS OF THE SAME NAME COEXIST, because their books do. Flat page
  // names let the second silently overwrite the first.
  assert.ok(existsSync(page(root, 'bratko/cut')), 'Bratko');
  assert.ok(existsSync(page(root, 'cm/cut')), 'and C&M');
  // One contents page per book, at the book's own path.
  assert.ok(existsSync(page(root, 'bratko')) && existsSync(page(root, 'cm')));

  const index = await readFile(page(root, ''), 'utf8');
  assert.match(index, /<h1>Prolog Studies<\/h1>/);
  // The author's own heading, and their prose, because the contents page is a
  // rendering of the file they wrote rather than a list taken out of it.
  assert.match(index, /<h2>The classics<\/h2>/);
  assert.match(index, /Two books, one site\./);
  assert.match(index, /<a href="bratko\/">Bratko<\/a>/);
  assert.ok(index.indexOf('href="bratko/"') < index.indexOf('href="cm/"'), 'the spine\'s order');

  // The shared runtime is written once, and reached from whatever depth.
  assert.ok(existsSync(join(root, SITE, 'swipl')));
  assert.ok(!existsSync(join(root, SITE, 'bratko/cut/swipl')));
  assert.match(await readFile(join(root, SITE, 'bratko/cut/app.js'), 'utf8'),
    /'\.\.\/\.\.\/lib\/notebook\.js'/);
});

test('a first build writes the spine, and never writes it again', async () => {
  const root = await project({ 'cut.prolog.md': NOTEBOOK('Where does the fence go?') });

  const first = await run(['build', 'cut.prolog.md'], root);
  assert.match(first.stderr, new RegExp(`created ${SPINE}`));
  const written = await readFile(join(root, SPINE), 'utf8');
  // NAMED FOR THE PROJECT, not for whichever chapter happened to be built first.
  assert.match(written, /^# /m);
  assert.doesNotMatch(written, /# Where does the fence go\?/);
  assert.match(written, /- \[Where does the fence go\?\]\(cut\.prolog\.md\)/);

  // A second chapter is appended and said out loud; the file is otherwise the
  // author's, so nothing is reordered and nothing is rewritten.
  await writeFile(join(root, 'second.prolog.md'), NOTEBOOK('Splitting a list'));
  const second = await run(['build', 'second.prolog.md'], root);
  assert.match(second.stderr, new RegExp(`added second\\.prolog\\.md to ${SPINE}`));
  const grown = await readFile(join(root, SPINE), 'utf8');
  assert.ok(grown.startsWith(written.trimEnd().slice(0, 80)), 'the first spine survived intact');
  assert.ok(grown.indexOf('cut.prolog.md') < grown.indexOf('second.prolog.md'));

  // Building it again binds nothing twice.
  const third = await run(['build', 'second.prolog.md'], root);
  assert.doesNotMatch(third.stderr, /added/);
  assert.equal(await readFile(join(root, SPINE), 'utf8'), grown);
});

test('a chapter taken out of the book leaves the site', async () => {
  const root = await project({
    [SPINE]: spine('# S\n\n- [One](a.prolog.md)\n- [Two](b.prolog.md)\n'),
    'a.prolog.md': NOTEBOOK('One'),
    'b.prolog.md': NOTEBOOK('Two'),
  });
  await run(['build'], root);
  assert.ok(existsSync(page(root, 'b')));

  await writeFile(join(root, SPINE), spine('# S\n\n- [One](a.prolog.md)\n'));
  const { stderr } = await run(['build'], root);
  // Until there was a spine this was impossible: the site was the only record of
  // itself, so nothing could ever be known to be surplus.
  assert.match(stderr, /1 page no longer in the book removed: b/);
  assert.ok(!existsSync(join(root, SITE, 'b')), 'and it is gone from the site');
  assert.ok(existsSync(page(root, 'a')), 'while the rest is untouched');
});

test('naming a chapter builds that chapter, and leaves the others alone', async () => {
  const root = await project({
    [SPINE]: spine('# S\n\n- [One](a.prolog.md)\n- [Two](b.prolog.md)\n'),
    'a.prolog.md': NOTEBOOK('One'),
    'b.prolog.md': NOTEBOOK('Two'),
  });
  await run(['build', 'a.prolog.md'], root);

  // AN AUTHOR WHO NAMED ONE CHAPTER HAS NOT ASKED ABOUT THE OTHERS, so the
  // unbuilt chapter is neither built nor pruned — but the contents page lists the
  // book, because that is what the book contains.
  assert.ok(existsSync(page(root, 'a')));
  assert.ok(!existsSync(join(root, SITE, 'b')));
  assert.match(await readFile(page(root, ''), 'utf8'), /<a href="b\/">Two<\/a>/);
});

test('one chapter in two books is two pages, from one name', async () => {
  const root = await project({
    [SPINE]: spine(`# S\n\n- [As read](a/${SPINE})\n- [As taught](b/${SPINE})\n`),
    [`a/${SPINE}`]: spine('# A\n\n- [Cut](../notes/cut.prolog.md)\n'),
    [`b/${SPINE}`]: spine('# B\n\n- [Cut, in class](../notes/cut.prolog.md)\n'),
    'notes/cut.prolog.md': NOTEBOOK('Where does the fence go?'),
  });
  // The site has to be correct after ANY build, not only after a full one.
  await run(['build', 'notes/cut.prolog.md'], root);
  assert.ok(existsSync(page(root, 'a/cut')) && existsSync(page(root, 'b/cut')));
  // Each binding names it as its own book does.
  assert.match(await readFile(page(root, 'a'), 'utf8'), /<a href="cut\/">Cut<\/a>/);
  assert.match(await readFile(page(root, 'b'), 'utf8'), /Cut, in class/);
});

test('it refuses rather than guessing at a book', async () => {
  const bare = await project({ 'a.prolog.md': NOTEBOOK('One') });
  // Sweeping every .prolog.md under the project would publish somebody's drafts
  // the first time they ran it.
  const nothing = await run(['build'], bare).catch((e) => e);
  assert.equal(nothing.code, 1);
  assert.match(nothing.stderr, new RegExp(`No book here — ${SPINE}`));
  assert.match(nothing.stderr, /build <file>/);

  const cyclic = await project({
    [SPINE]: spine(`# S\n\n- [Down](a/${SPINE})\n`),
    [`a/${SPINE}`]: spine(`# A\n\n- [Up](../${SPINE})\n`),
  });
  const loop = await run(['build'], cyclic).catch((e) => e);
  assert.equal(loop.code, 1);
  assert.match(loop.stderr, /a book cannot contain itself/);

  const gone = await project({ [SPINE]: spine('# S\n\n- [Missing](nope.prolog.md)\n') });
  const missing = await run(['build'], gone).catch((e) => e);
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /no such notebook — nope\.prolog\.md/);
});

test('a site that has never had a spine keeps the behaviour it had', async () => {
  // NOTHING HERE IS RETROSPECTIVE. --out is a build to a directory of its own, so
  // no spine is written beside it and the index is the 0.8 one, from the
  // directory, alphabetically.
  const root = await project({
    'b.prolog.md': NOTEBOOK('Second'),
    'a.prolog.md': NOTEBOOK('First'),
  });
  const out = await mkdtemp(join(tmpdir(), 'prolog-notebook-out-'));
  await run(['build', 'b.prolog.md', '--out', out], root);
  await run(['build', 'a.prolog.md', '--out', out], root);

  assert.ok(!existsSync(join(root, SPINE)), 'no spine was written for a one-off build');
  const index = await readFile(join(out, 'index.html'), 'utf8');
  assert.ok(index.indexOf('href="a/"') < index.indexOf('href="b/"'), 'alphabetical, as before');
});
