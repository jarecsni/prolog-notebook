import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  SITE, compareVersions, findSite, indexHtml, isShared, pageName, pagesIn, projectSite, reconcile,
  sourceOf,
} from '../src/site.js';
import { ENGINE_VERSION } from '../src/build.js';
import { VERSION } from '../src/version.js';

// One site, however many notebooks (869ery5e8), and an index that is regenerated
// from the directory rather than remembered (869erptbr).
//
// The thing worth testing hardest is the WALK: chapter two, built from somewhere
// else entirely, has to land beside chapter one — that is the whole feature, and
// everything else here follows from it.

const exec = promisify(execFile);
const CLI = new URL('../bin/prolog-notebook.mjs', import.meta.url).pathname;
const run = (args, options = {}) => exec('node', [CLI, ...args], {
  ...options,
  env: { NO_UPDATE_NOTIFIER: '1', ...process.env, ...options.env },
});

const NOTEBOOK = (title) => `---
format: prolog-notebook/1
---

# ${title}

\`\`\`prolog program id="p-app"
app([], L, L).
app([H|T], L, [H|R]) :- app(T, L, R).
\`\`\`

\`\`\`prolog query id="q-split"
app(X, Y, [1,2])
\`\`\`
`;

/** A project: a .git marker, and notebooks wherever they were asked for. */
async function project(files = {}) {
  const root = await mkdtemp(join(tmpdir(), 'prolog-notebook-project-'));
  await mkdir(join(root, '.git'), { recursive: true });
  for (const [path, title] of Object.entries(files)) {
    await mkdir(join(root, path, '..'), { recursive: true });
    await writeFile(join(root, path), NOTEBOOK(title));
  }
  return root;
}

test('the site is found by an existing site first, and the project root second', async () => {
  const root = await project({ 'notes/deep/lists.prolog.md': 'Splitting a list' });

  // Nothing built yet, so the .git is the only clue and the site goes to the
  // project root — not beside the notebook, three directories down.
  assert.equal(findSite(join(root, 'notes/deep/lists.prolog.md')), join(root, SITE));

  // Once a site exists NEARER the notebook, it wins: somebody has already decided
  // where this chapter's site is, and a marker further up does not overrule them.
  await mkdir(join(root, 'notes', SITE), { recursive: true });
  assert.equal(findSite(join(root, 'notes/deep/lists.prolog.md')), join(root, 'notes', SITE));
});

test('a notebook with no project falls back to where you are standing', async () => {
  // No .git, no site: there is nothing to go on, so it must not go wandering up
  // into someone's home directory looking for a marker that means nothing here.
  const loose = await mkdtemp(join(tmpdir(), 'prolog-notebook-loose-'));
  await writeFile(join(loose, 'x.prolog.md'), NOTEBOOK('Loose'));
  const cwd = await mkdtemp(join(tmpdir(), 'prolog-notebook-cwd-'));
  assert.equal(findSite(join(loose, 'x.prolog.md'), cwd), join(cwd, SITE));
});

test('a page is named for its file, not for its title', () => {
  // The name is in the URL. An author who rewrites their H1 has not asked for
  // every link to their chapter to break.
  assert.equal(pageName('/a/b/lists.prolog.md'), 'lists');
  assert.equal(pageName('lists.md'), 'lists');
  assert.equal(pageName('ch04-cut.prolog.md'), 'ch04-cut');
});

test('the runtime, the engine and the stylesheet belong to the site', () => {
  for (const name of ['lib/notebook.js', 'swipl/swipl-bundle.js', 'notebook.css']) {
    assert.ok(isShared(name), `${name} is the site's`);
  }
  for (const name of ['index.html', 'app.js']) {
    assert.ok(!isShared(name), `${name} is the page's`);
  }
});

test('two chapters built from different folders make one site', async () => {
  const root = await project({
    'notes/cut.prolog.md': 'Where does the fence go?',
    'notes/deep/lists.prolog.md': 'Splitting a list',
  });

  const first = await run(['build', 'cut.prolog.md'], { cwd: join(root, 'notes') });
  // Said once, on the build that creates it, and never again.
  assert.match(first.stderr, /created \.\.\/prolog-notebook-site\/ — you may want it in \.gitignore/);
  assert.match(first.stderr, /3 files → \.\.\/prolog-notebook-site\/cut\/ \(13 shared with the site\)/);
  assert.match(first.stderr, /lists 1 notebook$/m);

  const second = await run(['build', 'lists.prolog.md'], { cwd: join(root, 'notes/deep') });
  assert.doesNotMatch(second.stderr, /created/);
  // THE POINT OF THE WHOLE CHANGE: from two directories down, it joined the site
  // that was already there rather than starting a second one.
  assert.match(second.stderr, /3 files → \.\.\/\.\.\/prolog-notebook-site\/lists\//);
  // AND IT DID NOT COPY 6.2 MB AGAIN. The ordinary post costs its own page.
  assert.match(second.stderr, /runtime and engine already there/);
  assert.match(second.stderr, /lists 2 notebooks$/m);

  const site = join(root, SITE);
  const there = await readdir(site);
  assert.deepEqual(there.sort(),
    ['.nojekyll', 'cut', 'index.html', 'lib', 'lists', 'notebook.css', 'swipl']);

  // One engine, one runtime, however many chapters — the six-chapter site was
  // six copies of 6.2 MB.
  // The chapter sits beside the page it produced: a reader can have the markdown,
  // and a rebuild has something to regenerate from.
  assert.deepEqual((await readdir(join(site, 'cut'))).sort(),
    ['app.js', 'cut.prolog.md', 'index.html']);
  assert.deepEqual((await readdir(join(site, 'lists'))).sort(),
    ['app.js', 'index.html', 'lists.prolog.md']);
  assert.ok(existsSync(join(site, 'swipl/swipl-bundle.js')));

  // And each page reaches them by climbing one directory, which is the only
  // difference between a page in a site and a page on its own.
  const app = await readFile(join(site, 'cut/app.js'), 'utf8');
  assert.match(app, /from '\.\.\/lib\/notebook\.js'/);
  assert.match(app, /\.\.\/swipl\/swipl-bundle\.js/);
  assert.match(await readFile(join(site, 'cut/index.html'), 'utf8'),
    /<link rel="stylesheet" href="\.\.\/notebook\.css">/);
});

test('the index is regenerated from the directory on every build', async () => {
  const root = await project({
    'a.prolog.md': 'Splitting a list',
    'b.prolog.md': 'Where does the fence go?',
  });
  await run(['build', 'a.prolog.md'], { cwd: root });
  await run(['build', 'b.prolog.md'], { cwd: root });

  const index = await readFile(join(root, SITE, 'index.html'), 'utf8');
  // Titles are the spine's link text, seeded from each chapter's own H1 — so a
  // chapter is right the moment it is bound, and renaming it in the contents is
  // the binder's business afterwards (869eu5tg1).
  assert.match(index, /<a href="a\/">Splitting a list<\/a>/);
  assert.match(index, /<a href="b\/">Where does the fence go\?<\/a>/);
  // In the order they were bound, which is now the author's to change: it used to
  // be alphabetical because there was nowhere for a real order to live.
  assert.ok(index.indexOf('href="a/"') < index.indexOf('href="b/"'));
  // It borrows the chapter stylesheet, so it cannot drift from the pages it lists.
  assert.match(index, /<link rel="stylesheet" href="\.\/notebook\.css">/);
});

test('the index counts pages, and nothing else in the directory', async () => {
  const site = await mkdtemp(join(tmpdir(), 'prolog-notebook-site-'));
  await mkdir(join(site, 'lib'), { recursive: true });
  await mkdir(join(site, 'swipl'), { recursive: true });
  await mkdir(join(site, 'images'), { recursive: true });
  await mkdir(join(site, 'cut'), { recursive: true });
  await writeFile(join(site, 'lib/notebook.js'), '');
  await writeFile(join(site, 'cut/index.html'), '<title>Where does the fence go?</title>');
  await writeFile(join(site, 'images/photo.png'), '');

  // A directory with no index.html is not a page. The site is somebody's
  // directory and may hold things we did not put there.
  assert.deepEqual(pagesIn(site), [{ name: 'cut', title: 'Where does the fence go?' }]);
  assert.deepEqual(pagesIn(join(site, 'nowhere')), []);
});

test('the contents page renders its prose as the markdown it is', () => {
  const html = indexHtml({
    title: 'Studies',
    blocks: [
      { kind: 'prose', text: 'Press **Run**, then `; next`.\nIt wraps.' },
      { kind: 'chapter', title: 'Lists', href: 'lists/' },
    ],
  });
  // The spine is markdown for the same reason a notebook is, so its prose has to
  // MEAN markdown — escaping it left readers looking at asterisks and backticks.
  assert.match(html, /<strong>Run<\/strong>/);
  assert.match(html, /<code>; next<\/code>/);
  assert.doesNotMatch(html, /\*\*Run\*\*/);
  // And one wrapped paragraph is one <p>, not one per line.
  assert.equal((html.match(/<p>/g) ?? []).length, 1);
});

test('an index with nothing in it says so rather than showing an empty list', () => {
  assert.match(indexHtml(), /No notebooks here yet/);
  // A title with markup in it is a title, not markup.
  assert.match(
    indexHtml({ blocks: [{ kind: 'chapter', title: '<script>ha</script>', href: 'x/' }] }),
    /&lt;script&gt;/,
  );
});

test('--root skips a nearer site, and --out says where outright', async () => {
  const root = await project({ 'notes/lists.prolog.md': 'Splitting a list' });

  // Somebody has put a site in the subdirectory, so the walk finds it first —
  // which is the rule that makes chapter two join chapter one, and the rule that
  // needs a way out (869etpd4c).
  await mkdir(join(root, 'notes', SITE), { recursive: true });
  await run(['build', 'lists.prolog.md'], { cwd: join(root, 'notes') });
  assert.ok(existsSync(join(root, 'notes', SITE, 'lists/index.html')), 'nearest won');
  assert.ok(!existsSync(join(root, SITE)), 'and the project site was not touched');

  // --root is the way out, and the word for "where publish will look".
  await run(['build', '--root', 'lists.prolog.md'], { cwd: join(root, 'notes') });
  assert.ok(existsSync(join(root, SITE, 'lists/index.html')));

  const elsewhere = await mkdtemp(join(tmpdir(), 'prolog-notebook-out-'));
  await run(['build', 'lists.prolog.md', '--out', elsewhere], { cwd: join(root, 'notes') });
  assert.ok(existsSync(join(elsewhere, 'lists/index.html')));
  assert.ok(existsSync(join(elsewhere, 'index.html')));

  // Two flags naming a destination is a question, not a preference order.
  const both = await run(['build', '--root', '--out', elsewhere, 'lists.prolog.md'],
    { cwd: join(root, 'notes') }).catch((e) => e);
  assert.equal(both.code, 2);
  assert.match(both.stderr, /--root and --out both say where to write/);

  // And the flag it replaces is gone rather than quietly accepted.
  const here = await run(['build', '--here', 'lists.prolog.md'], { cwd: join(root, 'notes') })
    .catch((e) => e);
  assert.equal(here.code, 2);
  assert.match(here.stderr, /unknown option "--here"/);
});

test('projectSite ignores a site that is not the project\'s', async () => {
  const root = await project({ 'notes/deep/lists.prolog.md': 'Splitting a list' });
  const notebook = join(root, 'notes/deep/lists.prolog.md');
  await mkdir(join(root, 'notes', SITE), { recursive: true });

  // The walk stops at the nearer one; the project's answer climbs past it to the
  // .git, which is the same place publish looks and the reason this exists.
  assert.equal(findSite(notebook), join(root, 'notes', SITE));
  assert.equal(projectSite(notebook), join(root, SITE));
});

test('every site carries the file that keeps Jekyll off it', async () => {
  // GitHub runs Jekyll over a published directory unless this is there, and it
  // would find a .prolog.md in every page directory to chew on — plus it drops
  // anything beginning with an underscore, silently (869etpd4c).
  const root = await project({ 'lists.prolog.md': 'Splitting a list' });
  await run(['build', 'lists.prolog.md'], { cwd: root });
  const marker = join(root, SITE, '.nojekyll');
  assert.ok(existsSync(marker), 'at the site root');
  assert.equal(await readFile(marker, 'utf8'), '', 'and empty: its content is its existence');
  // The site's, not the page's — one per site however many chapters.
  assert.ok(!existsSync(join(root, SITE, 'lists/.nojekyll')));
});

// ------------------------------------------------------- one runtime per site

/** Rewrite what the site says wrote it, so a rebuild meets an older neighbour. */
async function pretend(site, { runtime, engine }) {
  if (runtime) {
    await writeFile(join(site, 'lib/version.js'), `export const VERSION = '${runtime}';\n`);
  }
  if (engine) {
    await writeFile(join(site, 'swipl/version.js'), `export const SWIPL_WASM = "${engine}";\n`);
  }
}

test('versions compare by number, not by string', () => {
  // '0.10.0' > '0.9.0' is false as strings and true as versions, and this is
  // exactly the comparison that decides whether a site gets overwritten.
  assert.equal(compareVersions('0.10.0', '0.9.0'), 1);
  assert.equal(compareVersions('0.7.0', '0.7.0'), 0);
  assert.equal(compareVersions('0.6.5', '0.7.0'), -1);
  assert.equal(compareVersions('8.0.7', '8.0.7'), 0);
});

test('a site says nothing until something has been built into it', async () => {
  const empty = await mkdtemp(join(tmpdir(), 'prolog-notebook-empty-'));
  assert.equal(reconcile(empty).verdict, 'fresh');
});

test('a second chapter at the same version leaves the shared files alone', async () => {
  const root = await project({ 'a.prolog.md': 'A', 'b.prolog.md': 'B' });
  await run(['build', 'a.prolog.md'], { cwd: root });
  const site = join(root, SITE);
  assert.deepEqual(reconcile(site), {
    verdict: 'same',
    have: { runtime: VERSION, engine: ENGINE_VERSION },
    ours: { runtime: VERSION, engine: ENGINE_VERSION },
  });

  // The engine is 6.2 MB. Not touching it is the entire point of a shared site.
  const before = (await stat(join(site, 'swipl/swipl-bundle.js'))).mtimeMs;
  const second = await run(['build', 'b.prolog.md'], { cwd: root });
  assert.equal((await stat(join(site, 'swipl/swipl-bundle.js'))).mtimeMs, before);
  assert.match(second.stderr, /runtime and engine already there/);
  assert.doesNotMatch(second.stderr, /regenerated/);
});

test('a runtime that moved without the version moving is replaced', async () => {
  const root = await project({ 'a.prolog.md': 'A', 'b.prolog.md': 'B' });
  await run(['build', 'a.prolog.md'], { cwd: root });
  await run(['build', 'b.prolog.md'], { cwd: root });
  const site = join(root, SITE);

  // THE VERSION IS THE KEY, AND IT STOPS BEING EVIDENCE WHILE THE RUNTIME IS
  // BEING DEVELOPED (869etggpr): edit src/notebook.js, rebuild, reload, and the
  // page ran yesterday's code because both sides still said 0.9.0. Standing in
  // for that here by moving the site's copy instead of ours — the comparison is
  // the same one either way, and this does not depend on the state of anybody's
  // checkout.
  await writeFile(join(site, 'lib/notebook.js'), '// yesterday\n');
  const engine = (await stat(join(site, 'swipl/swipl-bundle.js'))).mtimeMs;

  const { stderr } = await run(['build', 'a.prolog.md'], { cwd: root });
  assert.match(stderr, /runtime .* rewritten — its files had changed without the version moving/);
  // Every page is generated by that same code, so they all come with it.
  assert.match(stderr, /2 pages rebuilt/);
  assert.notEqual(await readFile(join(site, 'lib/notebook.js'), 'utf8'), '// yesterday\n');

  // AND THE ENGINE IS STILL NOT TOUCHED. 6.2 MB is not worth comparing to answer
  // a question its version already answers — it is somebody else's dependency,
  // and its version really does move with its bytes.
  assert.equal((await stat(join(site, 'swipl/swipl-bundle.js'))).mtimeMs, engine);

  // And it goes quiet again once the site holds what we would write.
  assert.doesNotMatch((await run(['build', 'a.prolog.md'], { cwd: root })).stderr, /rewritten/);
});

test('a newer tool takes the whole site with it, and says so', async () => {
  const root = await project({ 'a.prolog.md': 'A', 'b.prolog.md': 'B', 'c.prolog.md': 'C' });
  await run(['build', 'a.prolog.md'], { cwd: root });
  await run(['build', 'b.prolog.md'], { cwd: root });
  const site = join(root, SITE);

  // The site was written by an older tool with an older engine.
  await pretend(site, { runtime: '0.6.0', engine: '8.0.1' });
  assert.equal(reconcile(site).verdict, 'newer');

  const stale = await readFile(join(site, 'a/app.js'), 'utf8');
  await writeFile(join(site, 'a/app.js'), '// generated by something older\n');

  const built = await run(['build', 'c.prolog.md'], { cwd: root });

  // A page generated by an older tool imports symbols from a lib/ that has just
  // moved under it, so leaving it alone is not the cautious option — it is the
  // one that breaks it. Each page holds its own chapter, so the site rebuilds
  // itself with no source tree and no manifest.
  assert.equal(await readFile(join(site, 'a/app.js'), 'utf8'), stale);
  assert.match(built.stderr, new RegExp(`runtime 0\\.6\\.0 → ${VERSION} · 2 pages regenerated`));
  // What regeneration cannot fix is named rather than fixed by force: the answers
  // came out of the old engine and live in the author's file.
  assert.match(built.stderr, new RegExp(`engine 8\\.0\\.1 → ${ENGINE_VERSION}`));
  assert.match(built.stderr, /re-run `execute` on your chapters/);

  // And the site now agrees with itself.
  assert.deepEqual(reconcile(site).verdict, 'same');
});

test('an engine bump alone does not claim the runtime moved', async () => {
  const root = await project({ 'a.prolog.md': 'A', 'b.prolog.md': 'B' });
  await run(['build', 'a.prolog.md'], { cwd: root });
  const site = join(root, SITE);
  await pretend(site, { engine: '8.0.1' });

  const built = await run(['build', 'b.prolog.md'], { cwd: root });
  assert.match(built.stderr, /engine 8\.0\.1 →/);
  assert.doesNotMatch(built.stderr, /^runtime /m);
});

test('a site built by a newer tool is refused, not downgraded', async () => {
  const root = await project({ 'a.prolog.md': 'A', 'b.prolog.md': 'B' });
  await run(['build', 'a.prolog.md'], { cwd: root });
  const site = join(root, SITE);
  await pretend(site, { runtime: '99.0.0' });

  // Overwriting would downgrade every page in the site, none of which the author
  // named — the case they almost certainly did not mean.
  const failed = await run(['build', 'b.prolog.md'], { cwd: root }).catch((e) => e);
  assert.equal(failed.code, 1);
  assert.match(failed.stderr, /was built by prolog-notebook 99\.0\.0/);
  assert.match(failed.stderr, /prolog-notebook upgrade/);
  assert.ok(!existsSync(join(site, 'b')), 'the page must not be half-written');
});

test('a page carries the chapter it was built from', async () => {
  const root = await project({ 'notes/lists.prolog.md': 'Splitting a list' });
  await run(['build', 'lists.prolog.md'], { cwd: join(root, 'notes') });
  const chapter = sourceOf(join(root, SITE), 'lists');
  assert.equal(chapter.filename, 'lists.prolog.md');
  assert.match(chapter.source, /^# Splitting a list$/m);
  // A page with no chapter beside it says so rather than being skipped in silence.
  assert.equal(sourceOf(join(root, SITE), 'nothing-here'), null);
});
