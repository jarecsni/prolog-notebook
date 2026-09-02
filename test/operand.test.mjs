import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { SITE } from '../src/site.js';
import { SPINE, SPINE_FORMAT } from '../src/spine.js';

// THE OPERAND IS A FILTER (869eu5tn7): name files and a command acts on those,
// name none and it acts on the whole book. One sentence for five commands, and
// this is where it is held to.

const exec = promisify(execFile);
const CLI = new URL('../bin/prolog-notebook.mjs', import.meta.url).pathname;
const env = { NO_UPDATE_NOTIFIER: '1', ...process.env };
const run = (args, cwd) => exec('node', [CLI, ...args], { cwd, env });

const NOTEBOOK = (title) => `---
format: prolog-notebook/1
---

# ${title}

\`\`\`prolog program id="p-1"
one(1).
\`\`\`

\`\`\`prolog query id="q-1"
one(X)
\`\`\`
`;

const spine = (body) => `---\nformat: ${SPINE_FORMAT}\n---\n\n${body}`;

async function project(files) {
  const where = await mkdtemp(join(tmpdir(), 'prolog-notebook-operand-'));
  await mkdir(join(where, '.git'), { recursive: true });
  for (const [path, contents] of Object.entries(files)) {
    await mkdir(dirname(join(where, path)), { recursive: true });
    await writeFile(join(where, path), contents);
  }
  return where;
}

const book = () => project({
  [SPINE]: spine(`# Studies\n\n- [Bratko](bratko/${SPINE})\n`),
  [`bratko/${SPINE}`]: spine('# Bratko\n\n- [First](a.prolog.md)\n- [Second](b.prolog.md)\n'),
  'bratko/a.prolog.md': NOTEBOOK('One'),
  'bratko/b.prolog.md': NOTEBOOK('Two'),
});

/** Start `view`, wait for its URL on stdout, and stop it afterwards. */
async function viewing(args, cwd) {
  const child = spawn('node', [CLI, ...args, '--no-open', '--port', '0'], { cwd, env });
  const url = await new Promise((resolve, reject) => {
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => {
      out += d;
      if (out.includes('\n')) resolve(out.trim());
    });
    child.stderr.on('data', (d) => { err += d; });
    child.on('exit', () => reject(new Error(err || 'view exited')));
  });
  return {
    url,
    get: (path) => fetch(new URL(path, url), { redirect: 'manual' }),
    stop: () => child.kill(),
  };
}

test('view with no operand serves the whole book, live', async () => {
  const root = await book();
  const server = await viewing(['view'], root);
  try {
    // Nothing was built: view serves the sources as they are, so there is no
    // step between writing a chapter and reading it.
    assert.ok(!existsSync(join(root, SITE)), 'no build was needed');
    assert.match(await (await server.get('/')).text(), /<h1>Studies<\/h1>/);
    assert.match(await (await server.get('/bratko/')).text(), /<a href="a\/">First<\/a>/);
    assert.match(await (await server.get('/bratko/a/')).text(), /<h1>One<\/h1>/);
    assert.equal((await server.get('/bratko/a/app.js')).status, 200);
    assert.equal((await server.get('/swipl/swipl-bundle.js')).status, 200);

    // ASKED AGAIN ON EVERY REQUEST (869erpuhk). Reordering the contents and
    // reloading has to show them reordered — and the navigation with them,
    // because prev and next are a property of the book rather than the page.
    assert.match(await (await server.get('/bratko/a/')).text(), /rel="next" href="\.\.\/b\//);
    await writeFile(join(root, 'bratko', SPINE),
      spine('# Bratko\n\n- [Second](b.prolog.md)\n- [First](a.prolog.md)\n'));
    const after = await (await server.get('/bratko/a/')).text();
    assert.match(after, /rel="prev" href="\.\.\/b\//);
    assert.doesNotMatch(after, /rel="next"/, 'it is the last chapter now');
  } finally {
    server.stop();
  }
});

test('naming one chapter opens on it, without hiding the rest', async () => {
  const root = await book();
  const server = await viewing(['view', 'bratko/a.prolog.md'], root);
  try {
    // THE FILTER APPLIES TO ATTENTION, NOT TO WHAT EXISTS. Serving only the named
    // chapter would leave its contents page and its next card pointing at a
    // chapter the server would 404 — a preview full of dead links is worse than
    // one that shows everything.
    assert.equal((await server.get('/bratko/b/')).status, 200);
    assert.equal((await server.get('/')).status, 200);
  } finally {
    server.stop();
  }
});

test('a loose notebook is still served alone at the root', async () => {
  const root = await project({ 'a.prolog.md': NOTEBOOK('Alone') });
  const server = await viewing(['view', 'a.prolog.md'], root);
  try {
    // No spine, no book — which is still the whole workflow for somebody with one
    // file, and it works exactly as it has since 0.5.
    assert.match(await (await server.get('/')).text(), /<h1>Alone<\/h1>/);
    assert.doesNotMatch(await (await server.get('/')).text(), /class="crumbs"/);
  } finally {
    server.stop();
  }
});

test('--built serves the artefact, and says when there is not one', async () => {
  const root = await book();
  const nothing = await run(['view', '--built', '--no-open'], root).catch((e) => e);
  assert.equal(nothing.code, 1);
  assert.match(nothing.stderr, /Nothing built yet.*run `build` first/s);

  await run(['build'], root);
  await writeFile(join(root, 'bratko/a.prolog.md'), NOTEBOOK('Edited after the build'));
  const server = await viewing(['view', '--built'], root);
  try {
    // THE REHEARSAL FOR THE IRREVERSIBLE COMMAND: exactly the bytes publish would
    // push, which means NOT the edit made since.
    assert.match(await (await server.get('/bratko/a/')).text(), /<h1>One<\/h1>/);
    assert.doesNotMatch(await (await server.get('/bratko/a/')).text(), /Edited after the build/);
    assert.equal((await server.get('/.nojekyll')).status, 200);
  } finally {
    server.stop();
  }
});

test('execute with no operand fills in the whole book', async () => {
  const root = await book();
  const { stderr } = await run(['execute'], root);
  assert.match(stderr, /a\.prolog\.md/);
  assert.match(stderr, /b\.prolog\.md/);
  for (const name of ['a', 'b']) {
    assert.match(await readFile(join(root, `bratko/${name}.prolog.md`), 'utf8'), /X = 1/);
  }
});

test('clear with no operand empties the whole book, and asks first', async () => {
  const root = await book();
  await run(['execute', '--quiet'], root);

  // A QUESTION NOBODY CAN ANSWER IS A HANG, and emptying every answer an author
  // has is the most destructive thing this does to a file they wrote.
  const unasked = await run(['clear'], root).catch((e) => e);
  assert.equal(unasked.code, 2);
  assert.match(unasked.stderr, /Nobody to ask, and this empties 2 chapters\. Pass --yes\./);
  assert.match(await readFile(join(root, 'bratko/a.prolog.md'), 'utf8'), /X = 1/);

  const { stderr } = await run(['clear', '--yes'], root);
  assert.match(stderr, /a\.prolog\.md: 1 answer removed/);
  for (const name of ['a', 'b']) {
    assert.doesNotMatch(await readFile(join(root, `bratko/${name}.prolog.md`), 'utf8'), /X = 1/);
  }
});

test('a command that acts on a book says so when there is none', async () => {
  const loose = await project({ 'a.prolog.md': NOTEBOOK('Alone') });
  for (const [command, code] of [['execute', 1], ['clear', 1], ['build', 1], ['view', 1]]) {
    const refused = await run([command], loose).catch((e) => e);
    assert.equal(refused.code, code, command);
    assert.match(refused.stderr, new RegExp(`No book here — ${SPINE}`), command);
    // It names the file to create rather than sweeping every .prolog.md under
    // the project, which would publish somebody's drafts the first time they ran.
    assert.match(refused.stderr, /build <file>/, command);
  }
});
