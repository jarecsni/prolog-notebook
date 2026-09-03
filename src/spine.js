// The spine: what a book contains, and in what order (869eu5tg1).
//
// THE SITE USED TO BE ITS OWN MANIFEST. site.js said so plainly — "the only
// thing that knows the whole site is the site" — and that is not a thing an
// artefact may be. Clone the repository, build the one chapter you are working
// on, publish, and the live site IS that one chapter: nothing anywhere recorded
// what it should have held. Order was alphabetical, and a chapter once built
// could never be removed.
//
// So the set, the order and the titles move into a file the author writes and
// git tracks, and the site becomes what it always claimed to be: regenerable,
// disposable, and safe to gitignore.
//
// IT IS A SPINE IN THE SENSE OF docs/binding.md §3, not a new format invented
// beside it — same front matter, same entry rule, same preface rule — so the
// file somebody writes today is the binder they get later, when covers,
// numbering and the cross-reference arrive.
//
// NOTHING HERE WRITES ANYTHING, as in site.js: this reads, decides names, and
// produces text. The command does the I/O.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve as resolvePath } from 'node:path';
import { NotebookError, frontMatterOf } from './format.js';
import { findSite, pageName } from './site.js';

/** One name per book, so a book is identified by its directory. */
export const SPINE = 'prolog-notebook-index.md';

/** What identifies the file, per §3 — the name is convention, this is the fact. */
export const SPINE_FORMAT = 'prolog-notebook-book/1';

// ------------------------------------------------------------------ parsing

/**
 * A spine's own contents, in document order and without touching the disk.
 *
 * Blocks come back in the order they were written, INCLUDING the prose and the
 * headings, because the contents page is a rendering of this file rather than a
 * list extracted from it. A `link` block is a candidate: whether it is a chapter,
 * a sub-book or just a link in a sentence cannot be known without reading what it
 * points at, which is resolve()'s job.
 *
 * @param {string} text
 * @returns {{title: string|null, blocks: object[]}}
 */
export function parseSpine(text) {
  const { frontMatter, lines, start } = frontMatterOf(text);
  const format = frontMatter.get('format');
  if (format !== SPINE_FORMAT) {
    throw new NotebookError(
      format === undefined
        ? `not a spine: front matter must carry format: ${SPINE_FORMAT}`
        : `unrecognised book format "${format}"`,
      1,
    );
  }

  let title = null;
  const blocks = [];
  // PROSE IS A PARAGRAPH, NOT A LINE. A wrapped sentence is one thought however
  // many times the author's editor broke it, and rendering each line as its own
  // paragraph turned a three-line intro into three of them.
  let prose = [];
  const flush = () => {
    if (prose.length) blocks.push({ kind: 'prose', text: prose.join('\n') });
    prose = [];
  };
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') { flush(); continue; }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      const [, hashes, label] = heading;
      // The first H1 is the title, as in a notebook — there is no `title` key.
      // A second one is just a heading; the author gets what they wrote.
      if (hashes.length === 1 && title === null) title = label.trim();
      else blocks.push({ kind: 'heading', level: hashes.length, text: label.trim() });
      continue;
    }

    // §3: every markdown link whose target ends in .md is a candidate entry, in
    // document order. Prose may link to anything else freely, which is why the
    // extension is the filter and resolution decides the rest.
    const links = [...line.matchAll(/\[([^\]]*)\]\(([^)\s]+)\)/g)]
      .filter(([, , target]) => /\.md$/i.test(target) && !/^[a-z][a-z0-9+.-]*:/i.test(target));
    if (links.length > 0) {
      flush();
      for (const [, label, target] of links) {
        blocks.push({ kind: 'link', title: label.trim(), target, line: i + 1 });
      }
      continue;
    }

    prose.push(line);
  }
  flush();
  return { title, blocks };
}

/** Cheap enough to ask of any .md before deciding it is prose. */
export function isSpine(text) {
  try {
    return frontMatterOf(text).frontMatter.get('format') === SPINE_FORMAT;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- resolving

/**
 * A spine and everything it binds, as a tree.
 *
 * BOOKS HOLD BOOKS, with no depth limit: a link to a .prolog.md is a chapter, a
 * link to a .md carrying our format key is a sub-book, and anything else is a
 * link in a sentence. That is one clause on top of §3's entry rule rather than a
 * second mechanism, and it is what lets one repository hold Bratko and Clocksin
 * & Mellish without holding two sites — which it cannot do, because GitHub Pages
 * serves exactly one site per repository (869ery8ac).
 *
 * URLS COME FROM THE BINDER, NEVER FROM THE DISK. A chapter's segment is its
 * filename, a book's segment is its directory name, and its path is the chain of
 * books that contain it. So moving notes/lists.prolog.md to chapters/ does not
 * move /lists/, and binding it into a sub-book does — visibly, because that is
 * the author saying where it belongs.
 *
 * EVERY NODE CARRIES ITS ANCESTORS. A page has to be able to say where it sits —
 * a chapter with no way back to its contents is a dead end, which is what a
 * published chapter was (869eun9qa) — and the build is the only thing that ever
 * holds the whole tree. Recording the trail here means the navigation is a pure
 * function of the spine rather than something a page works out at runtime.
 *
 * @param {string} file path to a spine
 * @param {{chain?: string[], at?: string, trail?: object[], named?: string}} [where] internal
 * @returns {object} the book: {file, title, url, trail, blocks}
 */
export function resolveSpine(file, { chain = [], at = '', trail = [], named = null } = {}) {
  const path = resolvePath(file);

  // A CYCLE IS AN ERROR, NOT A STACK OVERFLOW. New with recursion, and the one
  // failure a reader could not diagnose from the message they would otherwise get.
  if (chain.includes(path)) {
    const loop = [...chain.slice(chain.indexOf(path)), path].map((p) => basename(dirname(p)) || p);
    throw new NotebookError(`${shownSpine(path)}: a book cannot contain itself — ${loop.join(' → ')}`);
  }

  const text = readFileSync(path, 'utf8');
  let parsed;
  try {
    parsed = parseSpine(text);
  } catch (e) {
    throw new NotebookError(`${shownSpine(path)}: ${e.message}`);
  }

  // A BOOK IS NAMED BY ITS BINDER, not by itself: the reader clicked those words
  // in the contents above, and the breadcrumb has to say the same ones. Only the
  // book at the root has no binder, so only it falls back to its own H1.
  const mine = [...trail, { title: named ?? parsed.title, url: at }];

  const here = dirname(path);
  const blocks = [];
  const targets = new Map();
  const segments = new Map();

  const claim = (map, key, what, line) => {
    const first = map.get(key);
    if (first !== undefined) {
      throw new NotebookError(`${shownSpine(path)}: ${what} — first bound on line ${first}`, line);
    }
    map.set(key, line);
  };

  for (const block of parsed.blocks) {
    if (block.kind !== 'link') {
      blocks.push(block);
      continue;
    }
    const target = resolvePath(here, block.target);
    const chapter = /\.prolog\.md$/i.test(block.target);

    if (!existsSync(target) || !statSync(target).isFile()) {
      // A chapter that is not there is always an error; a plain .md that is not
      // there is a broken link in somebody's prose, and not this file's business.
      if (!chapter) { blocks.push({ kind: 'prose', text: block.title }); continue; }
      throw new NotebookError(`${shownSpine(path)}: no such notebook — ${block.target}`, block.line);
    }

    if (chapter) {
      claim(targets, target, `${block.target} is bound twice in this book`, block.line);
      const name = pageName(target);
      claim(segments, name, `two chapters here would both be published at /${at}${name}/`, block.line);
      blocks.push({
        kind: 'chapter', title: block.title, source: target, name, url: `${at}${name}/`,
        trail: mine,
      });
      continue;
    }

    if (!isSpine(readFileSync(target, 'utf8'))) {
      blocks.push({ kind: 'prose', text: block.title });
      continue;
    }

    claim(targets, target, `${block.target} is bound twice in this book`, block.line);
    const name = basename(dirname(target));
    claim(segments, name, `two books here would both be published at /${at}${name}/`, block.line);
    const book = resolveSpine(target, {
      chain: [...chain, path],
      at: `${at}${name}/`,
      trail: mine,
      named: block.title || null,
    });
    blocks.push({ ...book, kind: 'book', name });
  }

  return {
    kind: 'book', file: path, title: named ?? parsed.title, url: at, trail, blocks,
  };
}

/** Every chapter the book binds, at any depth, in reading order. */
export function chaptersOf(book) {
  return book.blocks.flatMap((b) => (
    b.kind === 'chapter' ? [b] : b.kind === 'book' ? chaptersOf(b) : []
  ));
}

/**
 * A book's own blocks, with the links its contents page needs.
 *
 * Relative to THAT book, because its index sits inside it: the chapter the site
 * publishes at /bratko/lists/ is one click from /bratko/, and writing it as an
 * absolute path would break the moment the site is served from a subdirectory —
 * which is exactly how GitHub Pages serves a project site.
 */
export function contentsOf(book) {
  return book.blocks.map((b) => (
    b.kind === 'chapter' || b.kind === 'book'
      ? { ...b, href: b.url.slice(book.url.length) }
      : b
  ));
}

/** The book and every book inside it — one contents page each. */
export function booksOf(book) {
  return [book, ...book.blocks.filter((b) => b.kind === 'book').flatMap(booksOf)];
}

/**
 * Where a reader can go from each chapter: the one before, the one after, and up.
 *
 * PREV AND NEXT STOP AT THEIR OWN BOOK'S EDGE. Running off the end of Bratko into
 * Clocksin & Mellish would tell a reader they are in one long book when they are
 * standing at a shelf; at the edge, `up` is the honest answer instead.
 *
 * Keyed by URL rather than by source file, because a chapter bound into two books
 * is two pages with two different neighbours — which is the binder premise doing
 * something useful rather than something awkward.
 *
 * @returns {Map<string, {prev: object|null, next: object|null, up: object}>}
 */
export function navigationOf(root) {
  const nav = new Map();
  for (const book of booksOf(root)) {
    const own = book.blocks.filter((b) => b.kind === 'chapter');
    own.forEach((chapter, i) => nav.set(chapter.url, {
      prev: own[i - 1] ?? null,
      next: own[i + 1] ?? null,
      up: book,
    }));
  }
  return nav;
}

// ------------------------------------------------------------------ finding

/**
 * The spine governing a notebook, or null.
 *
 * THE SPINE BESIDE THE SITE, never the nearest one walking up. That distinction
 * is the whole rule: a site has exactly one spine, and every other spine in the
 * project is a SUB-BOOK, reached only by being linked from it.
 *
 * Walking up would find the wrong one. Standing at the project root and building
 * bratko/lists.prolog.md, the nearest spine is Bratko's own — so the chapter
 * would be published at /lists/ rather than /bratko/lists/, quietly duplicating
 * a page the full build puts somewhere else. A file's book is not a property of
 * where it sits on disk any more than its URL is (§3).
 */
export function findSpine(from) {
  const spine = join(dirname(findSite(from)), SPINE);
  return existsSync(spine) ? spine : null;
}

// ------------------------------------------------------------------ writing

/**
 * A first spine, for the build that creates a site.
 *
 * WRITTEN FOR THE AUTHOR RATHER THAN LEFT AS A CHORE. A manifest you have to
 * discover is how build systems earn their reputation; this one arrives already
 * correct, and is never written over again.
 */
export function seedSpine({ title, entries }) {
  const lines = [
    '---', `format: ${SPINE_FORMAT}`, '---', '',
    `# ${title}`, '',
    'The chapters of this site, in the order they should be read.',
    'Reorder them, rename them, or group them under headings — this file is the contents page.',
    '',
    ...entries.map(entryLine),
    '',
  ];
  return lines.join('\n');
}

/**
 * The same spine with one more chapter in it.
 *
 * APPENDED AFTER THE LAST ENTRY, never sorted into place and never near the
 * prose: the order in this file is the author's opinion, and a tool that
 * rearranges it is a tool they stop trusting with it.
 */
export function withEntry(text, entry) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const isEntry = (line) => /\[[^\]]*\]\([^)\s]+\.md\)/i.test(line);
  let last = -1;
  for (let i = 0; i < lines.length; i++) if (isEntry(lines[i])) last = i;
  const at = last === -1 ? trailing(lines) : last + 1;
  return [...lines.slice(0, at), entryLine(entry), ...lines.slice(at)].join('\n');
}

const entryLine = ({ title, target }) => `- [${title}](${target})`;

/** Past the last line with anything on it, so a file keeps its single trailing newline. */
function trailing(lines) {
  let end = lines.length;
  while (end > 0 && lines[end - 1].trim() === '') end--;
  return end;
}

/** The spine as the author would refer to it — its book, not its filename. */
function shownSpine(path) {
  const rel = relative(process.cwd(), path);
  return !rel || rel.startsWith('..') || isAbsolute(rel) ? path : rel;
}
