import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from '../src/format.js';
import { buildFiles, ENGINE, RUNTIME } from '../src/build.js';
import { contentType, openInBrowser, serve } from '../src/serve.js';

// A chapter to a page that stands on its own (869ermwfv), and the server that
// shows it (869ermwjv). The two share one map, so what you look at and what you
// would publish cannot drift apart — that is the thing most worth testing here.

const CHAPTER = readFileSync(new URL('../notebooks/ch04-cut.prolog.md', import.meta.url), 'utf8');
const built = () => buildFiles(parse(CHAPTER), CHAPTER, { filename: 'ch04-cut.prolog.md' });

test('the page is readable before anything is downloaded', () => {
  const html = built().get('index.html').text;

  // The property this project exists for: the answers are IN the page, not
  // fetched, not rendered by script.
  assert.match(html, /X = edward/);
  assert.match(html, /the chapter’s saved answers/);
  assert.match(html, /<div class="cell query"/);

  // The title is written at build time, not set on load: it is the browser tab,
  // the bookmark and the link preview, and none of those wait for JavaScript.
  assert.match(html, /<title>Where does the fence go\?<\/title>/);
});

test('the console is clean before a reader has done anything', () => {
  // This audience opens DevTools, and the first thing they saw was red: a
  // favicon 404 on every load, and an issues-panel warning for every form field
  // on the page (869ernmxe).
  const html = built().get('index.html').text;
  assert.match(html, /<link rel="icon" href="data:image\/svg\+xml,/);
  assert.doesNotMatch(html, /favicon\.ico/);

  for (const field of html.match(/<(?:textarea|input)[^>]*>/g) ?? []) {
    assert.match(field, /\sid="[^"]+"/, `every field needs an id: ${field}`);
  }
});

test('no markdown library reaches the reader', () => {
  // The prose is HTML by the time this is written, which is why page.js and
  // notebook.js are separate files. Shipping 137 kB of markdown parser to a page
  // that has nothing left to parse would undo that.
  for (const [name, entry] of built()) {
    if (entry.text === undefined) continue;
    assert.doesNotMatch(entry.text, /import .*markdown-it/, `${name} must not import a parser`);
  }
  assert.equal([...built().keys()].some((n) => n.includes('render.js')), false,
    'nor the renderer, which is what pulls it in');
});

test('the engine is there, and is not on the path to reading', () => {
  const files = built();
  assert.ok(files.has(`swipl/${ENGINE}`), 'Run has to work in a built page');
  const html = files.get('index.html').text;
  assert.doesNotMatch(html, /swipl/, 'but nothing in the page fetches it to be read');
  // It is asked for by name rather than guessed at: node_modules is not
  // something a browser can see.
  assert.match(files.get('app.js').text, new RegExp(`\\./swipl/${ENGINE}`));
});

test('the runtime is copied whole, so its relative imports still hold', () => {
  const files = built();
  for (const module of RUNTIME) {
    assert.ok(files.get(`lib/${module}`)?.copy, `${module} is part of the runtime`);
  }
  // notebook.js imports './browser.js'; browser.js computes './worker.js' from its
  // own URL. Side by side in one directory, all of that keeps working with no
  // rewriting — which is why this is a copy and not a bundle.
  assert.match(files.get('app.js').text, /from '\.\/lib\/notebook\.js'/);
});

test('the reader can take the chapter exactly as published', () => {
  // Its own bytes, embedded — not a re-serialisation of the model, which would
  // hand back a reformatted file for a hand-written chapter.
  const app = built().get('app.js').text;
  assert.ok(app.includes(JSON.stringify(CHAPTER)), 'the source travels with the page');
  assert.match(app, /published: \(\) => \(\{ filename: FILENAME, text: SOURCE \}\)/);
});

test('a notebook that does not parse is refused with its own line numbers', () => {
  assert.throws(
    () => buildFiles(parse('```prolog query id="q-1" hold="untill-run"\nfoo\n```\n'), '', {}),
    /hold="untill-run"/,
  );
});

// --------------------------------------------------------------- the server

test('it serves what was built, and nothing else at all', async () => {
  const files = built();
  const server = await serve(files, { port: 0 });
  try {
    const get = (path) => fetch(new URL(path, server.url));

    const index = await get('/');
    assert.equal(index.status, 200);
    assert.match(index.headers.get('content-type'), /text\/html/);
    assert.match(await index.text(), /X = edward/);

    assert.equal((await get('/app.js')).status, 200);
    assert.equal((await get('/lib/notebook.js')).status, 200);

    // Not a static file server, and it must not become one: the path never
    // reaches the filesystem, so there is nothing for a traversal to escape into.
    assert.equal((await get('/../package.json')).status, 404);
    assert.equal((await get('/lib/../../package.json')).status, 404);
    assert.equal((await get('/nothing.js')).status, 404);
    assert.equal((await fetch(server.url, { method: 'POST' })).status, 404);
  } finally {
    await server.close();
  }
});

test('a page being written must not be cached', async () => {
  const server = await serve(built(), { port: 0 });
  try {
    assert.equal((await fetch(server.url)).headers.get('cache-control'), 'no-store');
  } finally {
    await server.close();
  }
});

test('a port already taken is not a reason to stop', async () => {
  // A tool that dies because something else is on 8777 makes the reader find out
  // what. It takes another and says which.
  const first = await serve(built(), { port: 0 });
  try {
    const second = await serve(built(), { port: first.port });
    try {
      assert.notEqual(second.port, first.port);
      assert.equal((await fetch(second.url)).status, 200);
    } finally {
      await second.close();
    }
  } finally {
    await first.close();
  }
});

test('the browser is told what each thing is', () => {
  assert.match(contentType('index.html'), /text\/html/);
  assert.match(contentType('lib/notebook.js'), /text\/javascript/);
  assert.match(contentType('notebook.css'), /text\/css/);
  // The engine's own fetches: a wasm served as text is a wasm that will not
  // stream-compile.
  assert.equal(contentType('swipl/x.wasm'), 'application/wasm');
  assert.equal(contentType('swipl/x.data'), 'application/octet-stream');
});

test('the browser is opened the way each platform actually opens things', () => {
  const seen = [];
  const spawnImpl = (cmd, args) => {
    seen.push([cmd, args]);
    return { on() {}, unref() {} };
  };
  const url = 'http://127.0.0.1:8777/';
  openInBrowser(url, { spawnImpl, platform: 'darwin' });
  openInBrowser(url, { spawnImpl, platform: 'linux' });
  // `start` is a SHELL BUILTIN, not a program: spawning it by name fails every
  // time. The empty string is cmd's title argument — without it the URL becomes
  // the window title and nothing opens.
  openInBrowser(url, { spawnImpl, platform: 'win32' });

  assert.deepEqual(seen, [
    ['open', [url]],
    ['xdg-open', [url]],
    ['cmd', ['/c', 'start', '', url]],
  ]);
});

test('a machine with no opener keeps serving instead of dying', async () => {
  // spawn reports a missing program ASYNCHRONOUSLY, so a try/catch around it
  // catches nothing and an 'error' event with no listener is an uncaught
  // exception — which took the whole command down, after the server had started,
  // on any machine without a desktop.
  const { spawn } = await import('node:child_process');
  const child = openInBrowser('http://127.0.0.1:1/', {
    spawnImpl: (...args) => spawn('definitely-not-a-real-opener', ...args.slice(1)),
  });
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.ok(child, 'and the process is still here to assert it');
});

test('view and build ask about updates too, not only run', async () => {
  // The offer went into the execute path first and stayed there, so `view` — the
  // command somebody is most likely to leave running for an afternoon — was the
  // one that never looked. This asserts every command that does real work goes
  // through the same door.
  const cli = await import('node:fs').then((fs) => fs.readFileSync(
    new URL('../bin/prolog-notebook.mjs', import.meta.url), 'utf8'));
  const calls = [...cli.matchAll(/await upgradeFirst\(/g)];
  assert.equal(calls.length, 2, 'once for run, once for view and build together');
  // And before anything is served or written: the offer is worthless afterwards.
  assert.ok(cli.indexOf('await upgradeFirst()') < cli.indexOf('const server = await serve('));
  assert.ok(cli.indexOf('await upgradeFirst()') < cli.indexOf("if (command === 'build')"));
});
