import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { parse, serialise } from '../src/format.js';
import { renderNotebook } from '../src/render.js';
import { exportSource } from '../src/export.js';
import { runNotebook } from '../src/run.js';
import { buildLine, currentBuild, bakedFrom } from '../src/build-info.js';
import { createSession } from '../src/node.js';

// The headless runner (869ectt38) and the write-back (869ectt3e), which are one
// feature: running a chapter and keeping nothing is a way of finding out that it
// still works, and this project needs the answers IN THE FILE — that is what
// makes a chapter readable before the engine arrives.
//
// A real engine throughout. The point of these tests is that what goes into the
// file is what SWI actually printed, and a fake cannot say anything about that.

const CLI = new URL('../bin/prolog-notebook.mjs', import.meta.url).pathname;
const run = promisify(execFile);

const NOTEBOOK = `---
format: prolog-notebook/1
kicker: Lists
---

# Building a list

\`\`\`prolog program id="p-app"
app([], L, L).
app([H|T], L, [H|R]) :- app(T, L, R).
\`\`\`

Splitting a list every way it can be split:

\`\`\`prolog query id="q-split"
app(X, Y, [1,2])
\`\`\`

\`\`\`prolog query id="q-one"
app([1], [2], Z)
\`\`\`
`;

const temp = async (name, text) => {
  const dir = await mkdtemp(join(tmpdir(), 'prolog-notebook-'));
  const file = join(dir, name);
  await writeFile(file, text);
  return file;
};

test('a chapter with no answers comes back with the answers SWI printed', async () => {
  const notebook = parse(NOTEBOOK);
  const session = await createSession();
  const { edits, failures } = await runNotebook(notebook, session);
  assert.deepEqual(failures, []);

  const text = exportSource(notebook, edits);
  const filled = parse(text);
  const split = filled.cells.find((c) => c.id === 'q-split');

  // SWI's own writer, not a reconstruction: the empty list is `[]` and a partial
  // list keeps its tail. This is the whole reason `next().text` is used rather
  // than the bindings — a file whose answers are subtly not what a reader sees
  // when they press Run is worse than a file with no answers at all.
  assert.deepEqual(split.output.solutions, ['X = [],  Y = [1,2]', 'X = [1],  Y = [2]']);
  assert.equal(split.output.terminator, 'X = [1,2],  Y = [].');

  // A deterministic query's last solution IS its terminator, exactly as a
  // toplevel prints it (format §6).
  const one = filled.cells.find((c) => c.id === 'q-one');
  assert.deepEqual(one.output.solutions, []);
  assert.equal(one.output.terminator, 'Z = [1,2].');
});

test('the answers are hashed against the program that produced them', async () => {
  // The whole point of writing back: the file now renders complete, and renders
  // as CURRENT, with no engine anywhere near it.
  const notebook = parse(NOTEBOOK);
  const session = await createSession();
  const { edits } = await runNotebook(notebook, session);
  const html = renderNotebook(parse(exportSource(notebook, edits)));

  assert.match(html, /X = \[1\], {2}Y = \[2\]/, 'the answers are in the page');
  assert.doesNotMatch(html, /the program above has changed since these were produced/);
});

test('running a written-back file again changes nothing', async () => {
  // Idempotence is not a nicety here. `--check` (869ectt3n) is this run plus a
  // comparison, and a runner whose own output does not survive a second pass
  // would fail CI on every commit for no reason.
  const session = await createSession();
  const first = exportSource(parse(NOTEBOOK), (await runNotebook(parse(NOTEBOOK), session)).edits);

  await session.restart();
  const reparsed = parse(first);
  const second = exportSource(reparsed, (await runNotebook(reparsed, session)).edits);
  assert.equal(second, first);
});

test('the chapter in this repo is exactly what the engine produces', async () => {
  // DOGFOOD. ch04's answers were written by hand before this command existed. If
  // they and SWI ever disagree, either the chapter is lying to a reader or the
  // runner is — and both are worth failing a build over. This is 869ectt3n in
  // miniature, on the one file we know we care about.
  const file = new URL('../notebooks/ch04-cut.prolog.md', import.meta.url);
  const source = readFileSync(file, 'utf8');
  const notebook = parse(source);
  const session = await createSession();
  const { edits, failures } = await runNotebook(notebook, session);

  assert.deepEqual(failures, []);
  assert.equal(exportSource(notebook, edits), source);
});

test('a search stopped at the limit is never written down as finished', async () => {
  // `nat(N)` has infinitely many solutions and a chapter will contain something
  // like it on purpose. The sequence is written with NO terminator, which is the
  // format's way of saying the search was never exhausted (§6). `false.` there
  // would be a forgery.
  const source = '```prolog program id="p-n"\nnat(0).\nnat(s(N)) :- nat(N).\n```\n\n'
    + '```prolog query id="q-nat"\nnat(N)\n```\n';
  const notebook = parse(source);
  const session = await createSession();
  const { edits } = await runNotebook(notebook, session, { limit: 3 });

  const output = edits.get('q-nat').output;
  assert.equal(output.solutions.length, 3);
  assert.equal(output.terminator, '');
  assert.match(serialise({ ...notebook, cells: parse(exportSource(notebook, edits)).cells }),
    /N = s\(s\(0\)\) ;\n```/, 'the last line still ends in ` ;`, with no final full stop');
});

test('a goal that throws is recorded, and the cells after it still run', async () => {
  const source = '```prolog query id="q-bad"\nX is foo + 1\n```\n\n'
    + '```prolog query id="q-after"\nX = 2\n```\n';
  const notebook = parse(source);
  const session = await createSession();
  const { edits, failures } = await runNotebook(notebook, session);

  // An error is an ANSWER — a chapter may be demonstrating one — so it goes in
  // the file rather than stopping the run.
  assert.match(edits.get('q-bad').output.terminator, /^ERROR: .*[Aa]rithmetic/);
  assert.deepEqual(failures, [], 'a goal that throws is not a broken chapter');
  assert.equal(edits.get('q-after').output.terminator, 'X = 2.');
});

test('a program cell that does not load is a failure, and nothing is written', async () => {
  const file = await temp('broken.prolog.md',
    '```prolog program id="p-bad"\nthis is not( prolog\n```\n\n```prolog query id="q-x"\ntrue\n```\n');
  const before = await readFile(file, 'utf8');

  const result = await run('node', [CLI, 'run', file]).catch((e) => e);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /cell p-bad did not load/);
  assert.match(result.stderr, /not written/);
  // Every answer below a cell that failed was produced against a chapter that
  // does not exist. Writing them would publish them as though it did.
  assert.equal(await readFile(file, 'utf8'), before);
});

test('the command fills a file in place, and says so', async () => {
  const file = await temp('lists.prolog.md', NOTEBOOK);
  const { stderr } = await run('node', [CLI, 'run', file]);

  assert.match(stderr, /q-split — 3 solutions/);
  assert.match(stderr, /written/);
  const filled = await readFile(file, 'utf8');
  assert.match(filled, /```text output for="q-split" input-hash="[0-9a-f]{16}"/);

  // Said out loud on every run: this process has no defence against a goal that
  // does not terminate (869ejgyax), and the moment it runs a file someone else
  // wrote that stops being an annoyance.
  assert.match(stderr, /no timeout yet/);

  const again = await run('node', [CLI, 'run', file]);
  assert.match(again.stderr, /unchanged/);
});

test('--stdout leaves the file alone, and --limit is checked', async () => {
  const file = await temp('lists.prolog.md', NOTEBOOK);
  const { stdout } = await run('node', [CLI, 'run', '--stdout', '--quiet', file]);
  assert.match(stdout, /```text output for="q-one"/);
  assert.equal(await readFile(file, 'utf8'), NOTEBOOK, 'untouched');

  const bad = await run('node', [CLI, 'run', '--limit', 'lots', file]).catch((e) => e);
  assert.equal(bad.code, 2);
  assert.match(bad.stderr, /positive whole number/);
});

// --------------------------------------------------------------- --version

test('--version says which Prolog will produce your answers', async () => {
  // THE ENGINE LINE IS THE POINT. swipl-wasm 8.0.4 ships SWI-Prolog 10.1.10 and
  // the two numbers are unrelated, so this is the one fact here that nobody could
  // have looked up — and a chapter's saved answers are only true of the engine
  // that produced them.
  const { stdout } = await run('node', [CLI, '--version']);
  const lines = stdout.split('\n');

  assert.match(lines[0], /^Prolog Notebook v\d+\.\d+\.\d+ - Copyright \(C\) \d{4} .+, MIT License\.$/);
  assert.match(lines[1], /^Powered by SWI-Prolog \d+\.\d+\.\d+, swipl-wasm \d+\.\d+\.\d+$/);
  assert.match(lines[2], /^(Build|Working copy) [0-9a-f]{7,}/);
  // A banner that runs into the next shell prompt reads as an error message.
  assert.deepEqual(lines.slice(3), ['', '']);

  const short = await run('node', [CLI, '-V']);
  assert.equal(short.stdout, stdout);
});

test('a closed pipe is the shell being used correctly, not an error', async () => {
  // `--version | head -1` used to end in an unhandled EPIPE and a stack trace.
  const { stdout } = await run('sh', ['-c', `node ${CLI} --version | head -1`]);
  assert.match(stdout, /^Prolog Notebook v/);
});

test('the notice in the command is the notice in the LICENSE', async () => {
  // The year and the holder live in two files because a command should not read a
  // file it does not need. This is what keeps them from drifting apart.
  const cli = await readFile(new URL('../bin/prolog-notebook.mjs', import.meta.url), 'utf8');
  const licence = await readFile(new URL('../LICENSE', import.meta.url), 'utf8');
  // The (C) is capitalised in the banner and lower case in the licence, which is
  // a house-style difference. The year and the holder are the facts, and those
  // must agree.
  const notice = /Copyright \([Cc]\) (\d{4} [^\n'`,]+)/;
  assert.equal(cli.match(notice)[1].trim(), licence.match(notice)[1].trim());
});

test('the version of the package is the version it reports', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const { stdout } = await run('node', [CLI, '--version']);
  assert.match(stdout, new RegExp(`^Prolog Notebook v${pkg.version.replace(/\./g, '\\.')} `, 'm'));
});

// -------------------------------------------------------- which copy is this

test('a published build and a working copy make different claims', () => {
  // They are not the same program, and the difference is the whole reason this
  // line exists: a bug report against a linked checkout with uncommitted edits
  // means something else entirely from one against a published build.
  assert.equal(
    buildLine({ commit: 'ccf8e5b', committed: '2026-08-30', packaged: '2026-08-30' }),
    'Build ccf8e5b, committed 2026-08-30, packaged 2026-08-30'
  );
  assert.equal(
    buildLine({ commit: 'ccf8e5b', committed: '2026-08-30' }),
    'Working copy ccf8e5b, committed 2026-08-30'
  );
  // A bare SHA over a dirty tree names a program nobody has.
  assert.equal(
    buildLine({ commit: 'ccf8e5b', committed: '2026-08-30', modified: true }),
    'Working copy ccf8e5b (modified), committed 2026-08-30'
  );
  // Nothing known: no line at all. One that says "unknown" three times is worse.
  assert.equal(buildLine(null), null);
  assert.equal(buildLine({}), null);

  assert.match(bakedFrom({ commit: 'a', committed: 'b' }, new Date('2026-08-30T14:00:00Z')).packaged,
    /^2026-08-30$/);
});

test('run from this repo, the banner says working copy', async () => {
  const { stdout } = await run('node', [CLI, '--version']);
  const line = stdout.split('\n')[2];
  assert.match(line, /^Working copy [0-9a-f]{7,}(?: \(modified\))?, committed \d{4}-\d\d-\d\d$/);
  assert.deepEqual(Object.keys(currentBuild()).sort(), ['commit', 'committed', 'modified']);
});

test('the release stamps the commit in, and does it before publishing', async () => {
  // The provenance line is only in a published package because a workflow step
  // puts it there — npm decides the tarball's contents BEFORE it would run a
  // prepack hook, so there is no hook that can do this. Deleting the step would
  // silently ship builds that cannot say which commit they are.
  const workflow = await readFile(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
  const stamp = workflow.indexOf('scripts/build-info.mjs');
  const publish = workflow.indexOf('run: npm publish');
  assert.ok(stamp > 0, 'the release must stamp the commit into the package');
  assert.ok(stamp < publish, 'and must do it before publishing');
});
