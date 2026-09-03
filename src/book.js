// A whole book's files, assembled once and used twice (869eu5tn7).
//
// `build` writes these to a directory and `view` serves them from memory, which
// is the same guarantee serve.js has always made about a single page: what an
// author looks at and what they would publish cannot drift apart, because there
// is only one thing that decides what a site contains.
//
// KEYED BY SITE-RELATIVE PATH — `bratko/cut/index.html`, `lib/notebook.js` — so
// the map IS the site. buildFiles names files relative to the page that owns
// them; this is where a page learns where it sits.
import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { buildFiles, sharedFiles } from './build.js';
import { parse } from './format.js';
import { indexHtml, isEngine, isShared, linkFrom, prefixFor } from './site.js';
import { booksOf, chaptersOf, contentsOf, navigationOf } from './spine.js';

/**
 * One chapter's navigation, with every URL made relative to that chapter.
 *
 * RELATIVE, NEVER ABSOLUTE, because a project site is served from a subdirectory
 * — GitHub Pages puts it at /<repo>/ — so an absolute link leaves the site.
 */
export function wayOut(chapter, around) {
  if (!chapter.trail) return null;
  const to = (entry) => (entry
    ? { title: entry.title, href: linkFrom(chapter.url, entry.url) }
    : null);
  return {
    trail: chapter.trail.map((a) => ({ title: a.title, href: linkFrom(chapter.url, a.url) })),
    prev: to(around?.prev),
    next: to(around?.next),
    // Named "Contents" rather than by the book: the crumb directly above already
    // says which book, and repeating it reads as a different place.
    up: around?.up ? { title: 'Contents', href: linkFrom(chapter.url, around.up.url) } : null,
  };
}

/**
 * Every file a book's site is made of.
 *
 * @param {object} book a resolved spine
 * @param {{only?: Set<string>, read?: (file: string) => string}} [options]
 *   `only` limits which chapters are built — naming files on the command line —
 *   while the contents pages are always regenerated, because they describe the
 *   whole book however much of it was asked for. `onChapter` is how `build`
 *   learns what it just built, without parsing everything a second time.
 */
export function siteFiles(book, { only = null, read = defaultRead, onChapter = null } = {}) {
  const files = new Map();
  for (const [name, entry] of sharedFiles()) files.set(name, entry);

  const nav = navigationOf(book);
  for (const chapter of chaptersOf(book)) {
    if (only && !only.has(chapter.source)) continue;
    const { source, notebook } = read(chapter.source);
    onChapter?.(chapter, notebook);
    const page = buildFiles(notebook, source, {
      filename: basename(chapter.source),
      prefix: prefixFor(chapter.url),
      nav: wayOut(chapter, nav.get(chapter.url)),
    });
    for (const [name, entry] of page) {
      if (isShared(name)) continue;
      files.set(`${chapter.url}${name}`, entry);
    }
  }

  for (const one of booksOf(book)) {
    files.set(`${one.url}index.html`, {
      text: indexHtml({
        title: one.title ?? undefined,
        blocks: contentsOf(one),
        prefix: prefixFor(one.url),
        trail: one.trail.map((a) => ({ title: a.title, href: linkFrom(one.url, a.url) })),
      }),
    });
  }
  return files;
}

/**
 * Whether a file already on disk is the one we would write.
 *
 * Byte for byte, because nothing else is honest: a size is a coincidence away
 * from being wrong and an mtime says when somebody touched a file rather than
 * what is in it.
 */
export function unchanged(target, entry) {
  if (!existsSync(target)) return false;
  const have = readFileSync(target);
  return entry.text !== undefined
    ? have.equals(Buffer.from(entry.text))
    : have.equals(readFileSync(entry.copy));
}

/**
 * Whether the runtime in this site is the one we would put there (869etggpr).
 *
 * THE VERSION IS THE KEY, AND WHILE THE RUNTIME IS BEING DEVELOPED THE VERSION
 * DOES NOT MOVE WHILE THE BYTES DO. Edit src/notebook.js, rebuild, reload, and
 * the page ran yesterday's code — because the site's lib/version.js said 0.9.0
 * and so did ours, so the shared files were "already right". Harmless for a
 * reader, and silent in the worst way for anybody working on the runtime: the
 * page loads, behaves like yesterday, and the natural conclusion is that the fix
 * does not work.
 *
 * ASKED OF THE BYTES RATHER THAN OF GIT. Comparing a working copy's dirtiness
 * would make the answer depend on the state of somebody's checkout, which is a
 * thing tests then have to pretend about. These files come to about 190 KB, so
 * reading them costs less than a millisecond — and the engine, which would cost
 * something, keeps its version as its key.
 */
export function runtimeStale(site) {
  if (!existsSync(site)) return false;
  for (const [name, entry] of sharedFiles()) {
    if (isEngine(name)) continue;
    if (!unchanged(join(site, name), entry)) return true;
  }
  return false;
}

function defaultRead(file) {
  const source = readFileSync(file, 'utf8');
  return { source, notebook: parse(source) };
}

/**
 * The book as it is on disk right now, asked again on every request.
 *
 * THE REQUEST IS WHAT READS THE FILES (869erpuhk). `view` used to serve the
 * chapter as it had been at start-up, so a reload — the universal gesture for
 * "show me what I just did" — confirmed the old version. The same has to hold
 * for a book, and for the spine: reorder the contents, reload, and it is
 * reordered.
 *
 * PER-CHAPTER MEMOISATION, or the guarantee would cost too much to keep. A page
 * fetches a dozen files and rebuilding twenty chapters for each of them would be
 * a second of work per request; re-reading twenty small files is a millisecond,
 * and only the chapters whose bytes moved are built again.
 *
 * @param {() => object} resolve produces the book — called once per request
 * @param {{onError?: (e: Error) => void}} [options]
 */
export function liveSite(resolve, { onError = () => {} } = {}) {
  const built = new Map();
  let last = null;
  let failing = null;
  const read = (file) => {
    const source = readFileSync(file, 'utf8');
    const seen = built.get(file);
    if (seen && seen.source === source) return seen;
    const fresh = { source, notebook: parse(source) };
    built.set(file, fresh);
    return fresh;
  };
  return () => {
    try {
      const files = siteFiles(resolve(), { read });
      last = files;
      failing = null;
      return files;
    } catch (e) {
      // Nothing good to fall back to on the first attempt: the command is what
      // should report it and stop.
      if (!last) throw e;
      // Once per broken version, not once per request — a terminal repeating one
      // syntax error a dozen times communicates it worse than saying it once.
      if (failing !== e.message) onError(e);
      failing = e.message;
      return last;
    }
  };
}
