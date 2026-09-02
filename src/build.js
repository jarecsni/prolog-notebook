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
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { parse } from './format.js';
import { renderNotebook } from './render.js';

/**
 * Which swipl-wasm the bundle beside us came from.
 *
 * READ FROM THE DEPENDENCY, never written down twice: a constant we maintain by
 * hand is a constant that is wrong the first time somebody bumps the dependency
 * and forgets. This is the only thing in this file that touches the disk to
 * answer a question, and it is a question about the package rather than about a
 * notebook.
 */
const require = createRequire(import.meta.url);
export const ENGINE_VERSION = require('swipl-wasm/package.json').version;

/**
 * WHERE THE ENGINE ACTUALLY IS — asked for, never guessed (869erzf1j).
 *
 * This was `new URL('../node_modules/swipl-wasm/dist/swipl/', import.meta.url)`,
 * which is true in a checkout and false in every install: npm HOISTS, so
 * swipl-wasm lands as a SIBLING of this package rather than inside it, and
 * `build` died on a missing file for anybody who had installed the tool rather
 * than cloned it. Nested is the exception npm resorts to on a version conflict —
 * the one layout that literal assumed was the one npm avoids.
 *
 * Node's own resolution finds the package wherever it was put: hoisted, nested,
 * inside pnpm's store, or in a workspace. The line above already asked properly
 * for the version; this one now asks properly for the bytes.
 */
export const ENGINE_HOME = new URL(
  'dist/swipl/',
  pathToFileURL(require.resolve('swipl-wasm/package.json')),
);

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
export const FAVICON = encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">'
  + '<rect width="32" height="32" rx="7" fill="#faf7f0"/>'
  + '<text x="16" y="23" font-family="ui-monospace,Menlo,monospace" font-size="19"'
  + ' font-weight="600" fill="#8a3b1e" text-anchor="middle">?-</text></svg>',
);

/** The one engine file: the bundle carries its own data. */
export const ENGINE = 'swipl-bundle.js';

/**
 * WHICH ENGINE IS IN THIS DIRECTORY, written beside it (869erqwkp).
 *
 * The design for this said to read the versions back out of the site rather than
 * write a manifest, and for the runtime that works — lib/version.js is already
 * there and carries ours. THE BUNDLE CANNOT ANSWER FOR ITSELF: it is a megabyte
 * of minified glue around base64 data with no version string in it, and comparing
 * bytes can only say DIFFERENT, never NEWER. So the one fact we cannot recover is
 * recorded, in the smallest place that makes sense: a module beside the artefact
 * it describes, not a manifest at the root describing everything.
 */
export const ENGINE_VERSION_FILE = 'swipl/version.js';

/**
 * THE FILE THAT STOPS GITHUB READING THE SITE AS A JEKYLL PROJECT (869etpd4c).
 *
 * Pages runs Jekyll over a published directory unless this is there. It would try
 * to process the chapters — every page directory now holds the .prolog.md it was
 * built from (869erqwkp) — and it SILENTLY IGNORES anything whose name begins
 * with an underscore, which is a way to lose files with no error anywhere.
 *
 * Emitted by build rather than by publish, because the site is wrong without it
 * whoever uploads: rsync, a zip, a drag into Netlify, or us. Empty, because its
 * whole content is its existence.
 */
export const NOJEKYLL = '.nojekyll';

/**
 * The page, as a map of file name to what belongs there.
 *
 * @param {{frontMatter: Map<string,string>, cells: object[]}} notebook parsed
 * @param {string} source the notebook's own bytes, for the download
 * @param {{filename?: string, src?: URL, engine?: URL, prefix?: string, nav?: object}} [options]
 *   `src` is the directory holding the runtime modules and `engine` the
 *   directory holding swipl-wasm's bundle — arguments rather than constants so a
 *   test can point them anywhere and an installed package can find its own.
 *   `prefix` is how the page reaches the shared files: `./` when it is alone in a
 *   directory, `../` when it is one page of a site whose runtime and engine live
 *   at the root (869ery5e8). It is the ONLY thing that differs between the two,
 *   which is why the map's keys do not change.
 * @returns {Map<string, {text: string}|{copy: URL}>}
 */
export function buildFiles(notebook, source, options = {}) {
  const {
    filename = 'notebook.prolog.md',
    src = new URL('./', import.meta.url),
    engine = ENGINE_HOME,
    prefix = './',
    engineVersion = ENGINE_VERSION,
    nav = null,
  } = options;

  const files = new Map();
  files.set('index.html', { text: page(notebook, prefix, nav) });
  files.set('app.js', { text: app(source, filename, prefix) });
  files.set('notebook.css', { copy: new URL('notebook.css', src) });
  for (const module of RUNTIME) files.set(`lib/${module}`, { copy: new URL(module, src) });
  files.set(`swipl/${ENGINE}`, { copy: new URL(ENGINE, engine) });
  files.set(NOJEKYLL, { text: '' });
  files.set(ENGINE_VERSION_FILE, {
    text: '// Generated by prolog-notebook build. Which engine is in this directory.\n'
      + `export const SWIPL_WASM = ${JSON.stringify(engineVersion)};\n`,
  });
  // THE CHAPTER ITSELF, beside the page it produced.
  //
  // It is already inside app.js, because the "as published" download hands back
  // the author's own bytes. As a real file it is also what a rebuild reads to
  // regenerate this page against a newer runtime (869erqwkp) — regexing a source
  // back out of generated JavaScript would work and would be a thing nobody
  // should have to look at. And the markdown sitting on the site next to the page
  // is the whole argument for the format.
  files.set(filename, { text: source });
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
 *
 * Exported because a seeded spine names its first chapter with it (869eu5tg1),
 * and two answers to "what is this chapter called" would drift.
 */
export function titleOf(notebook) {
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

function page(notebook, prefix, nav) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(titleOf(notebook))}</title>
<link rel="icon" href="data:image/svg+xml,${FAVICON}">
<link rel="stylesheet" href="${prefix}notebook.css">
</head>
<body>
<main>
<!--
  FIRST IN THE DOCUMENT, AND IT COSTS A READER NOTHING (869erqq1u). mount()
  removes this element, and the stylesheet holds it invisible for a second and a
  half before revealing it — so a page that boots never shows it, and a page that
  cannot boot says so where somebody staring at a dead button will see it. It
  used to sit AFTER the chapter, several screens below the fold, which is the one
  place it could not do its job.

  The delay is CSS rather than a timer, for the obvious reason: script is exactly
  what is broken when this matters.
-->
<div id="boot-warning">
  <strong>This notebook is not running.</strong>
  The page loaded but its JavaScript did not. The usual cause is opening
  <code>index.html</code> straight from disk — browsers refuse ES modules over
  <code>file://</code>, and the engine cannot be fetched there either. Serve this
  directory over HTTP, or run <code>prolog-notebook view</code> on the notebook
  itself. The chapter is readable either way; only the buttons need this.
</div>
${crumbs(nav)}${renderNotebook(notebook)}${chapterNav(nav)}
</main>
<script type="module" src="app.js"></script>${keys(nav)}
</body>
</html>
`;
}

/**
 * WHERE THIS PAGE SITS, and how to get out of it (869eun9qa).
 *
 * A published chapter used to have no links on it at all: somebody arriving from
 * a search result was in a dead end, with nothing but URL-trimming to get them to
 * the contents. This is the way out.
 *
 * GENERATED MATTER, NOT NOTEBOOK CONTENT. binding.md §1 is emphatic that a binder
 * does not reach into a chapter — it emits its own pages around it — and the
 * precedent for merging one of those into the chapter's own page is the kicker,
 * which is there "because a separate cover page on the web is a click in the
 * way". The same argument applies twice over to navigation. So the chapter file
 * is untouched, and a chapter built with no book gets none of this.
 */
function crumbs(nav) {
  if (!nav?.trail?.length) return '';
  const links = nav.trail
    .map((a) => `<a href="${escapeHtml(a.href)}">${escapeHtml(a.title)}</a>`)
    .join('<span aria-hidden="true">\u203a</span>');
  return `<nav class="crumbs" aria-label="Breadcrumb">${links}</nav>\n`;
}

/**
 * The foot of a chapter: what comes before it, what comes after, and its contents.
 *
 * THE TITLE IS THE CONTROL, NOT THE ARROW. A bare pair of chevrons makes a reader
 * click a glyph and find out afterwards where they went; naming the destination
 * lets them decide before they move.
 *
 * A MISSING NEIGHBOUR IS ABSENT, NOT DISABLED. At the first chapter there is no
 * card on the left. A disabled control claims "this could happen, but not now",
 * and at chapter one there is no previous chapter — not now, not ever.
 *
 * The names come from the SPINE rather than from each chapter's H1: the reader
 * clicked those words in the contents, and a book is allowed to rename a chapter
 * for its own table of contents (§3).
 */
function chapterNav(nav) {
  if (!nav) return '';
  const card = (entry, rel, label) => (entry
    ? `<a class="${rel}" rel="${rel}" href="${escapeHtml(entry.href)}">`
      + `<span class="dir">${label}</span>`
      + `<span class="name">${escapeHtml(entry.title)}</span></a>`
    : '');
  const cards = card(nav.prev, 'prev', '\u2190 Previous') + card(nav.next, 'next', 'Next \u2192');
  const up = nav.up
    ? `<p class="up"><a href="${escapeHtml(nav.up.href)}">${escapeHtml(nav.up.title)}</a></p>`
    : '';
  if (!cards && !up) return '';
  return `\n<nav class="chapter-nav${nav.prev ? '' : ' only-next'}" aria-label="Chapter">`
    + `${cards}</nav>\n${up}`;
}

/**
 * The arrow keys, and the one place they must do nothing.
 *
 * INLINE AND NOT A MODULE, so it works on the page that shows the boot warning:
 * being unable to run the engine is exactly when a reader wants to leave.
 *
 * IT READS THE LINKS RATHER THAN CARRYING ITS OWN COPY of the URLs, so there is
 * one place a destination is written down. And it stands down whenever a cell or
 * a prediction box has focus — on this page of all pages, eating cursor movement
 * would be maddening.
 */
function keys(nav) {
  if (!nav?.prev && !nav?.next) return '';
  return `
<script>
addEventListener('keydown', function (e) {
  if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.defaultPrevented) return;
  var el = document.activeElement;
  if (el && (el.isContentEditable || /^(input|textarea|select)$/i.test(el.tagName))) return;
  var rel = e.key === 'ArrowLeft' ? 'prev' : e.key === 'ArrowRight' ? 'next' : null;
  var link = rel && document.querySelector('.chapter-nav a[rel=' + rel + ']');
  if (link) { e.preventDefault(); location.href = link.href; }
});
</script>`;
}

/**
 * The wiring, and the source it hands back when a reader asks for a copy.
 *
 * The notebook's own bytes are embedded because "the chapter as published" has to
 * mean the bytes the author wrote, not a re-serialisation of the model — a
 * hand-written chapter would otherwise come back reformatted.
 */
function app(source, filename, prefix) {
  return `// Generated by prolog-notebook build. The chapter is already in index.html;
// this only wires it up.
import { editsOf, mount, offerDownload } from '${prefix}lib/notebook.js';
import { parse } from '${prefix}lib/format.js';
import { exportSource } from '${prefix}lib/export.js';

const SOURCE = ${JSON.stringify(source)};
const FILENAME = ${JSON.stringify(filename)};

const root = document.querySelector('main');
// The engine lives beside this file rather than in a node_modules the browser
// cannot see, so its location is passed rather than guessed.
const cells = mount(root, {
  swiplUrl: new URL('${prefix}swipl/${ENGINE}', import.meta.url).href,
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
