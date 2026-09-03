import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, ConsultLog } from '../src/node.js';
import { InProcessSession } from '../src/session.js';
import { WorkerSession } from '../src/browser.js';

// Abort is "throw the engine away and rebuild it", which is only affordable
// because one cell is one virtual file: replaying a chapter costs milliseconds.
// These tests are about the replay, since that is what makes termination safe.

test('both sessions expose the same interface', () => {
  // The browser session had no restart() until 2026-08-18, while the in-process
  // one and the README both had it — found by pressing a button that called it.
  // Two implementations of one interface need a test that they ARE one interface,
  // because nothing else compares them: Node never runs the worker session and
  // the browser never runs the other.
  const methods = (klass) => Object.getOwnPropertyNames(klass.prototype)
    .filter((n) => n !== 'constructor')
    .sort();
  for (const name of methods(InProcessSession)) {
    assert.ok(methods(WorkerSession).includes(name), `WorkerSession is missing ${name}()`);
  }
});

test('the log holds one entry per cell, not a history of edits', () => {
  const log = new ConsultLog();
  log.record('p-1', 'a.');
  log.record('p-1', 'b.');
  log.record('p-2', 'c.');
  assert.deepEqual([...log], [{ name: 'p-1', text: 'b.' }, { name: 'p-2', text: 'c.' }]);
});

test('log order is insertion order, which is document order', () => {
  const log = new ConsultLog();
  log.record('c', '3.');
  log.record('a', '1.');
  log.record('b', '2.');
  assert.deepEqual([...log].map((e) => e.name), ['c', 'a', 'b']);
});

test('the log knows whether a cell is already loaded at this exact text', () => {
  // What makes "Run consults the cells above it" affordable on every click: the
  // second Run of a chapter consults nothing, because nothing has changed.
  const log = new ConsultLog();
  log.record('p-1', 'a.');
  assert.equal(log.isCurrent('p-1', 'a.'), true);
  assert.equal(log.isCurrent('p-1', 'a. b.'), false, 'an edit invalidates the cell');
  assert.equal(log.isCurrent('p-2', 'a.'), false, 'a cell never loaded is not current');
});

test('a cell that failed to consult is not current, so Run retries it', async () => {
  const session = await createSession();
  await session.consult('broken(', 'cell-bad');
  assert.equal(session.log.isCurrent('cell-bad', 'broken('), false);
});

test('un-consulting a cell takes its clauses back out of the engine', async () => {
  // Reset on a program cell means "pretend I never touched this", and a page that
  // restores the text while leaving the clauses loaded has agreed in words and
  // disagreed in fact. This is SWI's own semantics rather than bookkeeping: one
  // cell is one virtual file, and consulting a file replaces what came from it, so
  // consulting nothing leaves nothing.
  const session = await createSession();
  await session.consult('son(a, b).', 'cell-p');
  assert.equal((await session.query('son(X, Y)').all()).solutions.length, 1);

  await session.unconsult('cell-p');

  const after = await session.query('son(X, Y)').all();
  assert.deepEqual(after.solutions, []);
  assert.match(after.error ?? '', /Unknown procedure/, 'genuinely unknown, not merely empty');
});

test('an un-consulted cell does not come back on a restart', async () => {
  const session = await createSession();
  await session.consult('p(1).', 'cell-p');
  await session.consult('q(2).', 'cell-q');
  await session.unconsult('cell-p');
  await session.restart();
  assert.deepEqual([...session.log].map((e) => e.name), ['cell-q']);
  assert.deepEqual((await session.query('q(X)').all()).solutions.map((s) => s.X), [2]);
});

test('un-consulting a cell that was never loaded is not an error', async () => {
  // Reset is offered on a cell the engine never held, because the reader may have
  // edited it without consulting. Doing nothing quietly is the right answer.
  const session = await createSession();
  const r = await session.unconsult('cell-never');
  assert.equal(r.ok, true);
  assert.equal(r.unloaded, false);
});

test('a cell that used an un-consulted one is untouched, and says so at call time', async () => {
  // No cascade, deliberately. Prolog has no load-time name binding, so q/1 merely
  // mentions p/1; the consequence is an ordinary error when the goal runs, which
  // is the truth rather than a dependency graph we would have to invent.
  const session = await createSession();
  await session.consult('p(1).', 'cell-p');
  await session.consult('q(X) :- p(X).', 'cell-q');
  await session.unconsult('cell-p');
  const after = await session.query('q(X)').all();
  assert.match(after.error ?? '', /Unknown procedure: p\/1/);
});

test('a deleted cell is forgotten, so its clauses do not come back on replay', () => {
  const log = new ConsultLog();
  log.record('p-1', 'a.');
  log.record('p-2', 'b.');
  log.forget('p-1');
  assert.deepEqual([...log].map((e) => e.name), ['p-2']);
});

test('restarting rebuilds the clause store from the cells', async () => {
  const session = await createSession();
  await session.consult('p(1).\np(2).', 'cell-p');
  await session.consult('q(X) :- p(X).', 'cell-q');
  assert.deepEqual((await session.query('q(X)').all()).solutions.map((s) => s.X), [1, 2]);

  await session.restart();

  // A brand new engine, with every cell consulted again, in document order.
  assert.deepEqual((await session.query('q(X)').all()).solutions.map((s) => s.X), [1, 2]);
});

test('resetting keeps nothing at all, which is what a new chapter needs', async () => {
  const session = await createSession();
  await session.consult('secret(42).', 'cell-p');
  assert.equal((await session.query('secret(X)').all()).solutions.length, 1);

  await session.reset();

  // THE DIFFERENCE FROM restart() IS THE WHOLE BUG (869euun4p). restart replays
  // the log, because aborting a runaway goal has to put the reader's own
  // consults back. Between two chapters that reinstated the chapter before —
  // and a chapter with no program cell of its own was answered out of it.
  const after = await session.query('secret(X)').all();
  assert.equal(after.solutions.length, 0);
  assert.match(after.error ?? '', /Unknown procedure/);

  // And the log is empty, so a later restart cannot bring it back either.
  await session.restart();
  assert.equal((await session.query('secret(X)').all()).solutions.length, 0);
});

test('a re-consulted cell replays at its latest text, not its first', async () => {
  const session = await createSession();
  await session.consult('p(1).', 'cell-p');
  await session.consult('p(9).', 'cell-p');
  await session.restart();
  assert.deepEqual((await session.query('p(X)').all()).solutions.map((s) => s.X), [9]);
});

test('a failed consult is not replayed', async () => {
  const session = await createSession();
  const bad = await session.consult('broken(', 'cell-bad');
  assert.equal(bad.ok, false);
  await session.restart();
  // Nothing to replay means nothing to fail on the way back up.
  assert.match((await session.query('broken(X)').all()).error ?? '', /Unknown procedure/);
});

test('assert/retract state does not survive a restart, as documented', async () => {
  // format §8: a cell declaring :- dynamic is stateful, its state lives in no
  // file, and the answer is "restart engine and run all" rather than a pretence
  // that the state can be replayed.
  const session = await createSession();
  await session.consult(':- dynamic counter/1.\ncounter(0).', 'cell-dyn');
  await session.query('retract(counter(0)), assertz(counter(41))').all();
  assert.deepEqual((await session.query('counter(X)').all()).solutions.map((s) => s.X), [41]);

  await session.restart();

  assert.deepEqual((await session.query('counter(X)').all()).solutions.map((s) => s.X), [0]);
});

test('abort is restart, and leaves a usable session behind', async () => {
  const session = await createSession();
  await session.consult('p(1).', 'cell-p');
  await session.abort();
  assert.deepEqual((await session.query('p(X)').all()).solutions.map((s) => s.X), [1]);
});

// ------------------------------------------- one open sequence per session

test('a second query closes the first, rather than trapping it underneath', async () => {
  // THE BUG (869epzqpc): SWI keeps open queries on a STACK and swipl-wasm
  // enforces it — next() and close() both throw "Attempt to access not innermost
  // query" on anything else. A reader who walks half of one sequence and then
  // runs another cell had, until this, killed the first one with no way back and
  // no explanation. Nothing released the frame either: the worker forgot the id
  // and left the query open inside the engine for the life of the session.
  const session = await createSession();
  await session.consult('n(1). n(2). n(3).', 'cell-n');

  const first = session.query('n(X)');
  let told = 0;
  first.onSuperseded = () => { told++; };
  assert.equal((await first.next()).text, 'X = 1', 'one of three taken, frame open');

  const second = session.query('n(X)');
  assert.equal((await second.next()).text, 'X = 1');
  assert.equal(told, 1, 'the first sequence is told it was closed');

  // AND IT SAYS WHICH KIND OF ENDING IT WAS. `done` alone would let a caller
  // conclude the search was exhausted and write `false.` under it (format §6),
  // which is the one thing we may not forge.
  assert.deepEqual(await first.next(), { done: true, superseded: true });

  // The line that used to throw: the survivor is unharmed and still walks.
  assert.equal((await second.next()).text, 'X = 2');
  assert.equal((await second.next()).text, 'X = 3');
  assert.equal((await second.next()).done, true);
});

test('a sequence that finished holds nothing, so it is never closed for another', async () => {
  // swipl-wasm closes a query when its search ends, which is why a drained
  // sequence costs nothing and why `all` is always safe.
  const session = await createSession();
  await session.consult('n(1). n(2).', 'cell-n');

  const first = session.query('n(X)');
  first.onSuperseded = () => assert.fail('nothing was open to close');
  await first.all();

  const second = session.query('n(X)');
  assert.equal((await second.next()).text, 'X = 1');
});

test('closing a sequence by hand gives the frame back too', async () => {
  const session = await createSession();
  await session.consult('n(1). n(2). n(3).', 'cell-n');

  const first = session.query('n(X)');
  await first.next();
  await first.close();
  first.onSuperseded = () => assert.fail('it was already closed');

  const second = session.query('n(X)');
  assert.deepEqual((await second.all()).solutions.map((s) => s.X), [1, 2, 3]);
});
