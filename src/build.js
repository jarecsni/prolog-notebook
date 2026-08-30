// A chapter to a page that stands on its own (869ermwfv).
//
// The output is a plain static directory: open it, host it, zip it and send it.
// Nothing here is a bundler — the runtime is already plain ES modules with
// relative imports, so the "build" is a prerender plus a copy.
//
// WHAT THE PAGE DOES NOT CONTAIN is the interesting half. No markdown library:
// the prose is HTML by the time this writes it, which is exactly why page.js and
// notebook.js were split — a prerendered chapter needs the wiring, not the
// parser. And no engine on the critical path: 6.2 MB of WebAssembly sits in the
// directory and is fetched the first time somebody presses Run, so the chapter is
// readable with none of it, which is the property this whole project exists for.
//
// NOTHING IS WRITTEN HERE. This returns a MAP of what the directory should
// contain — generated text, or a path to copy — so that `build` can write it,
// `view` can serve it, and a test can read it, without any of the three
// disagreeing about what a page is.
import { parse } from './format.js';
import { renderNotebook } from './render.js';

/** The runtime a page needs. Copied side by side, so their relative imports hold. */
export const RUNTIME = [
  'notebook.js', 'browser.js', 'session.js', 'engine.js', 'worker.js',
  'clauses.js', 'export.js', 'format.js', 'version.js',
];

/**
 * The notebook's own prompt, `?-`, as a tab icon.
 *
 * A data: URI rather than a file, because the alternative is a favicon.ico 404 on
 * every single load and this audience opens the console (869ernmxe). An SVG so it
 * scales to whatever size the tab wants.
 */
const FAVICON = encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">'
  + '<rect width="32" height="32" rx="7" fill="#faf7f0"/>'
  + '<text x="16" y="23" font-family="ui-monospace,Menlo,monospace" font-size="19"'
  + ' font-weight="600" fill="#8a3b1e" text-anchor="middle">?-</text></svg>',
);

/** The one engine file: the bundle carries its own data. */
export const ENGINE = 'swipl-bundle.js';

/**
 * The page, as a map of file name to what belongs there.
 *
 * @param {{frontMatter: Map<string,string>, cells: object[]}} notebook parsed
 * @param {string} source the notebook's own bytes, for the download
 * @param {{filename?: string, src?: URL, engine?: URL}} [options]
 *   `src` is the directory holding the runtime modules and `engine` the
 *   directory holding swipl-wasm's bundle — arguments rather than constants so a
 *   test can point them anywhere and an installed package can find its own.
 * @returns {Map<string, {text: string}|{copy: URL}>}
 */
export function buildFiles(notebook, source, options = {}) {
  const {
    filename = 'notebook.prolog.md',
    src = new URL('./', import.meta.url),
    engine = new URL('../node_modules/swipl-wasm/dist/swipl/', import.meta.url),
  } = options;

  const files = new Map();
  files.set('index.html', { text: page(notebook) });
  files.set('app.js', { text: app(source, filename) });
  files.set('notebook.css', { copy: new URL('notebook.css', src) });
  for (const module of RUNTIME) files.set(`lib/${module}`, { copy: new URL(module, src) });
  files.set(`swipl/${ENGINE}`, { copy: new URL(ENGINE, engine) });
  return files;
}

/**
 * The page, rebuilt whenever the notebook has changed underneath it (869erpuhk).
 *
 * `view` used to build once and serve that forever, so an author who edited their
 * chapter and reloaded was shown the version the server had started with. A
 * reload is the gesture for "show me what I just did"; answering it with the old
 * page teaches an author to doubt their own edit.
 *
 * COMPARED BY BYTES, not by mtime. The point of a rebuild here is to be right
 * rather than quick — an editor that writes through a rename, a `git checkout`, a
 * clock that went backwards, two saves inside one millisecond, all of them are
 * changes and none of them reliably move an mtime the way one would hope. Reading
 * a chapter is microseconds and reparsing one is milliseconds, on a file the
 * author has open anyway.
 *
 * A BROKEN FILE KEEPS THE LAST GOOD PAGE AND SAYS SO. Silently serving the
 * previous version would be the same bug this exists to fix, so the page carries
 * the parser's own message. Blanking it instead would throw away a chapter over a
 * half-typed fence — an author saves mid-thought, and the useful thing on screen
 * is the last version that worked, labelled.
 *
 * @param {() => string} read the notebook's bytes, now
 * @param {{onError?: (e: Error) => void}} [options] and everything buildFiles takes
 * @returns {() => Map<string, {text: string}|{copy: URL}>}
 */
export function livePages(read, { onError = () => {}, ...options } = {}) {
  let last = null;
  let failing = null;
  return () => {
    let source = null;
    try {
      source = read();
      if (last && last.source === source) return last.files;
      const files = buildFiles(parse(source), source, options);
      last = { source, files };
      failing = null;
      return files;
    } catch (e) {
      // Nothing good to fall back to: this is the first build, and the caller —
      // the command — is the one that should report it and stop.
      if (!last) throw e;
      // Once per broken version, not once per request. A page fetches a dozen
      // files, and a terminal repeating the same syntax error a dozen times is
      // worse at communicating it than saying it once.
      if (failing !== source) onError(e);
      failing = source;
      return withNotice(last.files, e.message);
    }
  };
}

/**
 * The last good page, wearing the reason it is not the current one.
 *
 * A copy, so the good build is never mutated and recovering is simply serving it
 * again.
 */
function withNotice(files, message) {
  const index = files.get('index.html');
  if (index?.text === undefined) return files;
  const copy = new Map(files);
  copy.set('index.html', { text: index.text.replace('<body>', `<body>\n${notice(message)}`) });
  return copy;
}

/**
 * Inline styles, deliberately: this belongs to no chapter and must never depend
 * on a stylesheet the broken file might itself have been changing.
 */
function notice(message) {
  return '<div role="alert" style="position:sticky;top:0;z-index:99;padding:.7rem 1rem;'
    + 'background:#7a2618;color:#fff;font:500 .8rem/1.5 ui-monospace,Menlo,monospace">'
    + '<strong>This notebook does not currently parse.</strong> Showing the last version that'
    + ` did.<br>${escapeHtml(message)}</div>`;
}

/**
 * The chapter's own title, from its first H1 (format §2).
 *
 * Written into the HTML at build time rather than set by script on load: it is
 * the browser tab, the bookmark and the thing a link preview shows, and none of
 * those wait for JavaScript.
 */
function titleOf(notebook) {
  for (const cell of notebook.cells) {
    if (cell.kind !== 'markdown') continue;
    const heading = /^#\s+(.+)$/m.exec(cell.source);
    if (heading) return heading[1].trim();
  }
  return 'A Prolog notebook';
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function page(notebook) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(titleOf(notebook))}</title>
<link rel="icon" href="data:image/svg+xml,${FAVICON}">
<link rel="stylesheet" href="notebook.css">
</head>
<body>
<main>
${renderNotebook(notebook)}
<!--
  THE CHAPTER ABOVE IS ALREADY READABLE. Everything below is the runtime that
  makes it runnable, and none of it is needed to read a word.
-->
<div id="boot-warning">
  <strong>This notebook is not running.</strong>
  The page loaded but its JavaScript did not. The usual cause is opening
  <code>index.html</code> straight from disk — browsers block ES modules over
  <code>file://</code>. Serve it over HTTP instead, or run
  <code>prolog-notebook view</code> on the notebook itself.
  The chapter is readable either way; only the buttons need this.
</div>
</main>
<script type="module" src="app.js"></script>
</body>
</html>
`;
}

/**
 * The wiring, and the source it hands back when a reader asks for a copy.
 *
 * The notebook's own bytes are embedded because "the chapter as published" has to
 * mean the bytes the author wrote, not a re-serialisation of the model — a
 * hand-written chapter would otherwise come back reformatted.
 */
function app(source, filename) {
  return `// Generated by prolog-notebook build. The chapter is already in index.html;
// this only wires it up.
import { editsOf, mount, offerDownload } from './lib/notebook.js';
import { parse } from './lib/format.js';
import { exportSource } from './lib/export.js';

const SOURCE = ${JSON.stringify(source)};
const FILENAME = ${JSON.stringify(filename)};

const root = document.querySelector('main');
// The engine lives beside this file rather than in a node_modules the browser
// cannot see, so its location is passed rather than guessed.
const cells = mount(root, {
  swiplUrl: new URL('./swipl/${ENGINE}', import.meta.url).href,
});

const notebook = parse(SOURCE);
offerDownload(root, {
  produce: () => ({ filename: FILENAME, text: exportSource(notebook, editsOf(cells)) }),
  published: () => ({ filename: FILENAME, text: SOURCE }),
  isEdited: () => cells.programs.some((p) => p.isEdited())
    || cells.queries.some((q) => q.isEdited()),
  on: cells.on,
});
`;
}
