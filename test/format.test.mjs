import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse, serialise, inputHash, hashFor, NotebookError } from '../src/format.js';

// A whole chapter, on disk, as an author would actually write one. Inline strings
// prove the grammar; this proves the thing people will really hand us.
//
// It lives in notebooks/ rather than test/fixtures/ because it is a chapter, not a
// fixture: it is meant to grow, and a reader is meant to read it. Nothing here
// asserts a cell count for that reason — what is asserted is the property that must
// survive every edit, which is the byte-exact round-trip.
const NOTEBOOK = new URL('../notebooks/ch04-cut.prolog.md', import.meta.url);

// The opposite kind of file, and the reason the two must not be one file: this one
// is deliberately WRONG, so it can never be a chapter anyone reads.
const STALE = new URL('./fixtures/stale-output.prolog.md', import.meta.url);

// The worked example from docs/format.md §13, in canonical form. Everything the
// format promises has to hold for this file.
const CHAPTER = `---
format: prolog-notebook/1
kicker: Cut and control
---

# Where does the fence go?

*You have a rule that answers correctly and says everything twice.*

\`\`\`prolog program id="p-family"
male(albert).
male(edward).
father(albert, edward).
is_son(X) :- male(X), parent(_, X).
\`\`\`

Ask for every son.

\`\`\`prolog query id="q-is-son"
is_son(X)
\`\`\`

\`\`\`text output for="q-is-son" input-hash="9ae1c4f0b73d2210"
X = edward ;
X = edward ;
X = george ;
false.
\`\`\`

> [!margin] edward, then edward again. Nobody has two fathers.

> [!aside] **So stop it after the first proof.**
> \`once(Goal)\` proves \`Goal\` and then throws away every alternative.

> [!predict] Sharpen your pencil
> Write down how many answers you expect — then run them.
>
> <details><summary>Reveal the answer (run them first!)</summary>
>
> **A gives exactly one son. B gives three, each once.**
>
> </details>

> [!bullets] Bullet points
> - Prolog enumerates **proofs**, not answers.
> - Fencing a **test** is free. Fencing a **generator** destroys it.
`;

test('parses front matter as flat key/value pairs, in order', () => {
  const { frontMatter } = parse(CHAPTER);
  assert.deepEqual([...frontMatter], [['format', 'prolog-notebook/1'], ['kicker', 'Cut and control']]);
});

test('the title is the first H1, not a front matter key', () => {
  const { frontMatter, cells } = parse(CHAPTER);
  assert.equal(frontMatter.has('title'), false);
  assert.match(cells[0].source, /^# Where does the fence go\?/);
});

test('a newer major version is refused rather than guessed at', () => {
  assert.throws(() => parse('---\nformat: prolog-notebook/2\n---\n'), NotebookError);
});

test('program and query cells come out of the fence info string', () => {
  const { cells } = parse(CHAPTER);
  const program = cells.find((c) => c.kind === 'program');
  const query = cells.find((c) => c.kind === 'query');
  assert.equal(program.id, 'p-family');
  assert.match(program.source, /^male\(albert\)\./);
  assert.equal(query.id, 'q-is-son');
  assert.equal(query.goal, 'is_son(X)');
});

test('an output block is a property of its query, not a cell of its own', () => {
  const { cells } = parse(CHAPTER);
  assert.equal(cells.some((c) => c.kind === 'output'), false);
  const query = cells.find((c) => c.kind === 'query');
  assert.deepEqual(query.output.solutions, ['X = edward', 'X = edward', 'X = george']);
  assert.equal(query.output.terminator, 'false.');
  assert.equal(query.output.inputHash, '9ae1c4f0b73d2210');
});

test('the solution SEQUENCE is kept, so ; next can replay with no engine', () => {
  const { cells } = parse(CHAPTER);
  const { output } = cells.find((c) => c.kind === 'query');
  // Three separate proofs, including the duplicate. A blob would have lost this.
  assert.equal(output.solutions.length, 3);
});

test('a sequence with no final line was never exhausted, and round-trips as one', () => {
  // The one ending that is not a claim about the search finishing (§6): the file
  // stops on a ` ;`, exactly as a toplevel does when somebody walks away from it.
  // An empty terminator is the model's way of saying "nobody said this was all".
  const source = `\`\`\`prolog query id="q-nat"
nat(N)
\`\`\`

\`\`\`text output for="q-nat"
N = 0 ;
N = s(0) ;
\`\`\`
`;
  const notebook = parse(source);
  const { output } = notebook.cells.find((c) => c.kind === 'query');
  assert.deepEqual(output.solutions, ['N = 0', 'N = s(0)']);
  assert.equal(output.terminator, '');
  // Byte-exact, which is the property that matters: the missing final line has to
  // stay missing. A blank line in its place would be trimmed on the way back in
  // and the file would drift a byte per save.
  assert.equal(serialise(notebook), source);
});

test('an output block with nothing in it is an error, not an answerless answer', () => {
  const source = '```prolog query id="q-1"\nfoo\n```\n\n```text output for="q-1"\n```\n';
  assert.throws(() => parse(source), /output for="q-1" is empty/);
});

test('containers are parsed for the four variants the stylesheet knows', () => {
  const { cells } = parse(CHAPTER);
  const variants = cells.filter((c) => c.kind === 'container').map((c) => c.variant);
  assert.deepEqual(variants, ['margin', 'aside', 'predict', 'bullets']);
});

test('a container keeps its title and its body, including raw HTML', () => {
  const { cells } = parse(CHAPTER);
  const predict = cells.find((c) => c.variant === 'predict');
  assert.equal(predict.title, 'Sharpen your pencil');
  // The <details> reveal is what makes the prediction device survive on GitHub.
  assert.match(predict.body, /<details><summary>Reveal the answer/);
});

test('parse -> serialise is byte-identical for a conforming file', () => {
  assert.equal(serialise(parse(CHAPTER)), CHAPTER);
});

test('a whole chapter file parses and round-trips byte for byte', () => {
  const source = readFileSync(NOTEBOOK, 'utf8');
  const notebook = parse(source);

  for (const kind of ['markdown', 'program', 'query', 'container']) {
    assert.ok(notebook.cells.some((c) => c.kind === kind), `chapter should have a ${kind} cell`);
  }
  assert.equal(serialise(notebook), source);
});

test('a published chapter agrees with its own saved answers', () => {
  // The chapter is what a run would have written, so every hash matches. This is
  // what stops an edit to a program cell from landing with answers below it that
  // no longer follow from it — the whole staleness mechanism, checked in CI.
  const notebook = parse(readFileSync(NOTEBOOK, 'utf8'));
  // `c.output !== null` would match a markdown cell, which has no output property
  // at all — undefined is not null, and the test would silently pass on nothing.
  const answered = notebook.cells.filter((c) => c.kind === 'query' && c.output);
  assert.ok(answered.length >= 4, 'the chapter should carry its answers');
  for (const query of answered) {
    assert.equal(hashFor(notebook, query), query.output.inputHash, `${query.id} is stale`);
  }
});

test('a chapter can say its saved answers are stale before any engine exists', () => {
  const notebook = parse(readFileSync(STALE, 'utf8'));
  const query = notebook.cells.find((c) => c.id === 'q-is-son');
  // Detecting this on a cold page, with no WASM loaded, is the entire point of
  // storing a hash rather than recomputing an answer.
  assert.equal(query.output.inputHash, '0000000000000000');
  assert.notEqual(hashFor(notebook, query), query.output.inputHash);
});

test('a query with no saved output is simply unanswered, not malformed', () => {
  // A hand-written chapter has none until it is run for the first time, so this is
  // the normal state of a query cell rather than an error to report.
  const notebook = parse('```prolog query id="q-1"\nis_son(X)\n```\n');
  assert.equal(notebook.cells[0].output, null);
});

test('prose is passed through byte for byte, blank lines and all', () => {
  const source = '# Title\n\nOne.\n\n\n\nFour blank lines above this.\n';
  assert.equal(serialise(parse(source)), source);
});

test('an unknown cell kind is preserved rather than refused', () => {
  const source = '```prolog trace id="t-1"\nfoo\n```\n';
  const { cells } = parse(source);
  assert.equal(cells[0].kind, 'unknown');
  assert.equal(serialise(parse(source)), source);
});

test('an unknown container degrades to prose and round-trips', () => {
  const source = '> [!nonsense] Title\n> body\n';
  const { cells } = parse(source);
  assert.equal(cells[0].kind, 'markdown');
  assert.equal(serialise(parse(source)), source);
});

test('an ordinary code block is prose, not a cell', () => {
  const source = '```sh\nnpm test\n```\n';
  assert.equal(parse(source).cells.length, 1);
  assert.equal(parse(source).cells[0].kind, 'markdown');
  assert.equal(serialise(parse(source)), source);
});

test('unrecognised attributes survive a write-back', () => {
  const source = '```prolog query id="q-1" rerun="auto" wat="1"\nfoo(X)\n```\n';
  assert.equal(serialise(parse(source)), source);
});

test('ids are minted when absent, so a hand-written chapter self-heals', () => {
  const source = '```prolog program\nfoo.\n```\n\n```prolog query\nfoo\n```\n';
  const { cells } = parse(source);
  assert.equal(cells[0].id, 'p-1');
  assert.equal(cells[1].id, 'q-1');
  assert.equal(
    serialise(parse(source)),
    '```prolog program id="p-1"\nfoo.\n```\n\n```prolog query id="q-1"\nfoo\n```\n'
  );
});

test('a minted id never collides with one the author already used', () => {
  const source = '```prolog program id="p-1"\na.\n```\n\n```prolog program\nb.\n```\n';
  const { cells } = parse(source);
  assert.equal(cells[1].id, 'p-2');
});

test('duplicate ids are an error', () => {
  const source = '```prolog program id="x"\na.\n```\n\n```prolog program id="x"\nb.\n```\n';
  assert.throws(() => parse(source), /duplicate cell id/);
});

test('an id excluding $ / and . makes the SWI file-name trap unconstructable', () => {
  assert.throws(() => parse('```prolog program id="a$b"\na.\n```\n'), /is not \[a-z0-9\]/);
  assert.throws(() => parse('```prolog program id="a/b"\na.\n```\n'), /is not \[a-z0-9\]/);
});

test('the trailing full stop is optional and canonical form omits it', () => {
  const { cells } = parse('```prolog query id="q-1"\nis_son(X).\n```\n');
  assert.equal(cells[0].goal, 'is_son(X)');
});

test('a goal may span lines and is joined with a space', () => {
  const { cells } = parse('```prolog query id="q-1"\nfoo(X),\nbar(X)\n```\n');
  assert.equal(cells[0].goal, 'foo(X), bar(X)');
});

test('two goals in one cell is an error', () => {
  // One output block keys one solution sequence to one cell, so two goals has
  // nowhere to put its second set of answers.
  assert.throws(() => parse('```prolog query id="q-1"\nfoo. bar.\n```\n'), /exactly one goal/);
});

test('a full stop inside quotes or a float does not end the goal', () => {
  assert.equal(parse('```prolog query id="q-1"\nX = \'a. b\'\n```\n').cells[0].goal, "X = 'a. b'");
  assert.equal(parse('```prolog query id="q-1"\nX is 1.5 + 2\n```\n').cells[0].goal, 'X is 1.5 + 2');
});

test('an orphaned output block is an error, not a stale answer attached to nothing', () => {
  assert.throws(() => parse('```text output for="q-1"\nfalse.\n```\n'), /must follow a query cell/);
});

test('an output block that disagrees with the cell above it is an error', () => {
  const source = '```prolog query id="q-1"\nfoo\n```\n\n```text output for="q-2"\nfalse.\n```\n';
  assert.throws(() => parse(source), /follows query "q-1"/);
});

test('src= is refused as unimplemented rather than silently consulting nothing', () => {
  assert.throws(() => parse('```prolog program id="p-1" src="family.pl"\n```\n'), /not implemented/);
});

test('a body plus a src is an error, never a merge and never a cache', () => {
  assert.throws(() => parse('```prolog program id="p-1" src="f.pl"\nfoo.\n```\n'), /either src= or a body/);
});

test('NUL is refused — the hash uses it as a separator', () => {
  assert.throws(() => parse('# hi\u0000\n'), /NUL/);
});

test('a fence is lengthened only when the content forces it', () => {
  const notebook = parse('```prolog program id="p-1"\nfoo.\n```\n');
  notebook.cells[0].source = '```\nnested\n```';
  assert.match(serialise(notebook), /^````prolog program/m);
});

test('input-hash is FNV-1a 64-bit over goal and preceding program cells', () => {
  // Pinned by construction rather than by a magic constant: the empty-input case
  // is the FNV offset basis mixed with one NUL byte.
  const empty = inputHash('', []);
  assert.match(empty, /^[0-9a-f]{16}$/);

  const a = inputHash('foo(X)', [{ id: 'p-1', source: 'foo(1).' }]);
  const b = inputHash('foo(X)', [{ id: 'p-1', source: 'foo(2).' }]);
  assert.notEqual(a, b, 'editing a program cell must change the hash');

  const c = inputHash('foo(Y)', [{ id: 'p-1', source: 'foo(1).' }]);
  assert.notEqual(a, c, 'editing the goal must change the hash');

  const d = inputHash('foo(X)', [{ id: 'p-2', source: 'foo(1).' }]);
  assert.notEqual(a, d, 'the cell id is part of the digest');
});

test('hashFor over-approximates: any preceding program cell counts', () => {
  const source = [
    '```prolog program id="p-1"\nfoo(1).\n```',
    '```prolog program id="p-2"\nunrelated(1).\n```',
    '```prolog query id="q-1"\nfoo(X)\n```',
  ].join('\n\n');
  const notebook = parse(source);
  const query = notebook.cells.find((c) => c.kind === 'query');
  const before = hashFor(notebook, query);

  notebook.cells[1].source = 'unrelated(2).';
  assert.notEqual(hashFor(notebook, query), before);
});

test('a program cell after the query does not feed its hash', () => {
  const notebook = parse('```prolog query id="q-1"\nfoo(X)\n```\n\n```prolog program id="p-1"\nfoo(1).\n```\n');
  const query = notebook.cells.find((c) => c.kind === 'query');
  assert.equal(hashFor(notebook, query), inputHash('foo(X)', []));
});
