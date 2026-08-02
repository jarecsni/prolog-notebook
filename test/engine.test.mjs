import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, formatSolution } from '../src/node.js';

const FAMILY = `
male(albert). male(edward). male(alfred). male(george).
female(victoria). female(alice).
father(albert, edward). father(albert, alfred). father(edward, george).
mother(victoria, edward). mother(victoria, alfred). mother(alexandra, george).
parent(X, Y) :- father(X, Y) ; mother(X, Y).
is_son(X) :- male(X), parent(_, X).
son_a(X) :- once(( male(X), parent(_, X) )).
son_b(X) :- male(X), once(parent(_, X)).
`;

const session = await createSession();
assert.equal(session.consult(FAMILY).ok, true, 'consult should succeed');

test('duplicate proofs surface as duplicate solutions', () => {
  const { solutions } = session.query('is_son(X)').all();
  assert.deepEqual(
    solutions.map((s) => s.X),
    ['edward', 'edward', 'alfred', 'alfred', 'george', 'george']
  );
});

test('the final solution is not lost when it arrives with done', () => {
  // The engine returns the last binding together with done:true; a naive stepper
  // drops it. george must appear twice, not once.
  const { solutions } = session.query('is_son(X)').all();
  assert.equal(solutions.filter((s) => s.X === 'george').length, 2);
});

test('once around a generator collapses it to one solution', () => {
  const { solutions } = session.query('son_a(X)').all();
  assert.equal(solutions.length, 1);
});

test('once around a test leaves the generator intact', () => {
  const { solutions } = session.query('son_b(X)').all();
  assert.deepEqual(solutions.map((s) => s.X), ['edward', 'alfred', 'george']);
});

test('a ground goal yields true rather than bindings', () => {
  const { solutions } = session.query('son_b(george)').all();
  assert.equal(solutions.length, 1);
  assert.equal(formatSolution(solutions[0]), 'true');
});

test('a failing goal yields no solutions', () => {
  const { solutions } = session.query('is_son(alice)').all();
  assert.equal(solutions.length, 0);
});

test('an unknown predicate reports an error rather than throwing', () => {
  const r = session.query('no_such_predicate(X)').all();
  assert.match(r.error ?? '', /Unknown procedure/);
});

test('stepping yields one solution at a time', () => {
  const q = session.query('son_b(X)');
  assert.equal(q.next().solution.X, 'edward');
  assert.equal(q.next().solution.X, 'alfred');
  const third = q.next();
  assert.equal(third.solution.X, 'george');
  assert.equal(third.done, true);
});
