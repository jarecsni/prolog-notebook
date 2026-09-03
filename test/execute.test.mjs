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
import { clearedSource, exportSource } from '../src/export.js';
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
const exec = promisify(execFile);

// The CLI asks npm whether it is out of date when it does real work. A suite that
// depended on a network would be a suite that fails on a train, so it is switched
// off here the way a reader would switch it off — except where a test is about the
// check itself, and points it at a server of its own.
const run = (cmd, args, options = {}) => exec(cmd, args, {
  ...options,
  env: { NO_UPDATE_NOTIFIER: '1', ...process.env, ...options.env },
});

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
  assert.deepEqual(split.output.solutions, ['X = [],  Y = [1, 2]', 'X = [1],  Y = [2]']);
  assert.equal(split.output.terminator, 'X = [1, 2],  Y = [].');

  // A deterministic query's last solution IS its terminator, exactly as a
  // toplevel prints it (format §6).
  const one = filled.cells.find((c) => c.id === 'q-one');
  assert.deepEqual(one.output.solutions, []);
  assert.equal(one.output.terminator, 'Z = [1, 2].');
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

  const result = await run('node', [CLI, 'execute', file]).catch((e) => e);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /cell p-bad did not load/);
  assert.match(result.stderr, /not written/);
  // Every answer below a cell that failed was produced against a chapter that
  // does not exist. Writing them would publish them as though it did.
  assert.equal(await readFile(file, 'utf8'), before);
});

test('the command fills a file in place, and says so', async () => {
  const file = await temp('lists.prolog.md', NOTEBOOK);
  const { stderr } = await run('node', [CLI, 'execute', file]);

  assert.match(stderr, /q-split — 3 solutions/);
  assert.match(stderr, /written/);
  const filled = await readFile(file, 'utf8');
  assert.match(filled, /```text output for="q-split" input-hash="[0-9a-f]{16}"/);

  // Said out loud on every run: this process has no defence against a goal that
  // does not terminate (869ejgyax), and the moment it runs a file someone else
  // wrote that stops being an annoyance.
  assert.match(stderr, /no timeout yet/);

  const again = await run('node', [CLI, 'execute', file]);
  assert.match(again.stderr, /unchanged/);
});

test('--stdout leaves the file alone, and --limit is checked', async () => {
  const file = await temp('lists.prolog.md', NOTEBOOK);
  const { stdout } = await run('node', [CLI, 'execute', '--stdout', '--quiet', file]);
  assert.match(stdout, /```text output for="q-one"/);
  assert.equal(await readFile(file, 'utf8'), NOTEBOOK, 'untouched');

  const bad = await run('node', [CLI, 'execute', '--limit', 'lots', file]).catch((e) => e);
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
  assert.match(lines[2], /^(Built from commit|Working copy) [0-9a-f]{7,}/);
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
  // The year and the holder live in src/version.js because a PAGE cannot read
  // LICENSE — there is no filesystem behind a module script and no build step to
  // inline one. This is what keeps the two from drifting apart.
  const { COPYRIGHT } = await import('../src/version.js');
  const licence = await readFile(new URL('../LICENSE', import.meta.url), 'utf8');
  // The (C) is capitalised in the banner and lower case in the licence, which is
  // a house-style difference. The year and the holder are the facts, and those
  // must agree. Compared as VALUES rather than as source text, because the
  // notice is now composed from a year and a holder that a page also uses.
  const notice = /Copyright \([Cc]\) (\d{4} [^\n'`,]+)/;
  assert.equal(COPYRIGHT.match(notice)[1].trim(), licence.match(notice)[1].trim());
});

test('the version of the package is the version it reports', async () => {
  // Two files to touch at release — package.json and src/version.js — and this is
  // the thing that fails loudly when only one of them was.
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const { VERSION } = await import('../src/version.js');
  assert.equal(VERSION, pkg.version);
  const { stdout } = await run('node', [CLI, '--version']);
  assert.match(stdout, new RegExp(`^Prolog Notebook v${pkg.version.replace(/\./g, '\\.')} `, 'm'));
});

// -------------------------------------------------------- which copy is this

test('a published build and a working copy make different claims', () => {
  // They are not the same program, and the difference is the whole reason this
  // line exists: a bug report against a checkout with uncommitted edits means
  // something else entirely from one against a published build.
  assert.equal(
    buildLine({ commit: 'ccf8e5b', built: '2026-08-30 14:32:51 UTC' }),
    'Built from commit ccf8e5b on 2026-08-30 14:32:51 UTC'
  );
  assert.equal(buildLine({ commit: 'ccf8e5b' }), 'Working copy ccf8e5b');
  // A bare SHA over a dirty tree names a program nobody has.
  assert.equal(buildLine({ commit: 'ccf8e5b', modified: true }), 'Working copy ccf8e5b (modified)');
  // Nothing known: no line at all. One that says "unknown" twice is worse.
  assert.equal(buildLine(null), null);
  assert.equal(buildLine({}), null);

  // ONE DATE, AND IT IS THE BUILD'S, in UTC. The commit's own date is not printed
  // because the hash already identifies it, and a build stamp is read by whoever
  // is holding the package, wherever they are.
  assert.equal(
    bakedFrom({ commit: 'a' }, new Date('2026-08-30T14:32:51Z')).built,
    '2026-08-30 14:32:51 UTC'
  );
});

test('the banner reports the state this copy is actually in', async () => {
  // BOTH STATES ARE REAL, AND ONE OF THEM ONLY HAPPENS AT RELEASE. This asserted
  // "Working copy" unconditionally and passed everywhere except the one place it
  // mattered: `prepublishOnly` runs the suite AFTER the release workflow has
  // stamped the commit in, so the banner correctly said "Build 34278fd, …" and
  // the publish was stopped by its own gate. Which state to expect is decided by
  // the file that decides it.
  const { existsSync } = await import('node:fs');
  const stamped = existsSync(new URL('../src/build-info.json', import.meta.url));
  const line = (await run('node', [CLI, '--version'])).stdout.split('\n')[2];

  assert.match(line, stamped
    ? /^Built from commit [0-9a-f]{7,} on \d{4}-\d\d-\d\d \d\d:\d\d:\d\d UTC$/
    : /^Working copy [0-9a-f]{7,}(?: \(modified\))?$/);

  const { currentBuild } = await import('../src/build-info.js');
  assert.equal(Boolean(currentBuild().built), stamped, 'the two must agree about which it is');
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

// ------------------------------------------------------- the update notice

test('a run says so when a newer version exists, on stderr', async () => {
  // END TO END, against a registry of this test's own: the flag is parsed, the
  // request is made while the work happens, and the notice lands on STDERR —
  // which matters, because `execute --stdout` is a notebook going down a pipe and a
  // version notice in the middle of it would corrupt the file.
  const { createServer } = await import('node:http');
  const asked = [];
  const server = createServer((req, res) => {
    asked.push(req.url);
    // A stub that accepts anything cannot catch a header the real registry
    // refuses — which is how 0.4.0 shipped asking for a media type npm answers
    // 406 to. This one is as fussy as the registry is.
    if (/install-v1/.test(req.headers.accept ?? '')) {
      res.writeHead(406).end();
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ version: '99.0.0' }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const registry = `http://127.0.0.1:${server.address().port}`;

  try {
    const file = await temp('lists.prolog.md', NOTEBOOK);
    // No --quiet here: that suppresses the check entirely, which is its own test.
    const { stdout, stderr } = await run('node', [CLI, 'execute', '--stdout', file], {
      env: {
        PROLOG_NOTEBOOK_REGISTRY: registry,
        NO_UPDATE_NOTIFIER: '',
        CI: '',
        XDG_CACHE_HOME: await mkdtemp(join(tmpdir(), 'prolog-notebook-cache-')),
      },
    });
    assert.deepEqual(asked, ['/prolog-notebook/latest']);
    assert.match(stderr, /You have Prolog Notebook \d+\.\d+\.\d+\. The latest is 99\.0\.0\./);
    // No prompt down a pipe — a question nobody can answer is a hang — so it says
    // what to type. `prolog-notebook upgrade` rather than the npm line, because
    // that command knows how this copy was installed and the npm line does not.
    assert.match(stderr, /Update with: prolog-notebook upgrade/);
    assert.doesNotMatch(stdout, /The latest is/, 'the notebook is not to be corrupted');
    assert.match(stdout, /```text output for=/, 'and it is still a notebook');

    // --quiet means "report only failures", and news about a newer version is not
    // one. The request is not even made: starting it to discard the answer would
    // be a command going to the network for nothing.
    const before = asked.length;
    const quiet = await run('node', [CLI, 'execute', '--stdout', '--quiet', file], {
      env: {
        PROLOG_NOTEBOOK_REGISTRY: registry,
        NO_UPDATE_NOTIFIER: '',
        CI: '',
        XDG_CACHE_HOME: await mkdtemp(join(tmpdir(), 'prolog-notebook-cache-')),
      },
    });
    assert.equal(asked.length, before, 'the registry was not asked');
    assert.doesNotMatch(quiet.stderr, /The latest is/);

    // AND THERE IS NO LONGER A FLAG THAT OVERRIDES IT. `--check-update` used to
    // force the question through --quiet; it is gone, and asking outright is now
    // a command rather than a modifier (869etgxn3).
    const refused = await run('node', [CLI, 'execute', '--stdout', '--check-update', file], {
      env: { PROLOG_NOTEBOOK_REGISTRY: registry },
    }).catch((e) => e);
    assert.equal(refused.code, 2);
    assert.match(refused.stderr, /unknown option "--check-update"/);
  } finally {
    server.close();
  }
});

test('run and exec still work, and are not advertised', async () => {
  // `run` is published in every release since 0.3.0. Renaming it to `execute`
  // (869erp0jd) must not break a command somebody has in a script — but one name
  // is the name, so neither alias appears in --help.
  const file = await temp('lists.prolog.md', NOTEBOOK);
  for (const alias of ['run', 'exec']) {
    const { stdout } = await run('node', [CLI, alias, '--stdout', '--quiet', file]);
    assert.match(stdout, /```text output for="q-split"/, `${alias} must still execute`);
  }
  const { stdout: help } = await run('node', [CLI, '--help']);
  assert.match(help, /^ {2}execute {4}run every query/m);
  assert.doesNotMatch(help, /^ {2}(run|exec) /m);
});

// ------------------------------------------------------------------ clear

test('clear takes the answers out and leaves everything else where it was', async () => {
  // The counterpart to execute, and it exists because the alternative was editing
  // the file by hand (869erp1wq).
  const source = readFileSync(new URL('../notebooks/ch04-cut.prolog.md', import.meta.url), 'utf8');
  const { text, cleared } = clearedSource(parse(source));

  assert.equal(cleared, 4, 'the chapter has four answered queries');
  assert.doesNotMatch(text, /```text output/);
  assert.doesNotMatch(text, /input-hash/);

  // Everything that is the author's is untouched — prose, program cells, goals,
  // and the attributes on them. Emptying the answers is not licence to reformat.
  assert.match(text, /## The complaint/);
  assert.match(text, /```prolog query id="q-son-a" rerun="auto" hold="until-answered"/);
  assert.match(text, /son_a\(X\) :- once\(\( male\(X\), parent\(_, X\) \)\)\./);
  assert.match(text, /> \[!margin\] edward, then edward again/);

  // And what is left is a valid chapter: one that has simply not been executed.
  const again = parse(text);
  assert.equal(again.cells.filter((c) => c.kind === 'query').length, 4);
  assert.equal(again.cells.every((c) => c.kind !== 'query' || c.output === null), true);
});

test('clearing a chapter with no answers changes nothing at all', () => {
  const source = '```prolog query id="q-1"\nfoo(X)\n```\n';
  const { text, cleared } = clearedSource(parse(source));
  assert.equal(cleared, 0);
  assert.equal(text, source, 'and it must not rewrite the file to say so');
});

test('the command reports what it removed, and refuses to guess', async () => {
  const file = await temp('ch.prolog.md', readFileSync(
    new URL('../notebooks/ch04-cut.prolog.md', import.meta.url), 'utf8'));

  const first = await run('node', [CLI, 'clear', file]);
  assert.match(first.stderr, /ch\.prolog\.md: 4 answers removed/);
  assert.doesNotMatch(await readFile(file, 'utf8'), /```text output/);

  // Idempotent, and it says so rather than rewriting the file to no purpose.
  const second = await run('node', [CLI, 'clear', file]);
  assert.match(second.stderr, /nothing to remove/);

  // --stdout leaves the file alone, exactly as it does for execute.
  const untouched = await readFile(file, 'utf8');
  const { stdout } = await run('node', [CLI, 'clear', '--stdout', file]);
  assert.equal(await readFile(file, 'utf8'), untouched);
  assert.doesNotMatch(stdout, /```text output/);

  // BARE IS VALID USAGE NOW — it means the whole book (869eu5tn7) — so with no
  // book to act on this fails at 1 rather than 2: the invocation was fine, the
  // project has no contents file. It says which file that is.
  //
  // RUN SOMEWHERE WITH NO BOOK, explicitly. Without a cwd this asks the working
  // directory what book it is in, and once this repository had a spine of its
  // own that answer was "the one you are developing" — a test that reaches into
  // the project it is testing.
  const nowhere = await mkdtemp(join(tmpdir(), 'prolog-notebook-nobook-'));
  const noFile = await run('node', [CLI, 'clear'], { cwd: nowhere }).catch((e) => e);
  assert.equal(noFile.code, 1);
  assert.match(noFile.stderr, /No book here — prolog-notebook-index\.md/);
});

test('clear then execute is the chapter it started as', async () => {
  // The two are a pair: one empties, the other fills. A round trip that did not
  // land on the same bytes would mean one of them is inventing something.
  const original = readFileSync(new URL('../notebooks/ch04-cut.prolog.md', import.meta.url), 'utf8');
  const file = await temp('ch.prolog.md', original);
  await run('node', [CLI, 'clear', '--quiet', file]);
  await run('node', [CLI, 'execute', '--quiet', file]);
  assert.equal(await readFile(file, 'utf8'), original);
});

// ------------------------------------------ the options mean the same thing everywhere

test('an option that belongs to another command says where it lives', async () => {
  // "unknown option --limit" is true and unhelpful when the flag is real and two
  // lines up in the same help (869erqra0). It also caught a silent one: `view`
  // and `build` share a parser, so `build --port 90` was accepted and ignored —
  // a flag that is read and thrown away looks like it worked.
  const file = await temp('lists.prolog.md', NOTEBOOK);
  const cases = [
    [['build', file, '--port', '90'], /--port belongs to view, not to build/],
    [['view', file, '--out', 'x'], /--out belongs to build, not to view/],
    [['view', file, '--limit', '5'], /--limit belongs to execute, not to view/],
    [['execute', file, '--out', 'x'], /--out belongs to build, not to execute/],
    [['clear', file, '--port', '1'], /--port belongs to view, not to clear/],
    [['build', file, '--nonsense'], /unknown option "--nonsense"/],
  ];
  for (const [argv, says] of cases) {
    const failed = await run('node', [CLI, ...argv]).then(() => null, (e) => e);
    assert.ok(failed, `${argv.join(' ')} should have been refused`);
    assert.equal(failed.code, 2);
    assert.match(failed.stderr, says);
  }
});

test('asking outright is a command now, not a flag on every other one', async () => {
  // `--check-update` forced the update check that the tool performs on its own
  // anyway, on every command, in every help screen. `upgrade` already answers the
  // question — printing the verdict either way, and acting only when there is
  // something to act on — so the flag was a sentence in five help screens buying
  // nothing (869etgxn3).
  const { createServer } = await import('node:http');
  const asked = [];
  const server = createServer((req, res) => {
    asked.push(req.url);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ version: '99.0.0' }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const registry = `http://127.0.0.1:${server.address().port}`;

  try {
    // Gone from every command that used to carry it, and refused rather than
    // ignored: a flag read and thrown away looks like it worked.
    const file = await temp('lists.prolog.md', NOTEBOOK);
    for (const argv of [['build', file], ['clear', '--stdout', file], ['execute', file]]) {
      const failed = await run('node', [CLI, ...argv, '--check-update']).catch((e) => e);
      assert.equal(failed.code, 2, `${argv[0]} refuses it`);
      assert.match(failed.stderr, /unknown option "--check-update"/);
    }

    // And the question is still askable, by the command whose name is the answer.
    const { stderr } = await run('node', [CLI, 'upgrade'], {
      env: {
        PROLOG_NOTEBOOK_REGISTRY: registry,
        NO_UPDATE_NOTIFIER: '1',
        XDG_CACHE_HOME: await mkdtemp(join(tmpdir(), 'prolog-notebook-cache-')),
      },
    }).catch((e) => e);
    assert.equal(asked.length, 1, 'upgrade asks the registry outright');
    assert.match(stderr, /The latest is 99\.0\.0\./);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
test('the bare screen names the commands and leaves their switches to them', async () => {
  // The Captain, on running the tool with no arguments: "it prints the full help
  // screen - with details on the individual commands (including switches) - this
  // is not great, why do we have command level help then" (869ery5hj).
  const { stdout } = await run('node', [CLI]);
  const lines = stdout.split('\n');

  // Every command is there, one line each, and the repeated `prolog-notebook`
  // prefix is not — it is a label rather than an instruction when stacked.
  for (const name of ['view', 'build', 'execute', 'clear', 'upgrade']) {
    assert.ok(lines.some((line) => new RegExp(`^ {2}${name}\\b`).test(line)),
      `${name} must have its own line`);
  }
  assert.doesNotMatch(stdout, /^ {2}prolog-notebook /m);

  // The name and the blurb, and nothing else. Every command takes a file, so an
  // operand here says nothing about the choice this screen exists to help with —
  // and what to call that file is the other screen's business.
  assert.doesNotMatch(stdout, /<file/);
  assert.doesNotMatch(stdout, /\.\.\./);
  assert.doesNotMatch(stdout, /\.prolog\.md/);
  // A command's own help says what kind of file, on a line laid out exactly like
  // the switches under it — one shape to read, not two.
  const clear = (await run('node', [CLI, 'clear', '--help'])).stdout;
  assert.match(clear,
    /^ {4}<file\(s\)> {7}space separated list of Prolog Notebook files \(\.md\)$/m);
  assert.match(clear, /^ {4}--stdout {8}/m);
  // Options before operands, as POSIX has it and as every tool the reader has
  // already met prints it. `(s)` is legible without having read a man page,
  // which the conventional ellipsis is not. Bracketed because options may be
  // left out, and the operand is not bracketed because it may not — the same
  // convention saying the two are different.
  //
  // EVERY COMMAND THAT TAKES FILES TAKES <file(s)> (869eu5tn7). `build` and
  // `view` used to say <file>, which recorded an accident rather than a rule:
  // both were always loops. One shape across the whole tool, and one sentence
  // for what the operand means — name files and it acts on those, name none and
  // it acts on the whole book.
  assert.match(clear, /prolog-notebook clear \[<options>\] <file\(s\)>/);
  for (const command of ['build', 'view', 'execute']) {
    const help = (await run('node', [CLI, command, '--help'])).stdout;
    assert.match(help, new RegExp(`prolog-notebook ${command} \\[<options>\\] <file\\(s\\)>`));
  }
  assert.doesNotMatch((await run('node', [CLI, 'upgrade', '--help'])).stdout, /<options>/);

  // THE POINT: no per-command switch appears here. The two at the foot are not
  // per-command — one is its own whole command and one works wherever it is typed.
  for (const flag of ['--out', '--port', '--limit', '--stdout', '--quiet', '--no-open']) {
    assert.doesNotMatch(stdout, new RegExp(flag), `${flag} belongs to a command, not here`);
  }
  assert.match(stdout, /^ {2}--version {3}version, engine and copyright — on its own$/m);
  assert.match(stdout, /^ {2}-h, --help {2}this, or one command's/m);
  // The heading went with the third one. "Anywhere" over a list of two, only one
  // of which is, would be a label that has to be corrected as it is read.
  assert.doesNotMatch(stdout, /Anywhere/);
  assert.doesNotMatch(stdout, /--check-update/);

  // The note about a stopped search explains --limit, so it travels with --limit
  // and nowhere else. This screen was the one place breaking that rule.
  assert.doesNotMatch(stdout, /never exhausted/);

  // And --help says which of the two things it just did. "this" was written when
  // there was only one screen it could mean — and it is now said only here, since
  // a command's own help is not a place to advertise the flag that produced it.
  assert.match(stdout, /-h, --help {2}this, or one command's: prolog-notebook build --help/);
});

test('a command asked for help answers about itself, and nothing else', async () => {
  // The Captain, shown all five commands for `build --help`: "not really. If I
  // run prolog-notebook cmd --help I want only help on that cmd" (869erqra0).
  // Printing everything makes the reader find their command again in a page they
  // did not ask for.
  const { stdout } = await run('node', [CLI, 'build', '--help']);
  assert.match(stdout, /prolog-notebook build \[<options>\] <file\(s\)>/);
  assert.match(stdout, /--out <dir>/);
  for (const other of ['view <file', 'execute <file', 'clear <file', 'upgrade  ']) {
    assert.doesNotMatch(stdout, new RegExp(other.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  // AND NOTHING GLOBAL DOWN HERE. This screen exists because the reader typed
  // --help; telling them --help is available is the one piece of help nobody in
  // this position needs, and the other two globals are gone.
  assert.doesNotMatch(stdout, /Anywhere/);
  assert.doesNotMatch(stdout, /--version/);
  assert.doesNotMatch(stdout, /--help/);
  // And the note about a stopped search belongs to --limit, so it travels with
  // execute and appears nowhere else.
  assert.doesNotMatch(stdout, /never exhausted/);
  assert.match((await run('node', [CLI, 'execute', '--help'])).stdout, /never exhausted/);

  // Wherever the command is named, and whatever it is named — a help flag that
  // only works in one position is its own small annoyance.
  const first = (out) => out.split('\n')[0];
  const view = first((await run('node', [CLI, 'view', '--help'])).stdout);
  for (const argv of [['--help', 'view'], ['view', 'chapter.prolog.md', '-h']]) {
    assert.equal(first((await run('node', [CLI, ...argv])).stdout), view);
  }
  // `run` and `exec` are undocumented aliases, and asking either about itself
  // must not answer about a command that does not exist.
  const execute = first((await run('node', [CLI, 'execute', '--help'])).stdout);
  assert.equal(first((await run('node', [CLI, 'run', '--help'])).stdout), execute);
  assert.equal(first((await run('node', [CLI, 'exec', '-h'])).stdout), execute);

  // No command named, or one nobody has: the whole card, as before.
  for (const argv of [['--help'], ['nonsense', '--help'], []]) {
    assert.match((await run('node', [CLI, ...argv])).stdout,
      /^prolog-notebook — Jupyter-style notebooks for Prolog/);
  }
});
