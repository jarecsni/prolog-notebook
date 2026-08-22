// Cell model in, HTML out.
//
// Strings, not DOM nodes. Three things fall out of that choice: this is testable
// under Node with no jsdom, the v0.3 static build reuses it verbatim rather than
// growing a second emitter, and the browser layer is reduced to assigning
// innerHTML once.
//
// The class vocabulary here is not decoration. src/notebook.css already styles
// exactly these names, and the look of the spike is a deliverable rather than a
// placeholder — a generator that invents its own structure would leave the page
// technically working and visually gone.

import MarkdownIt from 'markdown-it';
import { hashFor } from './format.js';

// markdown-it rather than marked, in this order of reasons:
//
// 1. SIZE IS NOT A CRITERION HERE, which is the only contest marked was winning
//    (~13KB gzip against ~46KB). Once `build` prerenders a chapter (v0.3) the
//    markdown library runs at build time and never reaches a reader at all; only
//    the development loader pulls it into a browser.
// 2. GIVEN THAT, MATCHING GITHUB IS WHAT MATTERS. The same file has to read
//    correctly on the repo page and in the built site — that is a promise the
//    format makes, not a nicety. GitHub runs cmark-gfm; markdown-it is tested
//    against the CommonMark suite, marked has known divergences.
// 3. Safe-by-default HTML handling is the tiebreaker, below.
//
// html:false is markdown-it's default, and we keep it: raw HTML in prose is
// escaped rather than passed through, so a notebook someone else wrote cannot
// carry script into the page. That removes the need for a sanitiser dependency
// rather than adding one — DOMPurify would drag a DOM shim into Node with it.
// marked can be made to do the same by overriding its html renderer, so this is
// a difference of default rather than of capability; a security property nobody
// has to remember is worth more than one that silently lapses on an upgrade.
//
// THE COST, so it is not discovered by surprise: authors cannot write raw HTML at
// all. <kbd>, <sup>, <br> and a sized <img> come out as text. Markdown images,
// GFM tables and strikethrough are unaffected, and the container grammar covers
// the visual vocabulary that would otherwise reach for HTML. When an author does
// need more, the answer is a markdown-it plugin or a new container variant —
// extending the vocabulary — never opening the raw-HTML door.
//
// KNOWN DIVERGENCES from GitHub, both GFM extensions needing plugins we have not
// added: task lists render as literal "[x]", and footnotes do not render.
//
// The one construct that genuinely needs raw HTML — the <details> reveal inside a
// prediction — is part of the container's grammar (format §10), so we emit it
// ourselves from the model instead of trusting the author's angle brackets.
//
// linkify matches GitHub, which autolinks bare URLs. typographer does not: GitHub
// leaves quotes and dashes alone, and prose that renders differently on the repo
// page than in the built site defeats the point of the format.
const md = new MarkdownIt({ html: false, linkify: true, typographer: false });

/**
 * Render markdown prose to HTML.
 * @param {string} source
 * @returns {string}
 */
export function renderProse(source) {
  return md.render(source).trim();
}

/** Render markdown that should not be wrapped in a paragraph. */
function renderInline(source) {
  return md.renderInline(source).trim();
}

export function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * The four containers the stylesheet knows, each with its own shape.
 *
 * They are not interchangeable boxes: a margin note is a single rotated line, an
 * aside leads with a bold sentence, a prediction is a heading plus a place to
 * commit an answer plus a reveal, and the bullets block closes a chapter. The
 * markup differs accordingly, and matching it is what keeps notebook.css working.
 *
 * @param {{variant: string, title: string, body: string}} cell
 * @returns {string}
 */
export function renderContainer(cell) {
  switch (cell.variant) {
    case 'margin':
      // The whole note lives in the head line — `> [!margin] text with no body` —
      // so for this one variant the title IS the content. Anything in the body is
      // appended rather than dropped.
      return `<p class="note">${[renderInline(cell.title), cell.body && renderInline(cell.body)]
        .filter(Boolean)
        .join(' ')}</p>`;

    case 'aside':
      // The first **bold** line is the lead-in; .aside strong does the rest.
      return `<div class="aside">\n${renderProse(joinHeadAndBody(cell))}\n</div>`;

    case 'predict':
      return renderPredict(cell);

    case 'bullets':
      return `<div class="bullets">\n${cell.title ? `<h2>${renderInline(cell.title)}</h2>\n` : ''}${renderProse(cell.body)}\n</div>`;

    default:
      throw new Error(`no renderer for container variant "${cell.variant}"`);
  }
}

function joinHeadAndBody(cell) {
  return [cell.title, cell.body].filter(Boolean).join('\n');
}

/**
 * A prediction is the teaching device, so its parts are structural.
 *
 * The textarea is added by the renderer rather than written by the author
 * (format §10) — the author's job is to ask the question, not to remember the
 * markup for a place to answer it. The reveal is a <details> so that it still
 * works, unclicked, on the GitHub page.
 */
function renderPredict(cell) {
  const { before, summary, reveal } = splitReveal(cell.body);
  const parts = [];
  if (cell.title) parts.push(`<h3>${renderInline(cell.title)}</h3>`);
  if (before) parts.push(renderProse(before));
  // A blank bordered box reads as decoration. The placeholder is generic because
  // the format has no spelling for a per-prediction one, and inventing an
  // attribute for it would be a format change to save one line of prose — the
  // author's own question is directly above it and says what to write.
  parts.push('<textarea placeholder="your prediction…" spellcheck="false"></textarea>');
  if (reveal !== null) {
    parts.push(`<details>\n<summary>${escapeHtml(summary)}</summary>\n${renderProse(reveal)}\n</details>`);
  }
  return `<div class="predict">\n${parts.join('\n')}\n</div>`;
}

/**
 * Pull the `<details>` reveal out of a prediction body.
 *
 * We look for it literally because that is what the author writes and what GitHub
 * renders natively (format §10). Recognising it here — rather than letting raw
 * HTML through the markdown renderer — is what lets html:false stay on.
 */
function splitReveal(body) {
  const open = body.indexOf('<details>');
  const close = body.lastIndexOf('</details>');
  if (open === -1 || close === -1 || close < open) {
    return { before: body, summary: '', reveal: null };
  }
  const inner = body.slice(open + '<details>'.length, close);
  const summaryMatch = /<summary>([\s\S]*?)<\/summary>/.exec(inner);
  return {
    before: body.slice(0, open).trim(),
    summary: summaryMatch ? summaryMatch[1].trim() : 'Reveal',
    reveal: (summaryMatch ? inner.slice(summaryMatch.index + summaryMatch[0].length) : inner).trim(),
  };
}

/**
 * A program cell: the Prolog, and a button that loads it.
 *
 * `data-cell` carries the notebook's own id through to the DOM, and it is not
 * decoration either — src/notebook.js consults each cell into the virtual file
 * named by it (format §8), so SWI's own messages say `/p-family.pl` rather than
 * `/cell-3.pl`. A warning that a cell has destroyed another cell's clauses is
 * only useful if it names a cell the reader can find.
 *
 * @param {{id: string, source: string}} cell
 * @returns {string}
 */
export function renderProgram(cell) {
  return `<div class="cell program" data-cell="${escapeHtml(cell.id)}">
  <div class="bar">program<span class="spacer"></span><span class="status"></span>
    <button data-act="reset" disabled>reset</button>
    <button class="primary" data-act="consult">Consult</button></div>
  <textarea spellcheck="false">${escapeHtml(cell.source)}</textarea>
</div>`;
}

/**
 * A query cell: the goal, the buttons that step it, and the answers the chapter
 * was published with.
 *
 * `; next` is not a convenience beside `all` — a Prolog query yields a stream of
 * proofs, and watching them arrive one at a time is usually the lesson. Both
 * survive into the generated markup for that reason.
 *
 * @param {{id: string, goal: string, output: object|null}} cell
 * @param {{stale?: boolean}} [options]
 * @returns {string}
 */
export function renderQuery(cell, options = {}) {
  return `<div class="cell query" data-cell="${escapeHtml(cell.id)}">
  <div class="bar">query<span class="spacer"></span>
    <button class="primary" data-act="run">Run</button>
    <button data-act="next" disabled>; next</button>
    <button data-act="all" disabled>all</button>
    <button data-act="stop" disabled>stop</button></div>
  <div class="prompt"><span>?-</span><input value="${escapeHtml(cell.goal)}" spellcheck="false"></div>
  <div class="out">${renderSavedOutput(cell, options)}</div>
</div>`;
}

/**
 * The answers stored in the file, rendered with no engine anywhere.
 *
 * This is the property the whole project is for. A chapter is readable the
 * instant it loads and stays readable if the 5.9 MB of WebAssembly never
 * arrives at all — on a phone with bad signal, behind a corporate proxy, in ten
 * years. It degrades to a book rather than to a blank page.
 *
 * It is affordable because the format stores the solution SEQUENCE rather than a
 * blob (format §6), so this is a rendering problem rather than an execution one.
 */
function renderSavedOutput(cell, { stale = false } = {}) {
  if (!cell.output) return '';
  const lines = [
    // An output is never shown without saying where it came from
    // (docs/modes.md §3). These are the author's answers, not the reader's, and
    // a reader who cannot tell them apart concludes something false about Prolog.
    { cls: 'from', text: stale ? 'the chapter\u2019s saved answers, from an older version of the program above' : 'the chapter\u2019s saved answers' },
    { cls: 'echo', text: `?- ${cell.goal}.` },
    ...replaySolutions(cell.output),
  ];
  if (stale) {
    lines.push({ cls: 'warn', text: 'the program above has changed since these were produced \u2014 press Run to see what it does now' });
  }
  return `\n${lines.map((l) => `    <div class="line ${l.cls}">${escapeHtml(l.text)}</div>`).join('\n')}\n  `;
}

/**
 * A saved solution sequence to the lines a reader sees.
 *
 * The stored spelling is SWI's own toplevel — solutions terminated by ` ;`, and a
 * final line ending in `.` which may be `false.`, `true.`, or the last solution's
 * bindings when the query ran deterministically (format §6). The display spelling
 * is the one the live engine produces, numbered, because a reader pressing Run
 * must not watch the layout change underneath them.
 *
 * @param {{solutions: string[], terminator: string}} output
 * @returns {{cls: string, text: string}[]}
 */
export function replaySolutions(output) {
  const lines = [];
  let count = 0;
  const solution = (text) => lines.push({ cls: 'sol', text: `${++count}.  ${text}` });

  for (const text of output.solutions) solution(text);

  const end = output.terminator ?? '';
  if (end.startsWith('ERROR:')) {
    lines.push({ cls: 'err', text: end.replace(/^ERROR:\s*/, '') });
    return lines;
  }
  // `false.` after solutions means the search was exhausted, not that the query
  // failed — the distinction matters, and "false." under six answers reads as a
  // contradiction of them.
  const bindings = end.replace(/\.$/, '');
  if (bindings !== '' && bindings !== 'false') solution(bindings);
  lines.push({
    cls: 'done',
    text: count === 0 ? 'false.' : 'no more solutions.',
  });
  return lines;
}

/**
 * Render one cell.
 *
 * @param {object} cell
 * @param {{stale?: boolean}} [options] for a query cell carrying saved answers
 * @returns {string}
 */
export function renderCell(cell, options = {}) {
  switch (cell.kind) {
    case 'markdown':
      return renderProse(cell.source);
    case 'container':
      return renderContainer(cell);
    case 'program':
      return renderProgram(cell);
    case 'query':
      return renderQuery(cell, options);
    case 'unknown':
      // A cell kind from a later version. It renders as the ordinary code block
      // it looks like, so a v0.2 page degrades instead of dropping content.
      return renderProse(cell.source);
    default:
      throw new Error(`no renderer for cell kind "${cell.kind}"`);
  }
}

/**
 * A parsed notebook to the HTML that goes inside `<main>`.
 *
 * Throwing on an unrenderable cell rather than skipping it is the whole reason
 * this loop exists as a function: a chapter that silently drops a cell reads as
 * a complete chapter, and the missing step is the one the reader needed.
 *
 * @param {{frontMatter: Map<string, string>, cells: object[]}} notebook
 * @returns {string}
 */
export function renderNotebook(notebook) {
  const parts = [];
  const kicker = renderKicker(notebook.frontMatter);
  if (kicker) parts.push(kicker);
  for (const cell of notebook.cells) {
    // Staleness is decided here rather than in renderQuery, because it is a fact
    // about the cell's PLACE in the notebook — the program cells above it — and a
    // query cell on its own cannot know it. Computed before first paint: a 64-bit
    // FNV-1a over text we already have, which is why the hash is not a SHA.
    const stale = cell.kind === 'query' && cell.output?.inputHash
      ? hashFor(notebook, cell) !== cell.output.inputHash
      : false;
    parts.push(renderCell(cell, { stale }));
  }
  return `${parts.join('\n\n')}\n`;
}

/**
 * The kicker is front matter, not prose: markdown has no spelling for a line
 * above the title. When a notebook is bound, the binder supplies this instead —
 * see docs/binding.md.
 *
 * @param {Map<string, string>} frontMatter
 * @returns {string}
 */
export function renderKicker(frontMatter) {
  const kicker = frontMatter.get('kicker');
  return kicker ? `<div class="kicker">${renderInline(kicker)}</div>` : '';
}
