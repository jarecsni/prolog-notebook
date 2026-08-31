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
import { FAVICON } from './build.js';

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
  let dir = resolve(dirname(from));
  const root = resolve(dir).split(/[\\/]/)[0] || '/';
  for (;;) {
    if (existsSync(join(dir, SITE))) return join(dir, SITE);
    if (existsSync(join(dir, '.git'))) return join(dir, SITE);
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
  return name.startsWith('lib/') || name.startsWith('swipl/') || name === 'notebook.css';
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
 * The site's front page, rewritten on every build (869erptbr).
 *
 * ORDER IS THE SITE'S BUSINESS, NOT THE NOTEBOOK'S. A chapter never states its
 * own position — that is the rule the whole format is built on (binding.md) — so
 * an index is an opinion held by the directory, and alphabetical is the honest
 * placeholder until there is somewhere for a real order to live.
 *
 * It borrows the chapter stylesheet rather than carrying its own, so it inherits
 * the palette, the dark mode and the typography, and cannot drift from the pages
 * it lists.
 */
export function indexHtml(pages, { title = 'Prolog notebooks' } = {}) {
  const items = pages.length
    ? pages.map((p) => `<li><a href="${encodeURIComponent(p.name)}/">${escapeHtml(p.title)}</a></li>`)
      .join('\n')
    : '<li class="empty">No notebooks here yet.</li>';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="icon" href="data:image/svg+xml,${FAVICON}">
<link rel="stylesheet" href="notebook.css">
<style>
  .contents { list-style: none; padding: 0; margin: 2.5rem 0 0; }
  .contents li { border-top: 1px solid var(--rule); }
  .contents li:last-child { border-bottom: 1px solid var(--rule); }
  .contents a { display: block; padding: 1rem .2rem; text-decoration: none; color: inherit; }
  .contents a:hover { color: var(--accent); }
  .contents .empty { padding: 1rem .2rem; opacity: .6; font-style: italic; }
</style>
</head>
<body>
<main>
<h1>${escapeHtml(title)}</h1>
<ul class="contents">
${items}
</ul>
</main>
</body>
</html>
`;
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
