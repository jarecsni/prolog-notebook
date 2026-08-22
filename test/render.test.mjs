import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from '../src/format.js';
import {
  renderProse, renderContainer, renderCell, renderKicker,
  renderProgram, renderQuery, renderNotebook, replaySolutions,
} from '../src/render.js';

// The real chapter, not a fixture: if a chapter someone is meant to read stops
// rendering, that is what the suite should say. Nothing below asserts a cell count,
// so the chapter stays free to grow.
const NOTEBOOK = new URL('../notebooks/ch04-cut.prolog.md', import.meta.url);
const notebook = parse(readFileSync(NOTEBOOK, 'utf8'));
const container = (variant) => notebook.cells.find((c) => c.variant === variant);

test('prose renders as GitHub would render it', () => {
  assert.equal(renderProse('# Title'), '<h1>Title</h1>');
  assert.equal(renderProse('*emphasis* and `code`'), '<p><em>emphasis</em> and <code>code</code></p>');
  assert.equal(renderProse('- one\n- two'), '<ul>\n<li>one</li>\n<li>two</li>\n</ul>');
});

test('the GFM constructs GitHub renders, we render', () => {
  // The same file has to read correctly on the repo page and in the built site,
  // so divergence from GitHub is a format problem, not a cosmetic one.
  assert.match(renderProse('| a | b |\n|---|---|\n| 1 | 2 |'), /^<table>/);
  assert.equal(renderProse('~~gone~~'), '<p><s>gone</s></p>');
  assert.equal(renderProse('![a tree](tree.png)'), '<p><img src="tree.png" alt="a tree"></p>');
  assert.match(renderProse('see https://swi-prolog.org'), /<a href="https:\/\/swi-prolog\.org">/);
});

test('raw HTML is escaped even when it is harmless', () => {
  // The mechanism is blunter than "block scripts": no raw HTML at all. Recorded as
  // a test so the limitation is discovered here rather than mid-chapter.
  assert.equal(renderProse('press <kbd>Ctrl</kbd>'), '<p>press &lt;kbd&gt;Ctrl&lt;/kbd&gt;</p>');
  assert.equal(renderProse('x<sup>2</sup>'), '<p>x&lt;sup&gt;2&lt;/sup&gt;</p>');
});

test('raw HTML in prose is escaped, not passed through', () => {
  // A notebook is untrusted input the moment you can open someone else's. Escaping
  // by default is why this module needs no sanitiser.
  const html = renderProse('<script>alert(1)</script>');
  assert.equal(html.includes('<script>'), false);
  assert.match(html, /&lt;script&gt;/);
});

test('a margin note puts its head line in the note paragraph', () => {
  // The whole note is written after the marker with no body at all, so for this
  // variant the title is the content.
  assert.equal(
    renderContainer(container('margin')),
    '<p class="note">edward, then edward again. Nobody has two fathers.</p>'
  );
});

test('an aside leads with its bold sentence', () => {
  const html = renderContainer(container('aside'));
  assert.match(html, /^<div class="aside">/);
  assert.match(html, /<strong>So stop it after the first proof\.<\/strong>/);
  assert.match(html, /<code>once\(Goal\)<\/code>/);
});

test('a prediction gets a heading, a place to answer, and a reveal', () => {
  const html = renderContainer(container('predict'));
  assert.match(html, /<div class="predict">/);
  assert.match(html, /<h3>Sharpen your pencil<\/h3>/);
  // The author asks the question; the renderer supplies somewhere to answer it.
  assert.match(html, /<textarea placeholder="[^"]+" spellcheck="false"><\/textarea>/);
  assert.match(html, /<details>/);
  assert.match(html, /<summary>Reveal the answer \(run them first!\)<\/summary>/);
  assert.match(html, /<strong>A gives exactly one son\./);
});

test('the textarea comes before the reveal, so the answer is committed first', () => {
  const html = renderContainer(container('predict'));
  assert.ok(html.indexOf('<textarea') < html.indexOf('<details>'));
});

test('a prediction with no reveal still renders', () => {
  const html = renderContainer({ variant: 'predict', title: 'Guess', body: 'How many answers?' });
  assert.match(html, /<h3>Guess<\/h3>/);
  assert.equal(html.includes('<details>'), false);
});

test('the reveal is emitted from the model, so html:false can stay on', () => {
  // The <details> the author writes is recognised as the container's grammar
  // rather than trusted as raw HTML — that is what lets prose stay escaped.
  const html = renderContainer(container('predict'));
  assert.equal(html.includes('&lt;details&gt;'), false);
  assert.match(html, /<details>\n<summary>/);
});

test('bullets close a chapter with a heading and a list', () => {
  const html = renderContainer(container('bullets'));
  assert.match(html, /^<div class="bullets">\n<h2>Bullet points<\/h2>/);
  assert.match(html, /<li>Prolog enumerates <strong>proofs<\/strong>, not answers\./);
});

test('renderCell covers every kind the parser can produce', () => {
  for (const kind of ['markdown', 'container', 'program', 'query']) {
    const cell = notebook.cells.find((c) => c.kind === kind);
    assert.equal(typeof renderCell(cell), 'string', `${kind} should render`);
  }
});

test('an unrenderable cell throws rather than rendering as nothing', () => {
  // A chapter that silently drops a cell reads as a complete chapter, and the
  // missing step is the one the reader needed.
  assert.throws(() => renderCell({ kind: 'exercise' }), /no renderer for cell kind "exercise"/);
});

test('a future cell kind renders as the code block it looks like', () => {
  const cell = parse('```prolog trace id="t-1"\nfoo\n```\n').cells[0];
  assert.equal(cell.kind, 'unknown');
  assert.match(renderCell(cell), /<pre><code class="language-prolog">/);
});

test('the kicker comes from front matter, since markdown cannot spell it', () => {
  assert.equal(renderKicker(notebook.frontMatter), '<div class="kicker">Cut and control</div>');
  assert.equal(renderKicker(new Map()), '');
});

test('every cell in a real chapter renders to something', () => {
  const rendered = notebook.cells.map(renderCell);
  assert.equal(rendered.length, notebook.cells.length);
  assert.equal(rendered.every((html) => typeof html === 'string' && html.length > 0), true);
});

// --- program and query cells -----------------------------------------------
// The class vocabulary here is a deliverable, not decoration: notebook.css styles
// exactly these names, so a generator that invented its own structure would leave
// the page technically working and visually gone (869edyyvm).

const program = notebook.cells.find((c) => c.kind === 'program');
const query = notebook.cells.find((c) => c.kind === 'query');

test('a program cell carries the classes the stylesheet targets', () => {
  const html = renderProgram(program);
  assert.match(html, /^<div class="cell program" data-cell="p-family">/);
  assert.match(html, /<div class="bar">program<span class="spacer"><\/span><span class="status"><\/span>/);
  assert.match(html, /<button class="primary" data-act="consult">Consult<\/button>/);
  // The way back from an edit. Disabled until there is an edit to undo.
  assert.match(html, /<button data-act="reset" disabled>reset<\/button>/);
  assert.match(html, /<textarea spellcheck="false">male\(albert\)\./);
});

test("the cell's id reaches the DOM, because the consult is named by it", () => {
  // One cell, one virtual file: this attribute is what makes SWI say
  // "/p-family.pl" instead of "/cell-3.pl" when a cell destroys another's clauses.
  assert.match(renderProgram(program), /data-cell="p-family"/);
  assert.match(renderQuery(query), /data-cell="q-is-son"/);
});

test('the program source survives verbatim, angle brackets included', () => {
  // `X < Y` is ordinary Prolog and ordinary HTML poison. Escaping is not optional
  // here: a comparison operator would otherwise open a tag and eat the clause.
  const html = renderProgram({ id: 'p-cmp', source: 'smaller(X, Y) :- X < Y, X > 0.\n% a & b' });
  assert.match(html, /smaller\(X, Y\) :- X &lt; Y, X &gt; 0\.\n% a &amp; b/);
  assert.equal(html.includes('X < Y'), false);
});

test('a query cell carries its goal and its buttons', () => {
  const html = renderQuery(query);
  assert.match(html, /^<div class="cell query" data-cell="q-is-son">/);
  assert.match(html, /<div class="prompt"><span>\?-<\/span><input value="is_son\(X\)" spellcheck="false">/);
  // Stepping is the teaching device, so `; next` is not optional chrome.
  const acts = [...html.matchAll(/data-act="([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(acts, ['reset', 'run', 'next', 'all', 'stop']);
  assert.match(html, /<button data-act="next" disabled>/);
});

test('both runnable cells carry the same tick and the same way back', () => {
  // One vocabulary across the two cell kinds, because a reader learns it once.
  // A cell that can be changed has somewhere to say so (.status) and something to
  // undo it with (reset) — disabled in the markup, since a page whose script
  // never runs must not offer a way back it cannot honour.
  for (const html of [renderProgram(program), renderQuery(query)]) {
    assert.match(html, /<span class="status"><\/span>/);
    assert.match(html, /<button data-act="reset" disabled>reset<\/button>/);
  }
});

test('a goal containing a quote does not break out of the attribute', () => {
  const html = renderQuery({ id: 'q-str', goal: 'X = "str", atom_string(A, X)' });
  assert.match(html, /value="X = &quot;str&quot;, atom_string\(A, X\)"/);
});

test('a query with no saved answers has an empty output area', () => {
  // .out:empty is display:none, so an unanswered query is a cell with nothing
  // under it rather than an empty box.
  const html = renderQuery({ id: 'q-1', goal: 'is_son(X)', output: null });
  assert.match(html, /<div class="out"><\/div>\n<\/div>$/);
});

// --- the saved answers -----------------------------------------------------
// The property this project is for: a chapter is readable the instant it loads,
// and stays readable if the 5.9 MB engine never arrives at all.

test('a chapter renders its own answers with no engine anywhere', () => {
  const html = renderQuery(query);
  assert.match(html, /<div class="line sol">1\.  X = edward<\/div>/);
  assert.match(html, /<div class="line sol">6\.  X = george<\/div>/);
  assert.match(html, /<div class="line done">no more solutions\.<\/div>/);
});

test('the saved answers say whose they are', () => {
  // docs/modes.md §3: an output is never shown without being attributable. A
  // reader who mistakes the author's answers for their own concludes something
  // false about Prolog rather than about us.
  assert.match(renderQuery(query), /<div class="line from">[^<]*saved answers<\/div>/);
});

test('the goal is echoed above its answers, as a live run echoes it', () => {
  // A reader pressing Run must not watch the layout change underneath them.
  assert.match(renderQuery(query), /<div class="line echo">\?- is_son\(X\)\.<\/div>/);
});

test('answers older than the program above them are marked, not hidden', () => {
  const stale = renderQuery(query, { stale: true });
  assert.match(stale, /<div class="line warn">[^<]*press Run[^<]*<\/div>/);
  assert.match(stale, /class="line from">[^<]*older version/);
  // Marked, never silently discarded and never silently trusted: the answers are
  // still there to read.
  assert.match(stale, /<div class="line sol">1\.  X = edward<\/div>/);
});

test('a deterministic answer is a solution, not a terminator', () => {
  // format §6 stores it as the last line, ending in "." with no ";" prompt,
  // because that is what SWI's toplevel prints when nothing is left to retry.
  // Rendering it as commentary would lose an answer.
  assert.deepEqual(replaySolutions({ solutions: [], terminator: 'X = edward.' }), [
    { cls: 'sol', text: '1.  X = edward' },
    { cls: 'done', text: 'no more solutions.' },
  ]);
});

test('a failed query says false, and does not claim a solution', () => {
  assert.deepEqual(replaySolutions({ solutions: [], terminator: 'false.' }), [
    { cls: 'done', text: 'false.' },
  ]);
});

test('false after solutions means exhausted, not contradicted', () => {
  // "false." printed under six answers reads as a denial of them.
  const lines = replaySolutions({ solutions: ['X = a', 'X = b'], terminator: 'false.' });
  assert.deepEqual(lines.map((l) => l.text), ['1.  X = a', '2.  X = b', 'no more solutions.']);
});

test('a ground success is true, counted as the answer it is', () => {
  assert.deepEqual(replaySolutions({ solutions: [], terminator: 'true.' }), [
    { cls: 'sol', text: '1.  true' },
    { cls: 'done', text: 'no more solutions.' },
  ]);
});

test('a saved error is shown as an error', () => {
  assert.deepEqual(replaySolutions({ solutions: [], terminator: 'ERROR: Unknown procedure: p/1' }), [
    { cls: 'err', text: 'Unknown procedure: p/1' },
  ]);
});

test('editing the program above a query marks its answers stale, before first paint', () => {
  // No engine, no re-run, no network: a 64-bit FNV-1a over text we already have.
  // That is why the hash is not a SHA — WebCrypto is async in the browser and
  // would push this past the first paint it exists to beat.
  const edited = parse(readFileSync(NOTEBOOK, 'utf8'));
  const family = edited.cells.find((c) => c.id === 'p-family');
  family.source += '\nmale(henry).';
  const html = renderNotebook(edited);
  assert.equal((html.match(/class="line warn"/g) ?? []).length, 4, 'every answer below it is stale');
});

test('a whole chapter renders its answers, and marks none of them stale', () => {
  // The chapter agrees with itself, so nothing is marked. This is the same check
  // format.test.mjs makes on the hashes, seen from the reader's side.
  const html = renderNotebook(notebook);
  assert.equal((html.match(/class="line warn"/g) ?? []).length, 0);
  assert.equal((html.match(/class="line from"/g) ?? []).length, 4, 'four answered queries');
});

// --- the whole notebook ----------------------------------------------------

test('a notebook renders kicker first, then every cell in document order', () => {
  const html = renderNotebook(notebook);
  assert.match(html, /^<div class="kicker">Cut and control<\/div>/);
  const order = ['<h1>', 'p-family', 'q-is-son', 'class="note"', 'class="aside"', 'p-fixes',
    'class="predict"', 'q-son-a', 'q-son-b', 'class="bullets"'];
  let at = 0;
  for (const marker of order) {
    const next = html.indexOf(marker, at);
    assert.notEqual(next, -1, `${marker} should appear after the previous one`);
    at = next;
  }
});

test('a notebook with no kicker starts with its first cell', () => {
  const plain = parse('# Title\n\ntext\n');
  assert.match(renderNotebook(plain), /^<h1>Title<\/h1>/);
});
