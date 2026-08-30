import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pageFor, fakeEngine } from './support/page.mjs';
import { InProcessSession, ConsultLog } from '../src/session.js';
import { colophon } from '../src/version.js';
import { WorkerSession } from '../src/browser.js';
import { editsOf } from '../src/notebook.js';
import { clearedSource, exportSource } from '../src/export.js';

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

test('it releases as they write, not only when they leave the box', async () => {
  // It listened on `change` alone, which fires on blur — so a reader who typed
  // their prediction and looked up saw nothing happen, and the link between "I
  // wrote something" and "the answers appeared" was broken by a pause with no
  // cause (869ernmzh).
  const page = chapter();
  page.type_predict('A gives one');
  assert.equal(page.hidden('q-son-a'), true, 'not on the first keystroke');

  await new Promise((resolve) => setTimeout(resolve, 1400));
  assert.equal(page.hidden('q-son-a'), false, 'but on stopping, with no click needed');
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
    for (const method of ['consult', 'unconsult', 'restart', 'abort', 'query', 'supersede']) {
      assert.equal(typeof real.prototype[method], 'function', `${real.name}.${method}`);
      assert.equal(typeof fake[method], 'function', `fake.${method}`);
    }
  }
  // And the log the page interrogates is the real class, not a stand-in for it.
  assert.ok(fake.log instanceof ConsultLog);
});

// ------------------------------------------------ one sequence at a time

test('running another query closes a half-walked sequence, and says so in its cell', async () => {
  // ONE ENGINE, ONE OPEN QUERY (869epzqpc). SWI keeps them on a stack, so a
  // sequence left part-way was already dead the moment another cell ran — it just
  // said nothing until the reader came back and pressed `; next`, and then said it
  // in SWI's words about a stack they never knew existed.
  const page = chapter();
  page.press('q-is-son', 'run');
  await page.settle();
  assert.ok(page.out('q-is-son').includes('1.  X = edward'), 'one of two taken');

  page.press('q-son-b-george', 'run');
  await page.settle();

  assert.equal(
    page.out('q-is-son').at(-1),
    'sequence closed — another query was run. Press Run to start this one again.'
  );
  // What they DID take stays. It is theirs, and it is still true of the program
  // above — which is why the tick is left alone as well.
  assert.ok(page.out('q-is-son').includes('1.  X = edward'));
  assert.match(page.status('q-is-son'), /^✓ ran /);
  // And the way on is the button that was always there.
  const cell = page.cell('q-is-son');
  assert.equal(cell.querySelector('[data-act="next"]').disabled, true);
  assert.equal(cell.querySelector('[data-act="run"]').disabled, false);
});

test('a sequence walked to the end is not interrupted by anything', async () => {
  const page = chapter();
  page.press('q-is-son', 'run');
  await page.settle();
  page.cell('q-is-son').querySelector('[data-act="all"]').click();
  await page.settle();
  assert.equal(page.out('q-is-son').at(-1), 'no more solutions.');

  page.press('q-son-b-george', 'run');
  await page.settle();
  assert.equal(page.out('q-is-son').at(-1), 'no more solutions.', 'nothing was open to close');
});

test('reset hands the engine back the frame this cell was holding', async () => {
  // A reader pressing reset has said "pretend I never ran this". A page that puts
  // the text back while leaving a query open in their name has agreed with them in
  // words and disagreed in fact — the same argument that makes a program cell's
  // reset un-consult.
  const page = chapter();
  page.press('q-is-son', 'run');
  await page.settle();
  assert.ok(page.engine.open, 'the engine is holding a sequence for this cell');

  page.press('q-is-son', 'reset');
  await page.settle();
  assert.equal(page.engine.open, null);
});

// ----------------------------------------------------------------- export

test('the version to download becomes a choice, once there is one to make', async () => {
  // THE STATE IS THE CHOICE. Every other row says what is true and offers the
  // verb that changes it; this is the one place where the reader's version and
  // the chapter's both exist, so the phrase that reported which was on screen
  // becomes the control that picks between them — one button, and no second
  // download to be taken by mistake.
  const handed = [];
  const page = chapter({
    download: () => ({ filename: 'ch.prolog.md', text: 'mine' }),
    published: () => ({ filename: 'ch.prolog.md', text: 'the original bytes' }),
  });
  // A phrase until there are two: a menu with one item is a control pretending
  // to offer something.
  assert.equal(page.panel().notebook, 'As published');
  assert.equal(page.panel().choices, null);

  // ONE OF THEM, NEVER BOTH — as far as this file can see. The picker once sat
  // beside the phrase it replaces, visibly, while every attribute said it was
  // hidden: `hidden` is a UA rule and any author `display` rule outranks it.
  // jsdom resolves that the other way round, so no assertion here could have
  // caught it. The stylesheet is guarded in css.test.mjs instead, and the truth
  // is checked in a browser.
  assert.equal(page.shows('.page-controls .picker'), false);
  assert.equal(page.shows('.page-controls .only'), true);

  page.type('p-family', 'male(albert).');
  await page.settle(1);
  assert.deepEqual(page.panel().choices, ['Your version', 'As published']);
  assert.equal(page.panel().notebook, 'Your version', 'what is on screen is the default');
  assert.equal(page.shows('.page-controls .picker'), true);
  assert.equal(page.shows('.page-controls .only'), false, 'the phrase gives way to the choice');

  page.window.URL.createObjectURL = (blob) => { handed.push(blob); return 'blob:x'; };
  page.window.URL.revokeObjectURL = () => {};
  globalThis.URL.createObjectURL = page.window.URL.createObjectURL;
  globalThis.URL.revokeObjectURL = page.window.URL.revokeObjectURL;

  page.chooseVersion('published');
  assert.equal(page.panel().notebook, 'As published');
  page.find('[data-act="download"]').click();
  assert.equal(handed.length, 1);

  // The choice is theirs and it sticks: a control that silently returns to its
  // default hands them a file they did not pick.
  page.type('p-family', 'male(albert).\nmale(zoe).');
  await page.settle(1);
  assert.equal(page.panel().notebook, 'As published');
});

test('a cell that ran without being clicked still moves the notebook row', async () => {
  // THE PANEL MUST NOT LIE UNTIL THE NEXT CLICK. An automatic re-run (format §5)
  // is started by a consult in ANOTHER cell and finishes after that click has
  // been and gone, so a row that only listens to its own clicks reports the state
  // as it was before the run. This is the same failure as the Hide control that
  // jammed: a control saying something that stopped being true.
  const answers = { 'son(X)': ['X = edward'] };
  const page = pageFor(REACTIVE, {
    engine: fakeEngine({ answers }),
    download: () => ({ filename: 'ch.prolog.md', text: 'mine' }),
    published: () => ({ filename: 'ch.prolog.md', text: 'published' }),
  });
  assert.equal(page.panel().notebook, 'As published');

  // The reader consults an edited program. They never touch the query below it.
  page.type('p-1', 'son(edward).\nson(alfred).');
  answers['son(X)'] = ['X = edward', 'X = alfred'];
  page.press('p-1', 'consult');
  await page.settle();

  assert.match(page.out('q-auto')[0], /^re-run automatically/, 'the cell ran by itself');
  assert.equal(page.panel().notebook, 'Your version', 'and the row knows');
  assert.deepEqual(page.panel().choices, ['Your version', 'As published']);
});

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

// ------------------------------------------------------- rerun="auto"

// A chapter that demonstrates rather than quizzes: the author wants the answers
// to follow the program, so the reader can change a clause and see the solution
// set change without pressing Run in every cell below (869eddzgq).
const REACTIVE = `---
format: prolog-notebook/1
---

# Reactive

\`\`\`prolog program id="p-1"
son(edward).
\`\`\`

\`\`\`prolog query id="q-auto" rerun="auto"
son(X)
\`\`\`

\`\`\`text output for="q-auto"
X = edward.
\`\`\`

\`\`\`prolog query id="q-manual"
son(X)
\`\`\`

\`\`\`text output for="q-manual"
X = edward.
\`\`\`

\`\`\`prolog program id="p-2"
daughter(alice).
\`\`\`
`;

/** The answers map is returned so a test can change what the engine will say next. */
const reactive = (source = REACTIVE) => {
  const answers = { 'son(X)': ['X = edward'] };
  return { answers, page: pageFor(source, { engine: fakeEngine({ answers }) }) };
};

test('an auto cell follows the program the reader just consulted', async () => {
  const { answers, page } = reactive();
  assert.match(page.out('q-auto')[0], /the chapter’s saved answers/);

  page.type('p-1', 'son(edward).\nson(alfred).');
  answers['son(X)'] = ['X = edward', 'X = alfred'];
  page.press('p-1', 'consult');
  await page.settle();

  // Answers nobody pressed a button for must say so. "your run" over these would
  // be the page attributing its own work to the reader.
  assert.match(page.out('q-auto')[0], /^re-run automatically · \d\d:\d\d:\d\d/);
  assert.match(page.status('q-auto'), /^✓ ran/);

  // THE WHOLE SEQUENCE, and this is not a preference. SWI's query frames are a
  // stack: a cell left mid-sequence holds a frame that nothing closes, and the
  // next cell to run opens INSIDE it — after which stepping the first one fails
  // with "Attempt to access not innermost query". Two auto cells on one page make
  // that certain rather than unlucky. Found in a browser; asserted here as what a
  // reader sees, which is a finished answer and no `; next` still waiting.
  assert.deepEqual(page.out('q-auto').slice(2), [
    '1.  X = edward', '2.  X = alfred', 'no more solutions.',
  ]);
  assert.equal(page.cell('q-auto').querySelector('[data-act="next"]').disabled, true);

  // And the cell that did not ask for it is untouched — still the chapter's.
  assert.match(page.out('q-manual')[0], /the chapter’s saved answers/);
});

test('a consult that changes nothing re-runs nothing', async () => {
  // Auto acts on "would these answers be different now", not on "did something
  // happen". Re-running four cells to print the same four answers is a page being
  // busy at the reader.
  const { page } = reactive();
  page.press('p-1', 'consult');
  await page.settle();
  assert.match(page.out('q-auto')[0], /the chapter’s saved answers/);
});

test('an auto cell ignores a consult below it', async () => {
  // p-2 was never part of these answers — Run loads the cells ABOVE — so reacting
  // to it would be a cell reacting to something it cannot see.
  const { page } = reactive();
  page.type('p-2', 'daughter(alice).\ndaughter(zoe).');
  page.press('p-2', 'consult');
  await page.settle();
  assert.match(page.out('q-auto')[0], /the chapter’s saved answers/);
});

test('the page never starts an engine for an auto cell nobody asked to run', async () => {
  // A chapter is readable with nothing downloaded. An author writing rerun="auto"
  // must not make every arriving reader pull 5.9 MB, so a saved answer whose hash
  // already disagrees stays MARKED — exactly as manual does — until the reader
  // acts. The hash told the truth before first paint; that is what it is for.
  const stale = REACTIVE.replace('```text output for="q-auto"', '```text output for="q-auto" input-hash="0000000000000000"');
  const { page } = reactive(stale);
  await page.settle();
  assert.equal(page.boots(), 0);
  assert.equal(page.engine.consulted.length, 0);
  assert.match(page.out('q-auto').join('\n'), /the program above has changed since these were produced/);

  // But once the reader does consult, the stale saved answers are what auto is
  // for: they are refreshed without a Run in every cell.
  page.press('p-1', 'consult');
  await page.settle();
  assert.match(page.out('q-auto')[0], /^re-run automatically/);
});

test('the consults a restart replays are not the reader saying anything', async () => {
  // Restart rebuilds the engine into what it already was. Nothing the reader
  // wrote changed, and a repair action that re-ran the chapter as a side effect
  // would be the page deciding to work on its own.
  const { page } = reactive();
  page.press('q-auto', 'run');
  await page.settle();
  assert.match(page.out('q-auto')[0], /^your run/);

  page.find('.page-controls [data-act="restart"]').click();
  await page.settle();
  assert.match(page.out('q-auto')[0], /^your run/, 'not re-run');
  assert.equal(page.status('q-auto'), 'engine restarted since this ran');
});

test('an auto re-run does not answer the question the reader is still being asked', async () => {
  // hold and rerun are one mechanism, not two (format §5): the same flag decides
  // whether the answers are visible and whether the cell may re-run behind the
  // reader's back. A chapter that quizzes the reader and then answers itself is
  // worse than one that never asked.
  const quiz = REACTIVE.replace(
    '```prolog query id="q-auto" rerun="auto"',
    '> [!predict] What does son(X) give?\n>\n> _your answer_\n\n```prolog query id="q-auto" rerun="auto" hold="until-answered"'
  );
  const { answers, page } = reactive(quiz);
  assert.equal(page.hidden('q-auto'), true);

  page.type('p-1', 'son(edward).\nson(alfred).');
  answers['son(X)'] = ['X = edward', 'X = alfred'];
  page.press('p-1', 'consult');
  await page.settle();
  assert.equal(page.hidden('q-auto'), true, 'still held');
  assert.match(page.out('q-auto')[0], /held until you write your prediction above/);

  // Once the wait is over the cell reverts to what it declared.
  page.predict('two, I think');
  page.press('p-1', 'consult');
  await page.settle();
  assert.match(page.out('q-auto')[0], /^re-run automatically/);
  assert.ok(page.out('q-auto').includes('2.  X = alfred'));
});

test('an auto cell waits while the reader is walking a sequence anywhere on the page', async () => {
  // ONE ENGINE, ONE OPEN QUERY (869epzqpc). An automatic re-run opens one, so it
  // would close whatever the reader is stepping through in another cell — the
  // page interrupting an enquiry nobody asked it to interrupt. It waits instead,
  // and the stale mark says why nothing moved.
  const { answers, page } = reactive();
  page.press('q-manual', 'run');
  await page.settle();
  assert.ok(page.engine.open, 'the reader is mid-sequence in another cell');

  page.type('p-1', 'son(edward).\nson(alfred).');
  answers['son(X)'] = ['X = edward', 'X = alfred'];
  page.press('p-1', 'consult');
  await page.settle();
  assert.match(page.out('q-auto')[0], /the chapter’s saved answers/, 'it held off');

  // When they finish, the next consult picks it up. Nothing was lost, only waited.
  page.cell('q-manual').querySelector('[data-act="all"]').click();
  await page.settle();
  assert.equal(page.engine.open, null);
  page.press('p-1', 'consult');
  await page.settle();
  assert.match(page.out('q-auto')[0], /^re-run automatically/);
});

test('a re-run cannot start another one', async () => {
  // THE LOOP THAT WOULD NOT STOP: a re-run consults the cells above it, and a
  // consult is what starts a re-run. A failing cell never enters the consult log,
  // so it is re-consulted every time — which is the case that turns a cycle into
  // an infinite one. The cause on the event is what breaks it.
  const answers = { 'son(X)': ['X = edward'] };
  const page = pageFor(REACTIVE, {
    engine: fakeEngine({ answers, fail: { 'p-1': 'line 2: Syntax error' } }),
  });
  page.type('p-1', 'son(edward');
  page.press('p-1', 'consult');
  await page.settle(20);

  assert.equal(page.engine.consulted.length, 2, 'the press, and the re-run’s own load');
  assert.match(page.out('q-auto').join('\n'), /did not load/);
});

test('an auto cell mid-sequence is left alone, and says why', async () => {
  // Re-running would yank the solution stream out from under a reader walking it
  // with `; next`. So it stays as it is and the tick tells the truth, which is
  // exactly what a manual cell does — auto is not licence to interrupt.
  const { answers, page } = reactive();
  answers['son(X)'] = ['X = edward', 'X = alfred', 'X = george'];
  page.press('q-auto', 'run');
  await page.settle();
  assert.ok(page.out('q-auto').includes('1.  X = edward'), 'one of three, sequence open');

  page.type('p-1', 'son(edward).\nson(zoe).');
  page.press('p-1', 'consult');
  await page.settle();
  assert.match(page.out('q-auto')[0], /^your run/, 'their sequence survived');
  assert.equal(page.status('q-auto'), 'program changed since this ran');
});

// ------------------------------------------------------------- the colophon

test('the panel says what this is, from the same words the command uses', async () => {
  // One release cannot be described two ways: the page and `prolog-notebook
  // --version` take their facts from src/version.js. The page arranges them as
  // two short lines — what is running, then who owns it — because it has a card
  // to fit them in rather than a terminal to fill.
  const page = chapter();
  assert.equal(page.panel().about, colophon().running);
  assert.equal(page.panel().legal, colophon().legal);
  assert.match(page.panel().about, /^Prolog Notebook v\d+\.\d+\.\d+$/);
  assert.match(page.panel().legal, /^© \d{4} .+ · MIT License$/);

  // The engine's own version is not knowable until it has started — it lives
  // inside the WebAssembly — so nothing is said rather than guessed at.
  assert.equal(page.panel().engineVersion, '');
});

test('the engine names itself once it is running', async () => {
  const engine = fakeEngine({ answers: ANSWERS });
  // The real sessions answer this by asking SWI for current_prolog_flag(version).
  engine.query = ((inner) => (goal) => (goal.includes('current_prolog_flag')
    ? { async next() { return { done: true, solution: {}, text: '' }; }, async all() { return { solutions: [{ V: 100113 }] }; }, async close() {} }
    : inner(goal)))(engine.query);

  const page = pageFor(CHAPTER, { engine });
  page.press('q-son-a', 'run');
  await page.settle();
  // It joins the line that says what is running, because that is what it is.
  assert.equal(page.panel().engineVersion, ' · SWI-Prolog 10.1.13');
  // Composed rather than spelled out: a test that restates the version is one
  // more file to remember at release, and it caught nothing that this does not.
  assert.equal(page.panel().about, `${colophon().running} · SWI-Prolog 10.1.13`);
});

// ------------------------------------- clearing the answers, and putting back

test('the outputs row counts the chapter, and empties it on request', async () => {
  const page = chapter();
  // THE FACT THE READER DOES NOT HAVE: how much of this chapter is answers. The
  // row above says whether they are on screen; this one says how many there are.
  assert.equal(page.panel().outputs, '4 outputs on this page');
  assert.equal(page.panel().outputsButton, 'Clear all outputs');

  page.pressPage('clear-all');
  await page.settle(1);
  for (const id of ['q-is-son', 'q-son-a', 'q-son-b', 'q-son-b-george']) {
    assert.deepEqual(page.out(id), [], `${id} is empty`);
  }
  assert.equal(page.panel().outputs, '4 outputs cleared');
  // The verb flips only once there is nothing left to clear — the same rule the
  // hide/show button follows one row above, so it is one vocabulary and not two.
  assert.equal(page.panel().outputsButton, 'Restore outputs');

  page.pressPage('clear-all');
  await page.settle(1);
  assert.equal(page.panel().outputs, '4 outputs on this page');
  assert.ok(page.out('q-is-son').includes('1.  X = edward'), 'the chapter is back');
});

test('a page emptied on screen downloads as the same bytes the CLI would write', async () => {
  // THE PROPERTY THAT MAKES THIS ONE FEATURE RATHER THAN TWO. `clear` at the
  // terminal and clear in the panel go through the same erasure — `output: null`
  // — so a chapter emptied either way is the same file, and neither of them is
  // quietly reformatting the author's markdown on the way past.
  const page = chapter();
  const asIs = exportSource(page.notebook, editsOf(page.cells));

  page.pressPage('clear-all');
  await page.settle(1);
  assert.equal(exportSource(page.notebook, editsOf(page.cells)),
    clearedSource(page.notebook).text);

  // And back, exactly: restore is the inverse of clear, down to the bytes.
  page.pressPage('clear-all');
  await page.settle(1);
  assert.equal(exportSource(page.notebook, editsOf(page.cells)), asIs);
});

test('clearing is an edit, so the reader is offered the version they made', async () => {
  const page = chapter({
    download: () => ({ filename: 'ch.prolog.md', text: 'mine' }),
    published: () => ({ filename: 'ch.prolog.md', text: 'published' }),
  });
  assert.equal(page.panel().notebook, 'As published');

  page.pressPage('clear-all');
  await page.settle(1);
  // A chapter with the answers taken out is not the chapter as published, and a
  // download row still saying so would hand them a file full of the answers they
  // had just removed.
  assert.deepEqual(page.panel().choices, ['Your version', 'As published']);
  assert.equal(page.panel().notebook, 'Your version');
});

test('one cell can be brought back out of a page-wide clear', async () => {
  const page = chapter();
  page.pressPage('clear-all');
  await page.settle(1);
  // A reset button left grey over an emptied cell would say the answers are gone
  // for good, which is the opposite of what the control is for.
  assert.equal(page.cell('q-is-son').querySelector('[data-act="reset"]').disabled, false);

  page.press('q-is-son', 'reset');
  await page.settle(1);
  assert.ok(page.out('q-is-son').includes('1.  X = edward'));
  assert.equal(page.panel().outputs, '3 outputs cleared', 'and the row heard about it');
  assert.equal(page.panel().outputsButton, 'Clear all outputs', 'there is something to clear again');
});

test('clear takes the reader\'s own answers too, and Run brings them back', async () => {
  // "Clear all output" that leaves some output on the page has not done what it
  // says. Losing a run is no worse than what reset has always done to one, and
  // the way to have it again is the button that produced it.
  const page = chapter();
  page.press('q-son-b', 'run');
  await page.settle();
  assert.match(page.out('q-son-b')[0], /^your run/);

  page.pressPage('clear-all');
  await page.settle(1);
  assert.deepEqual(page.out('q-son-b'), []);

  page.press('q-son-b', 'run');
  await page.settle();
  // The chapter's answers were never destroyed, only taken off the page — so the
  // note that says how to get them back is still the truth.
  assert.match(page.out('q-son-b')[0], /your run .* press reset for the chapter’s saved answers/);
});

test('a cleared cell stays cleared when the program under it changes', async () => {
  // `rerun="auto"` exists so answers do not go stale under a reader who edited
  // the program. A cell with no answers has none that can — and refilling it
  // would be the page overruling the reader who emptied it, behind their back,
  // because they pressed Consult somewhere else entirely.
  const { answers, page } = reactive();
  page.pressPage('clear-all');
  await page.settle(1);
  assert.deepEqual(page.out('q-auto'), []);

  page.type('p-1', 'son(edward).\nson(alfred).');
  answers['son(X)'] = ['X = edward', 'X = alfred'];
  page.press('p-1', 'consult');
  await page.settle();

  assert.deepEqual(page.out('q-auto'), [], 'still the reader\'s empty page');
  // With the engine RUNNING — their Consult started it — so the cell stayed
  // empty because it decided to, not because there was nothing to run it with.
  assert.equal(page.boots(), 1);
});

test('a held cell that is cleared does not claim to be waiting for anything', async () => {
  // "held until you write your prediction above" over an empty box is a wait with
  // nothing left to wait for: the answers it was holding back are gone.
  const page = chapter();
  assert.match(page.out('q-son-a')[0], /held until/);

  page.pressPage('clear-all');
  await page.settle(1);
  assert.deepEqual(page.out('q-son-a'), []);
  assert.equal(page.hidden('q-son-a'), false, 'nothing left to hide');
  assert.equal(page.panel().answers, 'No saved answers on screen');
  assert.equal(page.panel().answersDisabled, true);
});

test('mounting is what makes Run and Consult live', async () => {
  // The other half of the markup shipping them disabled (869erqq1u): a page
  // whose runtime never arrived stays inert, and one where it did is normal.
  // Asserted here rather than in the renderer because "the runtime turns them
  // on" is a claim about mount(), and it is the half that would rot silently.
  const page = chapter();
  assert.equal(page.cell('p-family').querySelector('[data-act="consult"]').disabled, false);
  assert.equal(page.cell('q-son-b').querySelector('[data-act="run"]').disabled, false);

  // And a cell nobody mounted keeps what the renderer gave it — which is the
  // whole point, and the state the Captain's page was stuck in.
  const { JSDOM } = await import('jsdom');
  const { renderQuery } = await import('../src/render.js');
  const cold = new JSDOM(`<body>${renderQuery({ id: 'q', goal: 'a', output: null })}</body>`);
  assert.equal(cold.window.document.querySelector('[data-act="run"]').disabled, true);
});

test('a chapter with no saved answers can still clear the ones you made', async () => {
  // THE REPORT. A chapter published without answers — which is most of them
  // while an author is still writing — had the outputs row removed entirely, so
  // a reader who ran cells had no way to clear what they had produced, and a
  // panel with the row missing reads as a control that has broken (869erqw08).
  const { page } = reactive(REACTIVE.replace(/```text output[\s\S]*?```\n\n/g, ''));
  assert.equal(page.panel().outputs, 'No outputs yet');
  assert.equal(page.panel().outputsDisabled, true, 'and it says so rather than pretending');
  // The row above stays keyed to the FILE, and correctly: hiding is for the
  // chapter's saved answers, and a reader's own run is not a spoiler.
  assert.equal(page.panel().answers, null, 'nothing of the chapter\'s to put away');

  page.press('q-auto', 'run');
  await page.settle();
  assert.equal(page.panel().outputs, '1 output on this page');
  assert.equal(page.panel().outputsDisabled, false);

  page.pressPage('clear-all');
  await page.settle(1);
  assert.deepEqual(page.out('q-auto'), []);
  assert.equal(page.panel().outputs, '1 output cleared');
  // Nothing of the chapter's to restore — it never had any — so the button says
  // so by going quiet rather than by offering to put back nothing.
  assert.equal(page.panel().outputsButton, 'Restore outputs');
  assert.equal(page.panel().outputsDisabled, true);
});

test('the version probe cannot race the run that started the engine', async () => {
  // THE REGRESSION, reported from a real chapter: pressing Run on a fresh page
  // answered `Attempt to access not innermost query` while the panel displayed
  // the version perfectly well (869erqvzu). Asking for the version IS A QUERY,
  // and one engine allows one open query — so firing it beside the reader's own
  // Run put two opens into the worker's queue, and whichever arrived second
  // nested inside the first.
  //
  // Held open here on purpose: the probe cannot finish until this test lets it,
  // and the reader's query must not have been opened before then.
  const page = chapter();
  const opened = [];
  let release;
  const probe = new Promise((resolve) => { release = resolve; });
  const real = page.engine.query.bind(page.engine);
  page.engine.query = (goal) => {
    if (/current_prolog_flag/.test(goal)) {
      return {
        async all() { await probe; return { solutions: [], truncated: false }; },
        async next() { await probe; return { done: true }; },
        async close() {},
      };
    }
    opened.push(goal);
    return real(goal);
  };

  page.press('q-son-b', 'run');
  await page.settle();
  assert.deepEqual(opened, [], 'the run has not opened a query beside the probe');

  release();
  await page.settle();
  assert.deepEqual(opened, ['son_b(X)'], 'and goes ahead once the engine is free');
  assert.match(page.out('q-son-b')[0], /^your run/);
  assert.doesNotMatch(page.out('q-son-b').join('\n'), /innermost/);
});
