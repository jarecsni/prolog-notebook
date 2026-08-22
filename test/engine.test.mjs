import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, formatSolution, formatTerm, argumentsOf, readableInCell } from '../src/node.js';

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
assert.equal((await session.consult(FAMILY)).ok, true, 'consult should succeed');

test('duplicate proofs surface as duplicate solutions', async () => {
  const { solutions } = (await session.query('is_son(X)').all());
  assert.deepEqual(
    solutions.map((s) => s.X),
    ['edward', 'edward', 'alfred', 'alfred', 'george', 'george']
  );
});

test('the final solution is not lost when it arrives with done', async () => {
  // The engine returns the last binding together with done:true; a naive stepper
  // drops it. george must appear twice, not once.
  const { solutions } = (await session.query('is_son(X)').all());
  assert.equal(solutions.filter((s) => s.X === 'george').length, 2);
});

test('once around a generator collapses it to one solution', async () => {
  const { solutions } = (await session.query('son_a(X)').all());
  assert.equal(solutions.length, 1);
});

test('once around a test leaves the generator intact', async () => {
  const { solutions } = (await session.query('son_b(X)').all());
  assert.deepEqual(solutions.map((s) => s.X), ['edward', 'alfred', 'george']);
});

test('a ground goal yields true rather than bindings', async () => {
  const { solutions } = (await session.query('son_b(george)').all());
  assert.equal(solutions.length, 1);
  assert.equal(formatSolution(solutions[0]), 'true');
});

test('a failing goal yields no solutions', async () => {
  const { solutions } = (await session.query('is_son(alice)').all());
  assert.equal(solutions.length, 0);
});

test('an unknown predicate reports an error rather than throwing', async () => {
  const r = (await session.query('no_such_predicate(X)').all());
  assert.match(r.error ?? '', /Unknown procedure/);
});

test('an error does not mention our own WASM plumbing', async () => {
  // SWI raises this from the goal we wrapped for the WASM boundary, so it arrives
  // as "wasm:wasm_call_string/3: Unknown procedure: …". The reader did not write
  // that frame and cannot act on it.
  const r = (await session.query('no_such_predicate(X)').all());
  assert.equal(r.error, 'Unknown procedure: no_such_predicate/1');
});

test("but the frame that IS the reader's code survives", async () => {
  // Only our own wrapper is dropped. "//2" names the division that failed, which
  // is the whole value of the context.
  const r = (await session.query('X is 1/0').all());
  assert.match(r.error ?? '', /^\/\/2: Arithmetic/);
});

test('stepping yields one solution at a time', async () => {
  const q = (await session.query('son_b(X)'));
  assert.equal((await q.next()).solution.X, 'edward');
  assert.equal((await q.next()).solution.X, 'alfred');
  const third = (await q.next());
  assert.equal(third.solution.X, 'george');
  assert.equal(third.done, true);
});

// --- rendering -------------------------------------------------------------
// Every one of these printed as `foo()` in 0.1.0 and 0.1.1: the arguments of a
// compound arrive under the key named by the functor, not under `args`, so they
// were silently dropped. The chapter never noticed because it only ever binds
// atoms.

test('compound terms keep their arguments', async () => {
  assert.equal((await session.query('X = foo(1,2)').next()).text, 'X = foo(1,2)');
  assert.equal((await session.query('X = point(1,2,3)').next()).text, 'X = point(1,2,3)');
  assert.equal((await session.query('X = f(g(h))').next()).text, 'X = f(g(h))');
});

test('operators print as operators, not as functors', async () => {
  assert.equal((await session.query('X = a-b').next()).text, 'X = a-b');
  assert.equal((await session.query('X = 1+2').next()).text, 'X = 1+2');
  assert.equal((await session.query('X = [a-1,b-2]').next()).text, 'X = [a-1,b-2]');
});

test('atoms needing quotes get them, strings stay strings', async () => {
  assert.equal((await session.query("X = 'hello world'").next()).text, "X = 'hello world'");
  assert.equal((await session.query('X = "str"').next()).text, 'X = "str"');
});

test('a single argument that is itself a list is not mistaken for two', async () => {
  // The engine wraps a compound's argument list in one extra array, so the
  // unwrapping has to distinguish f([1,2]) from f(1,2).
  assert.equal((await session.query('X = f([1,2])').next()).text, 'X = f([1,2])');
  assert.equal((await session.query('X = f([1,2],[3])').next()).text, 'X = f([1,2],[3])');
});

test('the engine-free renderer keeps arguments too, in functional notation', async () => {
  const term = (await session.query('X = a-b').next()).solution.X;
  assert.deepEqual(argumentsOf(term), ['a', 'b']);
  assert.equal(formatTerm(term), '-(a, b)');
  assert.equal(formatTerm((await session.query('X = f(g(h))').next()).solution.X), 'f(g(h))');
});

// --- consult ---------------------------------------------------------------

test('one cell per virtual file: re-consulting replaces only that cell', async () => {
  const s = session;
  assert.equal((await s.consult('p(1).\np(2).', 'ra')).ok, true);
  assert.equal((await s.consult('q(X) :- p(X).', 'rb')).ok, true);
  assert.deepEqual((await s.query('q(X)').all()).solutions.map((x) => x.X), [1, 2]);

  // Editing one cell must not disturb the cell that depends on it.
  assert.equal((await s.consult('p(3).', 'ra')).ok, true);
  assert.deepEqual((await s.query('q(X)').all()).solutions.map((x) => x.X), [3]);
});

test('renaming a predicate leaves no ghost behind', async () => {
  const s = session;
  (await s.consult('old_name(1).', 'gh'));
  assert.equal((await s.query('old_name(X)').all()).solutions.length, 1);
  (await s.consult('new_name(9).', 'gh'));
  assert.match((await s.query('old_name(X)').all()).error ?? '', /Unknown procedure/);
});

test("a cell that redefines another cell's predicate says so", async () => {
  const s = session;
  assert.deepEqual((await s.consult('shared(1).', 'wa')).messages, []);
  const r = (await s.consult('shared(2).', 'wb'));
  assert.equal(r.ok, true);
  assert.match(r.messages[0]?.text ?? '', /Redefined static procedure shared\/1/);
  assert.match(r.messages[0]?.text ?? '', /wa\.pl/);
});

test('a syntax error is a failed consult, not a successful one', async () => {
  // SWI reports the bad clause, skips it and carries on, so consult/1 itself
  // succeeds. Reporting that as "✓ consulted" leaves the reader with a cell
  // that looks loaded and a predicate that is not there.
  const r = (await session.consult('broken(', 'syn'));
  assert.equal(r.ok, false);
  assert.match(r.error ?? '', /Syntax error/);
});

test('a clean consult reports nothing', async () => {
  const r = (await session.consult('tidy(1).', 'tidy'));
  assert.equal(r.ok, true);
  assert.deepEqual(r.messages, []);
});

test('a cell name already ending in .pl is not doubled', async () => {
  (await session.consult('named(1).', 'chapter.pl'));
  assert.equal((await session.query('source_file(named(_), F)').next()).text, "F = '/chapter.pl'");
});

// --- an error about this cell, said the way the cell would say it ---

test('a syntax error loses the path and keeps the position', () => {
  // One cell is one virtual file, so SWI's line numbers are already the cell's
  // own — that half solved itself. What is left is a filename the reader never
  // chose and cannot open, printed on the very cell that caused the error.
  assert.equal(
    readableInCell('/p-family.pl:4:6: Syntax error: Operator expected', 'p-family'),
    'line 4, column 6: Syntax error: Operator expected',
  );
  assert.equal(
    readableInCell('/p-family.pl:9: Clauses of male/1 are not together', 'p-family'),
    'line 9: Clauses of male/1 are not together',
  );
});

test('a message about ANOTHER cell keeps the name of that cell', () => {
  // "Redefined static procedure male/1 in /p-family.pl" is only useful because
  // it names the other file — that is how a reader finds the cell whose clauses
  // have just been destroyed. A regex that stripped any path would delete
  // exactly the part worth reading.
  const warning = 'Redefined static procedure male/1 in /p-family.pl';
  assert.equal(readableInCell(warning, 'p-fixes'), warning);
  const elsewhere = '/p-family.pl:4:6: Syntax error: Operator expected';
  assert.equal(readableInCell(elsewhere, 'p-fixes'), elsewhere);
});

test('the wasm frame is still stripped underneath', () => {
  assert.equal(
    readableInCell('wasm:wasm_call_string/3: Unknown procedure: is_son/1', 'p-family'),
    'Unknown procedure: is_son/1',
  );
});
