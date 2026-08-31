import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdtemp, readdir, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

// THE PACKAGE AS SOMEBODY ELSE RECEIVES IT (869erzf1j).
//
// Every other test in this suite runs against the checkout, where node_modules
// sits exactly where a relative path expects it. That made a whole class of bug
// invisible: `build` looked for the engine at
// `<this package>/node_modules/swipl-wasm/…` and npm HOISTS it to a sibling, so
// the command died on a missing file for every person who installed the tool
// rather than cloning it — through 0.6.5, undetected, because we only ever ran it
// from here.
//
// This is the only test that can see that, and it can only see it by doing the
// slow thing: pack the tarball, install it somewhere else, and use it.
//
// NOT IN `npm test`, deliberately — it takes half a minute and wants a network,
// and `prepublishOnly` runs the fast suite. `npm run test:packaged` runs this,
// and CI runs it as its own step on every push.

const exec = promisify(execFile);
const REPO = new URL('..', import.meta.url).pathname;
const CHAPTER = new URL('../notebooks/ch04-cut.prolog.md', import.meta.url).pathname;

/** Pack this repo and install the tarball into a directory of its own. */
async function installed() {
  const where = await mkdtemp(join(tmpdir(), 'prolog-notebook-packaged-'));
  const { stdout } = await exec('npm', ['pack', '--pack-destination', where], { cwd: REPO });
  const tarball = join(where, stdout.trim().split('\n').pop());

  const home = await mkdtemp(join(tmpdir(), 'prolog-notebook-install-'));
  // An empty package.json, so npm installs here rather than walking up and
  // finding one of ours.
  await writeFile(join(home, 'package.json'), '{"name":"host","private":true}\n');
  await exec('npm', ['install', '--no-audit', '--no-fund', tarball], { cwd: home });
  return home;
}

test('the packaged tool builds a site from wherever npm put its engine', { timeout: 300_000 },
  async () => {
    const home = await installed();
    const pkg = join(home, 'node_modules/prolog-notebook');
    assert.ok(existsSync(pkg), 'the package installed');

    // THE PRECONDITION THAT MAKES THIS TEST MEAN ANYTHING. If npm had nested
    // swipl-wasm inside the package, the old hard-coded path would have worked and
    // this would pass while proving nothing. Hoisted is what npm does, and hoisted
    // is what broke it.
    assert.ok(existsSync(join(home, 'node_modules/swipl-wasm')),
      'swipl-wasm is hoisted to a sibling — the layout the bug was blind to');
    assert.ok(!existsSync(join(pkg, 'node_modules/swipl-wasm')),
      'and is NOT nested inside the package, where the old code looked for it');

    const work = await mkdtemp(join(tmpdir(), 'prolog-notebook-work-'));
    await cp(CHAPTER, join(work, 'cut.prolog.md'));
    const cli = join(pkg, 'bin/prolog-notebook.mjs');
    const { stderr } = await exec('node', [cli, 'build', 'cut.prolog.md'], {
      cwd: work,
      env: { NO_UPDATE_NOTIFIER: '1', ...process.env },
    });

    const site = join(work, 'prolog-notebook-site');
    assert.match(stderr, /files → /);
    assert.ok(existsSync(join(site, 'cut/index.html')), 'the page');
    assert.ok(existsSync(join(site, 'index.html')), 'the site index');

    // The engine is the file that was missing, and a truncated copy would be just
    // as broken as an absent one.
    const engine = join(site, 'swipl/swipl-bundle.js');
    assert.ok(existsSync(engine), 'the engine came out of the installed package');
    assert.ok((await stat(engine)).size > 1_000_000, 'and it is the whole bundle');

    // The runtime too, since it is copied the same way.
    assert.ok((await readdir(join(site, 'lib'))).includes('notebook.js'));
  });

test('the packaged tool runs a chapter', { timeout: 300_000 }, async () => {
  // `execute` reaches the engine by a different road — a Node import rather than a
  // file copy — so it is a second way for a packaging mistake to hide.
  const home = await installed();
  const cli = join(home, 'node_modules/prolog-notebook/bin/prolog-notebook.mjs');
  const work = await mkdtemp(join(tmpdir(), 'prolog-notebook-work-'));
  await cp(CHAPTER, join(work, 'cut.prolog.md'));

  const { stdout } = await exec('node', [cli, 'execute', '--stdout', '--quiet', 'cut.prolog.md'], {
    cwd: work,
    env: { NO_UPDATE_NOTIFIER: '1', ...process.env },
  });
  assert.match(stdout, /X = edward/);
});
