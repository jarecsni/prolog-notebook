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
