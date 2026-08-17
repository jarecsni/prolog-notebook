import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { definedPredicates, unknownProcedure } from '../src/clauses.js';
import { parse } from '../src/format.js';

// This reading exists to answer one question: "the predicate you called is
// defined further down — did you mean to run that cell first?". So the tests
// care about what a chapter actually contains, and about never claiming a
// definition that is not there.

test('facts and rules both count, with their arity', () => {
  const found = definedPredicates(`
male(albert).
male(edward).
parent(X, Y) :- father(X, Y) ; mother(X, Y).
happy.
`);
  assert.deepEqual([...found].sort(), ['happy/0', 'male/1', 'parent/2']);
});

test('arity counts arguments, not commas', () => {
  // Every one of these is arity 2, and a naive comma count gets three of them wrong.
  const found = definedPredicates(`
a(f(1, 2), b).
b([1, 2, 3], x).
c('a, b', y).
d({x, y}, z).
`);
  assert.deepEqual([...found].sort(), ['a/2', 'b/2', 'c/2', 'd/2']);
});

test('a DCG rule defines the predicate SWI actually creates', () => {
  // greeting//0 is greeting/2 once the difference list is threaded through it.
  // Reporting greeting/0 would send a reader looking for something that is not there.
  assert.deepEqual([...definedPredicates('greeting --> [hello].')], ['greeting/2']);
  assert.deepEqual([...definedPredicates('digits(D) --> [D].')], ['digits/3']);
});

test('comments and directives define nothing', () => {
  const found = definedPredicates(`
% male(fake).
/* female(fake).
   father(fake, one). */
:- dynamic counter/1.
:- initialization(main).
counter(0).
`);
  // counter/1, not counter/0: `:- dynamic counter/1.` declares it, and the fact
  // below is what defines it. The directive itself contributes nothing.
  assert.deepEqual([...found], ['counter/1']);
});

test('a clause body does not define what it calls', () => {
  // Continuation lines are indented, which is the whole rule this relies on.
  const found = definedPredicates(`
is_son(X) :-
    male(X),
    parent(_, X).
`);
  assert.deepEqual([...found], ['is_son/1']);
});

test('a quoted functor keeps its name', () => {
  assert.deepEqual([...definedPredicates("'my pred'(a).")], ['my pred/1']);
});

test('an unterminated head is skipped rather than guessed at', () => {
  assert.deepEqual([...definedPredicates('broken(a, b\n')], []);
});

test('the chapter defines what the chapter says it defines', () => {
  const notebook = parse(readFileSync(new URL('../notebooks/ch04-cut.prolog.md', import.meta.url), 'utf8'));
  const all = new Set();
  for (const cell of notebook.cells) {
    if (cell.kind === 'program') for (const p of definedPredicates(cell.source)) all.add(p);
  }
  for (const expected of ['male/1', 'father/2', 'mother/2', 'parent/2', 'is_son/1', 'son_a/1', 'son_b/1']) {
    assert.ok(all.has(expected), `chapter should define ${expected}`);
  }
});

test('the predicate an unknown-procedure error names is recoverable', () => {
  // The engine's own wording, verified against SWI rather than assumed.
  assert.equal(unknownProcedure('wasm:wasm_call_string/3: Unknown procedure: is_son/1'), 'is_son/1');
  assert.equal(unknownProcedure('Unknown procedure: son_a/1'), 'son_a/1');
  assert.equal(unknownProcedure('Arithmetic: evaluation error'), null);
});
