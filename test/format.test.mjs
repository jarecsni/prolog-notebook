import test from 'node:test';
import assert from 'node:assert/strict';
import { parse, serialise, inputHash, hashFor, NotebookError } from '../src/format.js';

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
