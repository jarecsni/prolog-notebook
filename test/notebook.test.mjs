import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pageFor, fakeEngine } from './support/page.mjs';
import { InProcessSession, ConsultLog } from '../src/session.js';
import { WorkerSession } from '../src/browser.js';

// The page's own behaviour, in a DOM that is not a browser (869enpj26).
//
// Everything asserted here was previously verifiable only by clicking, which is
// how both of this week's bugs reached the Captain instead of the suite. The
// engine is a fake: what is under test is whether the page tells the truth about
// what it and the engine are holding, not whether Prolog works.
//
// The real chapter, because a page that stops working for the chapter someone is
// meant to read is what this should say.
const CHAPTER = readFileSync(new URL('../notebooks/ch04-cut.prolog.md', import.meta.url), 'utf8');

const ANSWERS = {
  'son_a(X)': ['X = edward'],
  'son_b(X)': ['X = edward', 'X = alfred', 'X = george'],
  'is_son(X)': ['X = edward', 'X = edward'],
  'son_b(george)': ['true'],
};

const chapter = (options = {}) => pageFor(CHAPTER, { engine: fakeEngine({ answers: ANSWERS }), ...options });

// ------------------------------------------------ the page's answers control

test('the answers control counts what is on screen, not what is in the file', async () => {
  // THE REGRESSION. A cell showing the reader's own run refuses to hide, because
  // hiding is for the chapter's answers and the way back to those is reset. The
  // control was counting cells that HAVE saved answers in the file, so the run
  // cell could never be hidden, "is anything still showing?" was permanently
  // true, and every click after the first re-hid the same cells and did nothing.
  const page = chapter();
  assert.equal(page.panel().answers, '2 of 4 hidden', 'two are held by the chapter');

  page.press('q-son-b', 'run');
  await page.settle();
  assert.equal(page.panel().answers, '1 of 3 hidden', 'the run cell has left the set');

  page.pressPage('peek-all');
  assert.deepEqual(
    [page.panel().answers, page.panel().answersButton],
    ['Answers hidden', 'Show saved answers'],
    'reachable now, which it was not'
  );

  page.pressPage('peek-all');
  assert.equal(page.panel().answers, 'Answers shown');

  // Reset puts the chapter's answers back on that cell, so it rejoins the set —
  // which is visible in the DENOMINATOR, the number the bug could never move.
  page.press('q-son-b', 'reset');
  await page.settle();
  page.cell('q-is-son').querySelector('[data-act="peek"]').click();
  assert.equal(page.panel().answers, '1 of 4 hidden');
});

test('with every cell run there is nothing of the chapter\'s left to put away', async () => {
  const page = chapter();
  for (const id of ['q-is-son', 'q-son-a', 'q-son-b', 'q-son-b-george']) {
    page.press(id, 'run');
    await page.settle();
  }
  assert.equal(page.panel().answers, 'No saved answers on screen');
  // A control that does nothing reads as a broken page, which is how the bug
  // above was reported. Saying so and going quiet is the honest version.
  assert.equal(page.panel().answersDisabled, true);
});

test('hiding one output by hand is counted rather than remembered', async () => {
  const page = chapter();
  page.cell('q-is-son').querySelector('[data-act="peek"]').click();
  assert.equal(page.panel().answers, '3 of 4 hidden');
  assert.equal(page.hidden('q-is-son'), true);
});

// ------------------------------------------------------------------- holding

test('a held cell keeps its answers in the page and out of sight', () => {
  const page = chapter();
  assert.equal(page.hidden('q-son-a'), true);
  // Never an empty box: the line says what it is waiting for.
  assert.match(page.out('q-son-a')[0], /held until you write your prediction above/);
  // And the answers are still there — print, EPUB and GitHub show them, because
  // holding is a property of the rendering and not of the content (format §5).
  assert.ok(page.out('q-son-a').includes('1.  X = edward'));
});

test('answering the prediction releases every cell it was holding', () => {
  const page = chapter();
  page.predict('   ');
  assert.equal(page.hidden('q-son-a'), true, 'whitespace is not a prediction');

  page.predict('A gives one, B gives three');
  assert.deepEqual([page.hidden('q-son-a'), page.hidden('q-son-b')], [false, false]);
});

test('an answer the reader has seen is never held again', () => {
  const page = chapter();
  page.cell('q-son-a').querySelector('[data-act="peek"]').click();   // show
  page.cell('q-son-a').querySelector('[data-act="peek"]').click();   // hide again
  // Their own hide now, not the author's hold — re-holding what they have read
  // would be theatre.
  assert.match(page.out('q-son-a')[0], /· hidden/);
  assert.doesNotMatch(page.out('q-son-a')[0], /held until/);
});

test('a run releases the hold, and the reader is told whose answers they are', async () => {
  const page = chapter();
  page.press('q-son-a', 'run');
  await page.settle();
  assert.equal(page.hidden('q-son-a'), false);
  assert.match(page.out('q-son-a')[0], /^your run · \d\d:\d\d:\d\d · press reset/);
});

// ------------------------------------------------------------ program cells

test('a program cell says what the engine is holding, at every step', async () => {
  const page = chapter();
  assert.equal(page.status('p-family'), 'not consulted');

  page.press('p-family', 'consult');
  await page.settle();
  assert.match(page.status('p-family'), /^✓ consulted \d\d:\d\d:\d\d$/);
  assert.equal(page.engine.consulted.at(-1).name, 'p-family');

  page.type('p-family', 'male(albert).');
  assert.equal(page.status('p-family'), 'edited since consulted',
    'the tick is about the engine, not about the clock');
});

test('reset puts the cell back AND takes it out of the engine', async () => {
  // Putting the page back without putting the engine back leaves them
  // disagreeing, which is the one thing this file exists to prevent.
  const page = chapter();
  page.press('p-family', 'consult');
  await page.settle();
  page.type('p-family', 'male(nobody).');
  page.press('p-family', 'reset');
  await page.settle();

  assert.equal(page.status('p-family'), 'not consulted');
  assert.deepEqual(page.engine.unconsulted, ['p-family']);
  assert.match(page.cell('p-family').querySelector('textarea').value, /^male\(albert\)\./);
});

test('a cell that failed to load says so where the reader is looking', async () => {
  const page = pageFor(CHAPTER, {
    engine: fakeEngine({ answers: ANSWERS, fail: { 'p-family': 'line 3: Syntax error' } }),
  });
  page.press('p-family', 'consult');
  await page.settle();
  assert.match(page.status('p-family'), /Syntax error/);
});

// -------------------------------------------------------------- staleness

test('staleness is derived, so undoing the edit clears it', async () => {
  const page = chapter();
  page.press('q-son-a', 'run');
  await page.settle();
  assert.equal(page.status('q-son-a').includes('ran'), true);

  const published = page.cell('p-fixes').querySelector('textarea').value;
  page.type('p-fixes', `${published}\nson_a(nobody).`);
  assert.match(page.status('q-son-a'), /program changed since this ran/);

  // Latched staleness would leave the warning standing after this. It is
  // recomputed from what the cells now say, so it goes.
  page.type('p-fixes', published);
  assert.doesNotMatch(page.status('q-son-a'), /program changed/);
});

test('editing the goal after a run marks the answers as no longer its own', async () => {
  const page = chapter();
  page.press('q-son-a', 'run');
  await page.settle();
  page.type('q-son-a', 'son_b(X)');
  assert.match(page.status('q-son-a'), /query edited since this ran/);
});

// ------------------------------------------------------------- the controls

test('the panel opens on a click and closes on Escape', () => {
  const page = chapter();
  assert.equal(page.panel().open, false);

  page.find('.page-controls .handle').click();
  assert.equal(page.panel().open, true);

  page.window.document.dispatchEvent(
    new page.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
  );
  assert.equal(page.panel().open, false);
});

test('the panel does not open itself when the engine starts', async () => {
  // It opens ONLY to report a failure. The reader pressed Run in a cell and their
  // attention is on that cell's output; a second thing moving in the corner
  // competes with the answers they asked for.
  const page = chapter();
  page.press('q-son-a', 'run');
  await page.settle();
  assert.equal(page.panel().engine, 'Engine on');
  assert.equal(page.panel().open, false);
});

test('the light says the engine is on, without anyone opening the panel', async () => {
  const page = chapter();
  assert.equal(page.panel().engine, 'Engine off');
  page.press('q-son-a', 'run');
  await page.settle();
  assert.equal(page.find('.page-controls').classList.contains('live'), true);
});

// ------------------------------------------------------------ the fake itself

test('the fake engine has the shape of the real ones', () => {
  // THE RISK WITH A FAKE IS DRIFT: it passes, the page ships, and the method it
  // was standing in for changed shape a month ago. Both real sessions are here,
  // so a rename that this fake does not follow fails at once — and it costs no
  // engine, because a prototype is not an instance.
  const fake = fakeEngine();
  for (const real of [InProcessSession, WorkerSession]) {
    for (const method of ['consult', 'unconsult', 'restart', 'abort', 'query']) {
      assert.equal(typeof real.prototype[method], 'function', `${real.name}.${method}`);
      assert.equal(typeof fake[method], 'function', `fake.${method}`);
    }
  }
  // And the log the page interrogates is the real class, not a stand-in for it.
  assert.ok(fake.log instanceof ConsultLog);
});

// ----------------------------------------------------------------- export

test('the download button reports whether anything is the reader\'s yet', async () => {
  let handed = null;
  const page = chapter({ download: () => ({ filename: 'ch.prolog.md', text: 'exported' }) });
  assert.equal(page.panel().notebook, 'As published');

  page.type('p-family', 'male(albert).');
  await page.settle(1);
  assert.equal(page.panel().notebook, 'Your version');

  // The click path is the reader's, so it is worth proving it reaches produce().
  page.window.URL.createObjectURL = (blob) => { handed = blob; return 'blob:x'; };
  page.window.URL.revokeObjectURL = () => {};
  globalThis.URL.createObjectURL = page.window.URL.createObjectURL;
  globalThis.URL.revokeObjectURL = page.window.URL.revokeObjectURL;
  page.find('[data-act="download"]').click();
  assert.ok(handed, 'a file was produced');
});
