import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { parse } from '../src/format.js';
import { withEdits } from '../src/export.js';
import { drift, firstDifference } from '../src/check.js';

const CLI = new URL('../bin/prolog-notebook.mjs', import.meta.url).pathname;
const exec = promisify(execFile);
const run = (args, options = {}) => exec('node', [CLI, ...args], {
  ...options,
  env: { NO_UPDATE_NOTIFIER: '1', ...process.env, ...options.env },
});

// A CHAPTER THAT NO LONGER SAYS WHAT SWI SAYS (869ectt3n). Technical books rot
// because their code stops working and nobody notices for two years; this is the
// thing that notices. The comparison lives away from the CLI so it can be tested
// without one — and so a VS Code "check all" could use it too.

const CHAPTER = `---
format: prolog-notebook/1
---

# Building a list

\`\`\`prolog program id="p-app"
app([], L, L).
app([H|T], L, [H|R]) :- app(T, L, R).
\`\`\`

\`\`\`prolog query id="q-one"
app([1], [2], Z)
\`\`\`
`;

/** The chapter with its answers filled in, as `execute` leaves it. */
async function answered(dir, name = 'ch.prolog.md') {
  const file = join(dir, name);
  await writeFile(file, CHAPTER);
  await run(['execute', file]);
  return file;
}

test('an answer that has moved is drift; one that was never saved is not', () => {
  const notebook = parse(CHAPTER);
  // Nothing saved: the format's own "not executed yet", and tally() already
  // refuses to guess whether that was an oversight or a workbook edition.
  const first = drift(notebook, new Map([['q-one', { output: { solutions: [], terminator: 'Z = [1, 2].' } }]]));
  assert.equal(first.queries, 1);
  assert.equal(first.answered, 0);
  assert.deepEqual(first.changed, []);
  assert.equal(first.missing.length, 1);
  assert.equal(first.missing[0].goal, 'app([1], [2], Z)');

  // Saved and still true. Laid in the way `execute` lays it in, rather than by
  // hand: an output carries more than its answers, and a hand-made one would be
  // testing a shape the tool never produces.
  const saved = withEdits(notebook,
    new Map([['q-one', { output: { solutions: [], terminator: 'Z = [1, 2].' } }]]));
  const same = drift(saved, new Map([['q-one', { output: { solutions: [], terminator: 'Z = [1, 2].' } }]]));
  assert.deepEqual(same.changed, []);
  assert.equal(same.answered, 1);

  // Saved and no longer true — named, with the line that disagrees.
  const moved = drift(saved, new Map([['q-one', { output: { solutions: [], terminator: 'Z = [1, 9].' } }]]));
  assert.equal(moved.changed.length, 1);
  assert.deepEqual(
    { id: moved.changed[0].id, saved: moved.changed[0].saved, now: moved.changed[0].now },
    { id: 'q-one', saved: 'Z = [1, 2].', now: 'Z = [1, 9].' },
  );

  // A query that produced nothing at all is still a difference, and says so in
  // words rather than as an empty string nobody can see.
  const gone = drift(saved, new Map([['q-one', { output: null }]]));
  assert.equal(gone.changed[0].now, '(nothing)');
});

test('the line named is the first one that disagrees, terminator included', () => {
  const was = { solutions: ['X = a ;', 'X = b ;'], terminator: 'X = c.' };
  assert.equal(firstDifference(was, was), null);
  // The terminator is where the interesting difference usually is: `false.`
  // against an answer, or nothing at all, which is how the format says the search
  // was never exhausted.
  assert.deepEqual(firstDifference(was, { solutions: ['X = a ;', 'X = b ;'], terminator: '' }),
    { line: 3, saved: 'X = c.', now: '(nothing)' });
  assert.equal(firstDifference(was, { solutions: ['X = a ;', 'X = z ;'], terminator: 'X = c.' }).line, 2);
});

test('--check runs everything, writes nothing, and fails on what has moved', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'check-'));
  const file = await answered(dir);
  const before = await readFile(file, 'utf8');

  // Clean: a verdict, and a zero.
  const { stderr: clean } = await run(['execute', '--check', file]);
  assert.match(clean, /1 answer current/);
  assert.equal(await readFile(file, 'utf8'), before);
  // And silent when it passes, so a green pipeline has nothing to read.
  assert.equal((await run(['execute', '--check', '--quiet', file])).stderr, '');

  // Doctored: the file claims an answer the engine does not give.
  await writeFile(file, before.replace(/Z = \[1, 2\]\./, 'Z = [1, 9].'));
  await assert.rejects(run(['execute', '--check', '--quiet', file]), (e) => {
    assert.equal(e.code, 1);
    assert.match(e.stderr, /q-one is not what it says it is — \?- app\(\[1\], \[2\], Z\)/);
    assert.match(e.stderr, /saved: Z = \[1, 9\]\./);
    assert.match(e.stderr, /now: {3}Z = \[1, 2\]\./);
    assert.match(e.stderr, /Run `prolog-notebook execute`/);
    return true;
  });
  // NOTHING WAS WRITTEN. A check that repaired the file would report a failure
  // and then remove the evidence for it, and CI would pass on the second run.
  assert.match(await readFile(file, 'utf8'), /Z = \[1, 9\]\./);
});

test('an answer whose program has moved underneath it fails too', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'check-'));
  const file = await answered(dir);
  // A clause that changes no answer here — nothing in the chapter asks about it —
  // so only the input-hash can tell. Without this the file would go on certifying
  // an answer against a program it no longer contains.
  await writeFile(file, (await readFile(file, 'utf8'))
    .replace('app([], L, L).', 'app([], L, L).\nunrelated(x).'));
  await assert.rejects(run(['execute', '--check', file]), (e) => {
    assert.equal(e.code, 1);
    assert.match(e.stderr, /q-one is stale — the answers hold, but the program above/);
    return true;
  });
});

test('a chapter with no answers passes, and says why', async () => {
  // prolog-studies publishes a workbook edition on purpose: "I'd rather readers
  // work". Failing it here would make --check unusable for exactly the project
  // the ticket was written for.
  const dir = await mkdtemp(join(tmpdir(), 'check-'));
  const file = join(dir, 'workbook.prolog.md');
  await writeFile(file, CHAPTER);
  const { stderr } = await run(['execute', '--check', file]);
  assert.match(stderr, /1 query · no answers saved — nothing to compare, and every cell ran/);

  // And the two flags that both name what happens to the result cannot be given
  // together: a flag read and thrown away looks like it worked.
  await assert.rejects(run(['execute', '--check', '--stdout', file]), (e) => {
    assert.equal(e.code, 2);
    assert.match(e.stderr, /--check writes nothing and --stdout writes everything/);
    return true;
  });
});
