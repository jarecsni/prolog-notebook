import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The stylesheet, asserted as TEXT — which is a weak kind of test and is here
// because the strong kind is impossible in this suite.
//
// jsdom resolves the `hidden` attribute ABOVE an author `display` rule. A real
// browser does the opposite: `[hidden] { display: none }` is a UA rule, so any
// class rule of ours beats it and an element told to hide stays on screen. That
// is not a subtlety — it put the version picker on screen beside the phrase it
// replaces, in the panel, while every attribute in the DOM said it was hidden
// (869erkea4). Loading the CSS into jsdom would make that bug PASS while looking
// like proof, so it is checked here, and in a browser.

const CSS = readFileSync(new URL('../src/notebook.css', import.meta.url), 'utf8');

test('anything the panel hides is actually hidden', () => {
  assert.match(
    CSS,
    /\.page-controls \[hidden\]\s*\{\s*display:\s*none\s*!important/,
    'the page controls need a rule that outranks their own display rules',
  );
});

test('every element the panel hides is inside that guard', () => {
  // The guard is scoped to .page-controls, so a future control that hides
  // something elsewhere needs its own. This lists what currently relies on it.
  const hidden = [...readFileSync(new URL('../src/notebook.js', import.meta.url), 'utf8')
    .matchAll(/(\w+)\.hidden = /g)].map((m) => m[1]);
  assert.deepEqual([...new Set(hidden)].sort(), ['only', 'picker', 'stateful']);
  // `stateful` is a badge in a cell, not in the panel, and has no display rule
  // of its own — which is why it does not need the guard and must not grow one
  // without it.
  assert.doesNotMatch(CSS, /\.badge\.stateful\s*\{[^}]*display:/);
});

test('the page that cannot run says so without needing script to say it', () => {
  // The warning explains a page whose JavaScript did not load, so nothing about
  // showing it may depend on JavaScript (869erqq1u). mount() removes the element
  // on a page that boots; the delay is what stops a working page flashing it.
  assert.match(CSS, /#boot-warning\s*\{[^}]*animation:\s*boot-warning[^}]*\}/,
    'it reveals itself with an animation, not with a timer');
  assert.match(CSS, /#boot-warning\s*\{[^}]*position:\s*fixed/,
    'and out of the flow, so a page that boots does not jolt when it is removed');
  // A delay of zero would flash it on every load; a very long one would leave
  // somebody staring at a dead button wondering.
  const delay = /animation:\s*boot-warning\s+[\d.]+m?s\s+[a-z-]+\s+([\d.]+)s/.exec(CSS);
  assert.ok(delay && Number(delay[1]) >= 0.5 && Number(delay[1]) <= 3, `delay was ${delay?.[1]}`);
});
