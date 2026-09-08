import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { serve, RELOAD_PATH, RELOAD_SCRIPT } from '../src/serve.js';
import { watchFiles } from '../src/watch.js';

const CLI = new URL('../bin/prolog-notebook.mjs', import.meta.url).pathname;
const exec = promisify(execFile);
const run = (args) => exec('node', [CLI, ...args], { env: { NO_UPDATE_NOTIFIER: '1', ...process.env } });

// THE AUTHOR SAVES AND THE PAGE COMES WITH THEM (869edp5c8). `view` already
// rebuilds on every request, so the page is never behind the file — this is the
// part that means you do not have to ask.

/** Resolves the first time `fn()` is true, or rejects after a second and a half. */
async function until(fn, what) {
  for (let i = 0; i < 150; i += 1) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.fail(`timed out waiting for ${what}`);
}

test('a save is noticed once, however many events it takes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'watch-'));
  const file = join(dir, 'ch.prolog.md');
  await writeFile(file, 'one');
  let fired = 0;
  const watcher = watchFiles([file], () => { fired += 1; });
  try {
    // An editor writes a file two or three times to save it once — truncate then
    // write, or write then rename — and a rebuild per event would be three.
    await writeFile(file, 'two');
    await writeFile(file, 'three');
    await until(() => fired > 0, 'the change to be noticed');
    await new Promise((r) => setTimeout(r, 120));
    assert.equal(fired, 1, 'one save is one rebuild');

    // A FILE THAT WAS NOT BEING WATCHED, in a directory that was not either,
    // until the set was armed again. This is what happens when `new` adds a
    // chapter to the spine of a book already being served.
    const other = join(await mkdtemp(join(tmpdir(), 'watch-')), 'later.prolog.md');
    await writeFile(other, 'one');
    await writeFile(other, 'two');
    await new Promise((r) => setTimeout(r, 120));
    assert.equal(fired, 1, 'a file nobody asked about is not a change');

    watcher.arm([file, other]);
    await writeFile(other, 'three');
    await until(() => fired === 2, 'the newly armed file to be noticed');
  } finally {
    watcher.close();
  }
});

test('a watched page carries the listener, and a built one never does', async () => {
  const files = new Map([
    ['index.html', { text: '<h1>chapter</h1>' }],
    ['app.js', { text: 'export const x = 1;' }],
  ]);
  const server = await serve(files, { port: 0, watch: true });
  try {
    const page = await fetch(server.url);
    assert.match(await page.text(), /EventSource\('\/__reload'\)/);
    // Only the page. A script tag appended to the runtime would be a syntax
    // error in a module, not a reload.
    assert.doesNotMatch(await (await fetch(new URL('/app.js', server.url))).text(), /EventSource/);

    // The stream opens, and stays open until something changes.
    const stream = await fetch(new URL(`/${RELOAD_PATH}`, server.url));
    assert.match(stream.headers.get('content-type'), /text\/event-stream/);
    const reader = stream.body.getReader();
    const said = [];
    const reading = (async () => {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        said.push(new TextDecoder().decode(value));
        if (said.join('').includes('data: changed')) return;
      }
    })();
    server.changed();
    await reading;
    assert.match(said.join(''), /data: changed/);
    reader.cancel().catch(() => {});
  } finally {
    // AN OPEN STREAM IS AN OPEN CONNECTION. Without the ending in close(), this
    // is where the suite would hang rather than fail — the worst way to learn it.
    await server.close();
  }
});

test('nothing is injected into a server that is not watching', async () => {
  const server = await serve(new Map([['index.html', { text: '<h1>chapter</h1>' }]]), { port: 0 });
  try {
    assert.equal(await (await fetch(server.url)).text(), '<h1>chapter</h1>');
    // And the route is not there either: it exists only while watching, so a
    // published site's server has never heard of it.
    assert.equal((await fetch(new URL(`/${RELOAD_PATH}`, server.url))).status, 404);
  } finally {
    await server.close();
  }
});

test('the reload keeps the reader where they were', () => {
  // The Captain's ticket: "Writing chapter 6 and being thrown back to the top on
  // every save is how a tool gets abandoned."
  assert.match(RELOAD_SCRIPT, /sessionStorage\.setItem\(key, String\(scrollY\)\)/);
  assert.match(RELOAD_SCRIPT, /scrollTo\(0, Number\(held\)\)/);
  // Keyed by page, so two chapters in two tabs do not inherit each other's, and
  // cleared once used, so a fresh visit tomorrow starts at the top.
  assert.match(RELOAD_SCRIPT, /'prolog-notebook:scroll:' \+ location\.pathname/);
  assert.match(RELOAD_SCRIPT, /removeItem\(key\)/);
  // Storage throws outright in some contexts rather than returning null, and a
  // page that will not load is a worse bug than a scroll position that is lost.
  assert.equal((RELOAD_SCRIPT.match(/catch/g) ?? []).length, 3);
});

test('--watch and --built are refused together', async () => {
  // --built reads the site into memory once, on purpose: it shows the artefact as
  // it stands. Watching for edits that cannot reach it would be a promise nothing
  // keeps.
  await assert.rejects(run(['view', '--watch', '--built', '--no-open']), (e) => {
    assert.equal(e.code, 2);
    assert.match(e.stderr, /nothing for --watch to notice/);
    return true;
  });
});
