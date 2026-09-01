import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { NOBODY, pagesUrl } from '../src/publish.js';

// The site onto a branch a host will serve (869ery8ac).
//
// EVERY TEST HERE PUSHES FOR REAL, to a bare repository of its own. Nothing about
// this command is worth testing against a stub: what could go wrong is that the
// tree is empty, or that the author's checkout moved, and only git can say.

const exec = promisify(execFile);
const CLI = new URL('../bin/prolog-notebook.mjs', import.meta.url).pathname;
const CHAPTER = new URL('../notebooks/ch04-cut.prolog.md', import.meta.url).pathname;

/**
 * NO GIT IDENTITY, NO GIT CONFIG — the environment CI actually has.
 *
 * The first version of these tests inherited the developer's global git config,
 * so `commit-tree` found an author and every test passed here and failed on the
 * runner with "Please tell me who you are". A test that borrows something from
 * the machine it runs on is testing that machine.
 *
 * So the config is scrubbed for every git command AND for the CLI itself: this
 * file's fixtures name an identity per-commit, and publish has to cope with there
 * being none.
 */
function bare(extra = {}) {
  const env = { ...process.env, ...extra };
  // REMOVED, NOT BLANKED. An empty GIT_AUTHOR_NAME is set-and-empty, which git
  // rejects outright — a stricter thing than having no identity at all, and not
  // the state under test.
  for (const key of Object.keys(env)) {
    if (/^GIT_(AUTHOR|COMMITTER)_/.test(key)) delete env[key];
  }
  return { ...env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
}

const run = (args, cwd) => exec('node', [CLI, ...args], {
  cwd,
  env: bare({ NO_UPDATE_NOTIFIER: '1' }),
});
const git = (args, cwd) => exec('git', args, { cwd, env: bare() })
  .then(({ stdout }) => stdout.trim());

/**
 * A repository with a bare remote, a chapter, and the site gitignored.
 *
 * GITIGNORED ON PURPOSE: `build` tells authors they may want it there, and
 * `git add -A` honours .gitignore. Every test in this file would pass against a
 * publish that pushed an empty tree if the fixture did not do this.
 */
async function project({ build = true } = {}) {
  const where = await mkdtemp(join(tmpdir(), 'prolog-notebook-publish-'));
  const remote = join(where, 'remote');
  const work = join(where, 'work');
  await mkdir(remote, { recursive: true });
  await mkdir(join(work, 'notes'), { recursive: true });
  await git(['init', '-q', '--bare', '.'], remote);
  await git(['init', '-q', '.'], work);
  await git(['remote', 'add', 'origin', remote], work);
  await writeFile(join(work, '.gitignore'), 'prolog-notebook-site/\n');
  await cp(CHAPTER, join(work, 'notes/cut.prolog.md'));
  await git(['add', '-A'], work);
  await git(['-c', 'user.email=t@t', '-c', 'user.name=T', 'commit', '-qm', 'init'], work);
  // git without a global config defaults the branch name and warns; name it, so
  // the assertion about not moving off it is about publish rather than about git.
  await git(['branch', '-M', 'main'], work);
  if (build) await run(['build', 'notes/cut.prolog.md'], work);
  return { work, remote };
}

test('pagesUrl reads a GitHub remote, and admits when it cannot', () => {
  assert.equal(pagesUrl('git@github.com:jarecsni/prolog-studies.git'),
    'https://jarecsni.github.io/prolog-studies/');
  assert.equal(pagesUrl('https://github.com/jarecsni/prolog-studies'),
    'https://jarecsni.github.io/prolog-studies/');
  // A repository named for its owner is the user site, served at the domain root.
  assert.equal(pagesUrl('git@github.com:jarecsni/jarecsni.github.io.git'),
    'https://jarecsni.github.io/');
  // Somewhere else entirely: say nothing rather than guess at a URL.
  assert.equal(pagesUrl('git@gitlab.com:jarecsni/prolog-studies.git'), null);
  assert.equal(pagesUrl(null), null);
});

test('the site goes onto the branch, gitignored or not', async () => {
  const { work, remote } = await project();
  const { stderr } = await run(['publish', '--yes'], work);
  assert.match(stderr, /1 notebook → origin gh-pages/);
  assert.match(stderr, /Pushed \d+ files to origin gh-pages\./);

  const files = (await git(['ls-tree', '-r', '--name-only', 'gh-pages'], remote)).split('\n');
  // THE -f CASE. Without it `add -A` honours the .gitignore this fixture writes,
  // and the publish is an empty tree reported as a success.
  assert.ok(files.length > 10, `something actually went: ${files.length} files`);
  // At the root of the branch, because that is what Pages serves as "/".
  assert.ok(files.includes('index.html'), 'the site index');
  assert.ok(files.includes('cut/index.html'), 'the chapter');
  assert.ok(files.includes('.nojekyll'), 'and the file that keeps Jekyll off it');
  assert.ok(files.includes('swipl/swipl-bundle.js'), 'engine included');

  // A MACHINE WITH NO GIT IDENTITY IS WHERE THIS COMMAND IS MOST USEFUL, and
  // where it used to die: `commit-tree` refuses without one. It stands in, and
  // says it has, rather than inventing a name in silence.
  assert.match(stderr, new RegExp(`the commit is by ${NOBODY[0]} <${NOBODY[1]}>`));
  const author = await git(['log', '-1', '--format=%an <%ae>', 'gh-pages'], remote);
  assert.equal(author, `${NOBODY[0]} <${NOBODY[1]}>`);
});

test('an author with an identity publishes under their own', async () => {
  const { work, remote } = await project();
  await git(['config', 'user.name', 'Johnny'], work);
  await git(['config', 'user.email', 'j@example.com'], work);

  const { stderr } = await run(['publish', '--yes'], work);
  // It is their publish, so it is their name on it, and nothing is said about
  // standing in for anybody.
  assert.equal(await git(['log', '-1', '--format=%an <%ae>', 'gh-pages'], remote),
    'Johnny <j@example.com>');
  assert.doesNotMatch(stderr, /no author identity/);
});

test('it never touches the checkout, however dirty', async () => {
  const { work } = await project();
  await writeFile(join(work, 'notes/scratch.txt'), 'mid-edit\n');
  await writeFile(join(work, 'notes/cut.prolog.md'), '# edited\n');

  await run(['publish', '--yes'], work);

  // Still on the branch it was on, with nothing staged and the edits exactly as
  // they were: the commit is built through a separate index and work-tree
  // precisely so an author can publish in the middle of working.
  assert.equal(await git(['rev-parse', '--abbrev-ref', 'HEAD'], work), 'main');
  assert.equal(await git(['diff', '--cached', '--name-only'], work), '');
  // Asked as the properties they are rather than as porcelain's formatting: the
  // leading space on a ` M` line does not survive a trim, and a test that depends
  // on that is a test about whitespace.
  const untracked = await git(['ls-files', '--others', '--exclude-standard'], work);
  assert.match(untracked, /notes\/scratch\.txt/, 'the untracked file is still untracked');
  const unstaged = await git(['diff', '--name-only'], work);
  assert.match(unstaged, /notes\/cut\.prolog\.md/, 'and the edit is still unstaged');
});

test('a second publish descends from the first', async () => {
  const { work, remote } = await project();
  await run(['publish', '--yes'], work);
  await run(['publish', '--yes'], work);

  // Parented on what is already there, so a publish is an ordinary fast-forward
  // rather than a force-push — which is also what makes git refuse one that would
  // clobber somebody else's work, rather than us remembering to ask.
  const log = (await git(['log', '--format=%H %P', 'gh-pages'], remote)).split('\n');
  assert.equal(log.length, 2);
  const [second, first] = log.map((line) => line.split(' '));
  assert.equal(second[1], first[0], 'the newer commit names the older as its parent');
});

test('--dry-run says what would go and pushes nothing', async () => {
  const { work, remote } = await project();
  const { stderr } = await run(['publish', '--dry-run'], work);
  assert.match(stderr, /\d+ files would be pushed\. Nothing was\./);
  const branches = await git(['branch', '--list'], remote);
  assert.equal(branches, '', 'the branch does not exist yet');
});

test('it refuses rather than guessing', async () => {
  // No repository: publishing is pushing, and no argument could supply one.
  const loose = await mkdtemp(join(tmpdir(), 'prolog-notebook-loose-'));
  const stray = await run(['publish', '--yes'], loose).catch((e) => e);
  assert.equal(stray.code, 2);
  assert.match(stray.stderr, /needs a git repository/);

  // A repository with no site: says what to run, including the case of somebody
  // who has a site — just not the one that can be served.
  const { work } = await project({ build: false });
  const empty = await run(['publish', '--yes'], work).catch((e) => e);
  assert.equal(empty.code, 1);
  assert.match(empty.stderr, /no site to publish/);
  assert.match(empty.stderr, /build --root/);

  // Nobody to ask, and this pushes to a public branch: a question no one can
  // answer is a hang, and a push nobody agreed to is worse.
  const { work: ready } = await project();
  const unasked = await run(['publish'], ready).catch((e) => e);
  assert.equal(unasked.code, 2);
  assert.match(unasked.stderr, /Nobody to ask.*Pass --yes/s);
});
