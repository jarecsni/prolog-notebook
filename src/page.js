// A notebook file to a running page: fetch, parse, render, mount.
//
// Separate from notebook.js on purpose. This module pulls in the parser and the
// markdown renderer; notebook.js pulls in neither. A page built by v0.3 already
// has its HTML and needs only the wiring, so keeping the two apart is what stops
// a prerendered chapter from downloading 137 KB of markdown-it to render nothing.
import { parse } from './format.js';
import { renderNotebook } from './render.js';
import { mount, offerDownload } from './notebook.js';
import { exportSource, filenameFor } from './export.js';

/**
 * Render notebook source into an element and wire up its cells.
 *
 * @param {string} text notebook markdown
 * @param {Element} root element to fill
 * @param {object} [options] passed through to the session
 * @returns {{frontMatter: Map<string, string>, cells: object[]}} the parsed notebook
 */
export function renderInto(text, root, options = {}) {
  const { filename = 'notebook.prolog.md', ...rest } = options;
  const notebook = parse(text);
  root.innerHTML = renderNotebook(notebook);
  // The title is the first H1 in the body, not a front-matter key (format §2):
  // one source of truth, and the GitHub view gets a real heading rather than a
  // heading hidden in metadata.
  const title = root.querySelector('h1')?.textContent;
  if (title) document.title = title;
  const cells = mount(root, rest);

  // EXPORT LIVES HERE, not in notebook.js, for the same reason the parser does:
  // only this module has the prose. The DOM carries every program and every goal,
  // but a markdown cell has been rendered to HTML and cannot be read back out of
  // it — a chapter exported from the DOM alone would lose its writing.
  offerDownload(root, () => ({
    filename,
    text: exportSource(notebook, edits(cells)),
  // THE BYTES THE PAGE WAS GIVEN, not the model written out again. A
  // re-serialisation would be canonical form, which is not necessarily the
  // author's file: a hand-written chapter with no ids, or attributes in another
  // order, would come back subtly reformatted. "The chapter as published" has to
  // mean the chapter as published.
  }), () => ({ filename, text }));
  return notebook;
}

/** What the cells now say, keyed by id, for src/export.js to fold into the model. */
function edits(cells) {
  const map = new Map();
  for (const program of cells.programs) {
    map.set(program.name, { source: program.text() });
  }
  for (const query of cells.queries) {
    const output = query.output();
    map.set(query.id, output === undefined
      ? { goal: query.goal() }
      : { goal: query.goal(), output });
  }
  return map;
}

/**
 * Fetch a `.prolog.md` and render it.
 *
 * The response is checked rather than trusted: a static host answers a missing
 * file with an HTML 404 page, which parses perfectly well as markdown and would
 * otherwise render as a chapter about nothing.
 *
 * @param {string|URL} url
 * @param {{root?: Element}} [options]
 * @returns {Promise<{frontMatter: Map<string, string>, cells: object[]}>}
 */
export async function load(url, { root = document.querySelector('main'), ...options } = {}) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status} ${response.statusText}`);
  // The reader's copy is named after the file they came from, not after the
  // title: a title can contain anything, and the filename is how they recognise
  // what they downloaded.
  return renderInto(await response.text(), root, { filename: filenameFor(url), ...options });
}
