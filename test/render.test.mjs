import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from '../src/format.js';
import { renderProse, renderContainer, renderCell, renderKicker } from '../src/render.js';

const FIXTURE = new URL('./fixtures/ch04-cut.prolog.md', import.meta.url);
const notebook = parse(readFileSync(FIXTURE, 'utf8'));
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
  assert.match(html, /<textarea spellcheck="false"><\/textarea>/);
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
  assert.match(html, /<li>Prolog enumerates <strong>proofs<\/strong>, not answers\.<\/li>/);
});

test('renderCell owns prose and containers, and nothing else', () => {
  assert.equal(typeof renderCell(notebook.cells[0]), 'string');
  assert.equal(typeof renderCell(container('aside')), 'string');
  // Program and query cells belong to 869ectrzz. Returning null rather than an
  // empty string means a missing renderer cannot look like an empty cell.
  assert.equal(renderCell(notebook.cells.find((c) => c.kind === 'program')), null);
  assert.equal(renderCell(notebook.cells.find((c) => c.kind === 'query')), null);
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

test('every prose and container cell in a real chapter renders', () => {
  const rendered = notebook.cells
    .filter((c) => c.kind === 'markdown' || c.kind === 'container')
    .map(renderCell);
  assert.equal(rendered.length, 8);
  assert.equal(rendered.every((html) => typeof html === 'string' && html.length > 0), true);
});
