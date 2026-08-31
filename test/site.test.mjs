import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { SITE, findSite, indexHtml, isShared, pageName, pagesIn } from '../src/site.js';

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
  assert.match(first.stderr, /2 files → \.\.\/prolog-notebook-site\/cut\/ \(11 shared with the site\)/);
  assert.match(first.stderr, /lists 1 notebook$/m);

  const second = await run(['build', 'lists.prolog.md'], { cwd: join(root, 'notes/deep') });
  assert.doesNotMatch(second.stderr, /created/);
  // THE POINT OF THE WHOLE CHANGE: from two directories down, it joined the site
  // that was already there rather than starting a second one.
  assert.match(second.stderr, /2 files → \.\.\/\.\.\/prolog-notebook-site\/lists\//);
  assert.match(second.stderr, /lists 2 notebooks$/m);

  const site = join(root, SITE);
  const there = await readdir(site);
  assert.deepEqual(there.sort(), ['cut', 'index.html', 'lib', 'lists', 'notebook.css', 'swipl']);

  // One engine, one runtime, however many chapters — the six-chapter site was
  // six copies of 6.2 MB.
  assert.deepEqual((await readdir(join(site, 'cut'))).sort(), ['app.js', 'index.html']);
  assert.deepEqual((await readdir(join(site, 'lists'))).sort(), ['app.js', 'index.html']);
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
  // Titles come from each page's own <title>, which came from its H1 — so there
  // is no manifest to keep in step and no second place for a title to be wrong.
  assert.match(index, /<a href="a\/">Splitting a list<\/a>/);
  assert.match(index, /<a href="b\/">Where does the fence go\?<\/a>/);
  // Alphabetical by directory, which is the site's opinion to hold: a chapter
  // never states its own position.
  assert.ok(index.indexOf('href="a/"') < index.indexOf('href="b/"'));
  // It borrows the chapter stylesheet, so it cannot drift from the pages it lists.
  assert.match(index, /<link rel="stylesheet" href="notebook\.css">/);
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

test('an index with nothing in it says so rather than showing an empty list', () => {
  assert.match(indexHtml([]), /No notebooks here yet/);
  // A title with markup in it is a title, not markup.
  assert.match(indexHtml([{ name: 'x', title: '<script>ha</script>' }]), /&lt;script&gt;/);
});

test('--here builds beside the notebook, and --out wins over everything', async () => {
  const root = await project({ 'notes/lists.prolog.md': 'Splitting a list' });

  await run(['build', '--here', 'lists.prolog.md'], { cwd: join(root, 'notes') });
  assert.ok(existsSync(join(root, 'notes', SITE, 'lists/index.html')));
  // --here means HERE: the project's own site is not touched.
  assert.ok(!existsSync(join(root, SITE)));

  const elsewhere = await mkdtemp(join(tmpdir(), 'prolog-notebook-out-'));
  await run(['build', 'lists.prolog.md', '--out', elsewhere], { cwd: join(root, 'notes') });
  assert.ok(existsSync(join(elsewhere, 'lists/index.html')));
  assert.ok(existsSync(join(elsewhere, 'index.html')));
  assert.ok(!existsSync(join(root, SITE)));
});
