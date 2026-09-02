// One site, however many notebooks, and it finds itself (869ery5e8).
//
// `build` used to write beside the notebook it was given: lists.prolog.md became
// notebooks/lists-site/. Twenty chapters gave you twenty orphan sites, each with
// its own copy of the runtime, and nowhere for a table of contents to live —
// there was no "the site" for one to be a table of contents OF.
//
// So the destination is a property of the PROJECT rather than of the file, and
// the second chapter lands beside the first without being told to.
//
// NOTHING HERE WRITES ANYTHING, for the same reason build.js does not: this
// decides names and produces text, and the command does the I/O.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { ENGINE_VERSION, ENGINE_VERSION_FILE, FAVICON, NOJEKYLL } from './build.js';
import { VERSION } from './version.js';

/** The one name, wherever it lands. */
export const SITE = 'prolog-notebook-site';

/**
 * WHERE THE SITE IS, from the notebook being built.
 *
 * Walk up and take the first hit, in this order:
 *
 *   1. an existing prolog-notebook-site/ — somebody has already decided
 *   2. a .git/ — the project's own idea of where it begins
 *   3. the working directory — nothing to go on, so do not go looking
 *
 * CLUE 1 IS THE ONE THAT MATTERS and it is deliberately first: it means chapter
 * two, built from a different subfolder, joins chapter one's site rather than
 * starting a second one next to it. That is what makes an index possible at all,
 * and it is the precondition for a shared engine (869erqwkp).
 *
 * Clue 2 answers the first build, when clue 1 cannot exist yet. Both are looked
 * for on every step of the walk rather than one pass each, so a notebook inside a
 * submodule finds its own project rather than the one containing it.
 *
 * @param {string} from a notebook's path
 * @param {string} [stop] where to give up — the working directory
 * @returns {string} the site directory, which may not exist yet
 */
export function findSite(from, stop = process.cwd()) {
  return walk(from, stop, (dir) => (existsSync(join(dir, SITE)) || existsSync(join(dir, '.git'))
    ? join(dir, SITE) : null));
}

/**
 * THE PROJECT'S OWN SITE, skipping anything nearer (869etpd4c).
 *
 * The same walk with one clue removed: a site somebody put in a subdirectory is
 * not the project's, and this is the word for wanting the project's. It matters
 * because `publish` pushes the site at the git root and nothing else — so this is
 * how an author says "put this chapter where it can be published from" without
 * spelling a path relative to wherever they happen to be standing.
 */
export function projectSite(from, stop = process.cwd()) {
  return walk(from, stop, (dir) => (existsSync(join(dir, '.git')) ? join(dir, SITE) : null));
}

/** Up from a notebook, taking the first answer, and giving up where told. */
function walk(from, stop, answer) {
  let dir = resolve(dirname(from));
  const root = resolve(dir).split(/[\\/]/)[0] || '/';
  for (;;) {
    const found = answer(dir);
    if (found) return found;
    const up = dirname(dir);
    if (up === dir || dir === root) return join(resolve(stop), SITE);
    dir = up;
  }
}

/**
 * The notebook's own directory inside the site.
 *
 * The name a reader sees in the URL, so it comes from the file rather than from
 * the chapter's title: an author who renames their H1 has not asked for every
 * link to their page to break.
 */
export function pageName(file) {
  return basename(file).replace(/\.prolog\.md$/, '').replace(/\.md$/, '') || 'notebook';
}

/**
 * Files that belong to the SITE rather than to one page.
 *
 * The runtime, the engine and the stylesheet are identical for every chapter, so
 * they are written once at the site root and every page reaches them with `../`.
 * A six-chapter site was six copies of a 6.2 MB engine.
 */
export function isShared(name) {
  return name.startsWith('lib/') || name.startsWith('swipl/')
    || name === 'notebook.css' || name === NOJEKYLL;
}

/**
 * WHAT WROTE THIS SITE — the two keys a rebuild has to compare (869erqwkp).
 *
 *   prolog-notebook   decides lib/*.js, notebook.css and how a page is generated
 *   swipl-wasm        decides swipl-bundle.js, the bytes we copy
 *
 * SWI-Prolog's own version is a property of swipl-wasm rather than a third axis,
 * and it is not recorded: getting it means booting the engine, which is a second
 * of every build spent on a label. It belongs on the output block that the answers
 * came from, which is a different ticket and the place a reader would look.
 *
 * Both are read back out of the site rather than kept in a manifest at the root.
 * A directory that has been half-deleted then reports what it actually has.
 *
 * @returns {{runtime: string|null, engine: string|null}} null where the site is silent
 */
export function siteVersions(dir) {
  return {
    runtime: constIn(join(dir, 'lib/version.js'), /VERSION = '([^']+)'/),
    engine: constIn(join(dir, ENGINE_VERSION_FILE), /SWIPL_WASM = "([^"]+)"/),
  };
}

function constIn(file, pattern) {
  if (!existsSync(file)) return null;
  const found = pattern.exec(readFileSync(file, 'utf8'));
  return found ? found[1] : null;
}

/** -1, 0 or 1. Numeric where both sides are numeric, which ours and swipl-wasm's are. */
export function compareVersions(a, b) {
  const parts = (v) => String(v).split('.').map((n) => Number.parseInt(n, 10) || 0);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) < (y[i] ?? 0) ? -1 : 1;
  }
  return 0;
}

/**
 * A SITE HAS EXACTLY ONE RUNTIME: whichever tool last touched it (869erqwkp).
 *
 * The contract between a page's app.js and lib/ is NOT stable — `offerDownload`
 * gained arguments in #28 and `editsOf` moved modules in #40 — so a site holding
 * two generations of page has no safe resting state. Overwrite lib/ and the older
 * page imports a symbol that has moved; leave it and the page just built is the
 * broken one. There is no third option in which everything works, which is why
 * this reconciles rather than warns.
 *
 * BUILD IS SCOPED IN THE PAGES IT ADDS, NOT IN THE CONSISTENCY IT GUARANTEES.
 * Ordinarily that is one page and nothing else moves. The moment a key differs the
 * scope widens to the whole site, because that is the only state in which nothing
 * is broken.
 *
 * @returns {{verdict: 'fresh'|'same'|'newer'|'older', have: object, ours: object}}
 *   fresh  nothing there yet — write everything
 *   same   write the page; the runtime and engine are already the right ones
 *   newer  overwrite the shared files and regenerate every page
 *   older  refuse: a silent downgrade of pages the author did not name
 */
export function reconcile(dir, ours = { runtime: VERSION, engine: ENGINE_VERSION }) {
  const have = siteVersions(dir);
  if (!have.runtime && !have.engine) return { verdict: 'fresh', have, ours };
  const runtime = compareVersions(ours.runtime, have.runtime ?? '0');
  const engine = compareVersions(ours.engine, have.engine ?? '0');
  if (runtime < 0 || engine < 0) return { verdict: 'older', have, ours };
  if (runtime === 0 && engine === 0) return { verdict: 'same', have, ours };
  return {
    verdict: 'newer', have, ours, runtimeMoved: runtime > 0, engineMoved: engine > 0,
  };
}

/**
 * A built page's own chapter, for regenerating it against a newer runtime.
 *
 * The page directory holds the .prolog.md it was built from, so a site can be
 * rebuilt with no source tree, no repository and no manifest — it describes
 * itself. A page with no source file was not written by a version that emitted
 * one, and says so by returning null rather than by being silently skipped.
 *
 * @returns {{filename: string, source: string}|null}
 */
export function sourceOf(dir, page) {
  const where = join(dir, page);
  if (!existsSync(where)) return null;
  const found = readdirSync(where).find((f) => f.endsWith('.md'));
  return found ? { filename: found, source: readFileSync(join(where, found), 'utf8') } : null;
}

/**
 * What the site already contains, newest build included.
 *
 * READ BACK OFF DISK, NOT REMEMBERED. `build` is called once per chapter, often
 * from different directories and days apart, so the only thing that knows the
 * whole site is the site. Each page's own <title> is the answer — it is written
 * from the chapter's H1 at build time, so there is no manifest to keep in step
 * and no second place for a title to be wrong.
 *
 * A directory with no index.html is not a page and is left alone: the site is
 * somebody's directory and may hold things we did not put there.
 *
 * @returns {{name: string, title: string}[]} alphabetical by directory name
 */
export function pagesIn(dir) {
  if (!existsSync(dir)) return [];
  const pages = [];
  for (const name of readdirSync(dir).sort()) {
    const index = join(dir, name, 'index.html');
    if (name === 'lib' || name === 'swipl') continue;
    if (!existsSync(index) || !statSync(join(dir, name)).isDirectory()) continue;
    const html = readFileSync(index, 'utf8');
    const title = /<title>([^<]*)<\/title>/.exec(html);
    pages.push({ name, title: title ? unescapeHtml(title[1]) : name });
  }
  return pages;
}

/**
 * A book's contents page, rewritten on every build (869erptbr, 869eu5tg1).
 *
 * IT IS A RENDERING OF THE SPINE, not a list extracted from it. The author's
 * headings, their order and their prose are all on the page, because the file
 * they wrote IS the contents page and anything less would make them keep two
 * versions of the same opinion.
 *
 * Order used to be alphabetical, which the comment here called "the honest
 * placeholder until there is somewhere for a real order to live". There is now.
 * A site with no spine still gets one of these, built from the directory, which
 * is what keeps every 0.8 site working untouched.
 *
 * It borrows the chapter stylesheet rather than carrying its own, so it inherits
 * the palette, the dark mode and the typography, and cannot drift from the pages
 * it lists.
 *
 * @param {{title?: string, blocks?: object[], prefix?: string}} book
 */
export function indexHtml({ title = 'Prolog notebooks', blocks = [], prefix = './' } = {}) {
  // PREFACE IS WHAT COMES BEFORE THE FIRST ENTRY. After that, prose belongs to
  // the section it sits in — the rule has to be positional, because a heading
  // introducing the first part necessarily precedes every entry under it.
  const first = blocks.findIndex((b) => b.kind === 'chapter' || b.kind === 'book');
  const cut = first === -1 ? blocks.length : first;
  const preface = blocks.slice(0, cut).filter((b) => b.kind === 'prose');
  const contents = [...blocks.slice(0, cut).filter((b) => b.kind !== 'prose'), ...blocks.slice(cut)];

  const items = [];
  let open = false;
  const shut = () => { if (open) items.push('</ul>'); open = false; };
  const list = () => { if (!open) items.push('<ul class="contents">'); open = true; };

  for (const block of contents) {
    if (block.kind === 'heading') {
      shut();
      const level = Math.min(Math.max(block.level, 2), 6);
      items.push(`<h${level}>${escapeHtml(block.text)}</h${level}>`);
      continue;
    }
    if (block.kind === 'prose') {
      shut();
      items.push(`<p class="aside">${escapeHtml(block.text)}</p>`);
      continue;
    }
    list();
    // A book reads as a book: it says how much is inside, because "Bratko" and
    // "Bratko, 12 chapters" are different promises to somebody deciding where to
    // start.
    const count = block.kind === 'book' ? countIn(block) : 0;
    items.push(`<li${block.kind === 'book' ? ' class="book"' : ''}>`
      + `<a href="${block.href}">${escapeHtml(block.title)}</a>`
      + (count ? `<span class="count">${count} chapter${count === 1 ? '' : 's'}</span>` : '')
      + '</li>');
  }
  shut();
  const body = items.length ? items.join('\n')
    : '<ul class="contents"><li class="empty">No notebooks here yet.</li></ul>';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="icon" href="data:image/svg+xml,${FAVICON}">
<link rel="stylesheet" href="${prefix}notebook.css">
<style>
  .contents { list-style: none; padding: 0; margin: 1.5rem 0 0; }
  .contents li { border-top: 1px solid var(--rule); display: flex; align-items: baseline; gap: 1rem; }
  .contents li:last-child { border-bottom: 1px solid var(--rule); }
  .contents a { display: block; padding: 1rem .2rem; text-decoration: none; color: inherit; flex: 1; }
  .contents a:hover { color: var(--accent); }
  .contents .count { opacity: .55; font-size: .85em; padding-right: .2rem; }
  .contents .empty { padding: 1rem .2rem; opacity: .6; font-style: italic; }
  main > h2, main > h3 { margin: 2.5rem 0 0; }
  main > h2:first-of-type, main > h3:first-of-type { margin-top: 2rem; }
  p.aside { opacity: .75; }
</style>
</head>
<body>
<main>
<h1>${escapeHtml(title)}</h1>
${preface.map((b) => `<p>${escapeHtml(b.text)}</p>`).join('\n')}
${body}
</main>
</body>
</html>
`;
}

/**
 * How a page at this URL reaches the shared files at the site root.
 *
 * The runtime, the engine and the stylesheet live once at the top (869erqwkp),
 * so every page needs to climb back to them — one level from /lists/, two from
 * /bratko/lists/. Books nest without limit, so this counts rather than choosing
 * between './' and '../'.
 */
export function prefixFor(url = '') {
  const depth = url.split('/').filter(Boolean).length;
  return depth === 0 ? './' : '../'.repeat(depth);
}

/** Chapters at any depth, for the count a book shows beside its name. */
function countIn(book) {
  return (book.blocks ?? []).reduce((n, b) => n
    + (b.kind === 'chapter' ? 1 : b.kind === 'book' ? countIn(b) : 0), 0);
}

/**
 * The blocks a site with no spine has: its directories, alphabetically.
 *
 * EVERY 0.8 SITE STILL BUILDS. Nothing about the spine is retrospective, so a
 * project that has never had one keeps the behaviour it has always had, and the
 * same renderer draws both.
 */
export function blocksFromDirectory(pages) {
  return pages.map((p) => ({
    kind: 'chapter', title: p.title, name: p.name, href: `${encodeURIComponent(p.name)}/`,
  }));
}

/**
 * Where the build went, as the reader would type it.
 *
 * The relative form wins whenever it is shorter, INCLUDING when it climbs — the
 * whole point of the default destination is that the site is above the notebook,
 * so `../prolog-notebook-site/lists/` is the normal case and the absolute path is
 * the unreadable one.
 */
export function shownAs(target) {
  const here = relative(process.cwd(), target);
  return here && here.length < target.length ? here : target;
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function unescapeHtml(text) {
  return String(text).replace(/&(amp|lt|gt|quot);/g, (_, name) => ({ amp: '&', lt: '<', gt: '>', quot: '"' }[name]));
}
