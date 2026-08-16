// A notebook file to a running page: fetch, parse, render, mount.
//
// Separate from notebook.js on purpose. This module pulls in the parser and the
// markdown renderer; notebook.js pulls in neither. A page built by v0.3 already
// has its HTML and needs only the wiring, so keeping the two apart is what stops
// a prerendered chapter from downloading 137 KB of markdown-it to render nothing.
import { parse } from './format.js';
import { renderNotebook } from './render.js';
import { mount } from './notebook.js';

/**
 * Render notebook source into an element and wire up its cells.
 *
 * @param {string} text notebook markdown
 * @param {Element} root element to fill
 * @param {object} [options] passed through to the session
 * @returns {{frontMatter: Map<string, string>, cells: object[]}} the parsed notebook
 */
export function renderInto(text, root, options = {}) {
  const notebook = parse(text);
  root.innerHTML = renderNotebook(notebook);
  // The title is the first H1 in the body, not a front-matter key (format §2):
  // one source of truth, and the GitHub view gets a real heading rather than a
  // heading hidden in metadata.
  const title = root.querySelector('h1')?.textContent;
  if (title) document.title = title;
  mount(root, options);
  return notebook;
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
  return renderInto(await response.text(), root, options);
}
