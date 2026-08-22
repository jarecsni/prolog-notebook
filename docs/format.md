# The notebook source format

Status: **v0.2 spec, agreed.** Everything in v0.2 parses, renders and serialises exactly
this. Tickets [869ectryj], [869edpd0z], [869eddzfp], [869ectt0y], [869eddzgq].

A notebook is a **markdown file**. Markdown is the source of truth; HTML is build output;
`.ipynb` is neither — see the ticket for why, it is not being reopened.

Three properties drive every decision below, in this order:

1. **It reads on GitHub with no build step.** A reader who finds the repo gets the chapter,
   the Prolog, the saved answers and the collapsed prediction reveals.
2. **A GUI can edit its structure.** Insert, reorder, delete cells without a human typing
   syntax — and produce byte-identical output to what the human would have typed.
3. **The CLI runs it clean, top to bottom.** No execution counters, no out-of-order runs.

---

## 1. The file

- Extension: **`.prolog.md`** (`chapter-04-cut.prolog.md`). It buys both things that were in
  tension, which no single-part extension does:
  - **GitHub renders it.** The rendered view is dispatched by `github/markup` on the file
    ending in one of `.md`, `.markdown`, `.mdown`, `.mkdn` — nothing else, and Linguist's
    `linguist-language=` override cannot buy it (that affects only highlighting and language
    stats). A custom extension such as `.pnb` would show raw source. Checked in Linguist's
    `languages.yml`: `.pnb`/`.plnb`/`.prolnb` are unclaimed, `.nb` is **Wolfram Language**,
    and Linguist matches the longest registered suffix — for `x.prolog.md` that is `.md`,
    since `.prolog` is not a suffix of the name at all.
  - **Tools can claim it.** `*.prolog.md` is a glob a VS Code extension can register as the
    default editor, without hijacking every markdown file in the workspace. (A bare `.md`
    would need `priority: "option"` plus a per-project `workbench.editorAssociations` entry.)
- The name is a **convention, not a requirement**. A notebook is identified by its *content* —
  the front matter line `format: prolog-notebook/1` — and the parser never looks at the file
  name. Any tool needing to tell a notebook from a prose file reads the first three lines.
  Detection by content is strictly stronger than detection by name, and we need it anyway.
- Encoding UTF-8, line endings **LF**, one trailing newline. NUL (`U+0000`) is not permitted
  anywhere in a notebook; §7 uses it as a separator.
- **Cells begin at column 0.** Not indented, not inside a list, not inside a blockquote.
  This is a rule, not an accident: it lets the parser be a line scanner rather than a
  markdown AST walk, which is what makes byte round-trip cheap (§9).

## 2. Front matter

Optional. If present it is the first thing in the file, fenced by `---` lines. A deliberately
restricted subset of YAML — flat `key: value` pairs, values are plain strings, numbers or
`true`/`false`, no nesting, no lists, no anchors. Hand-parsed in ~30 lines; **no YAML
dependency**, because the parser must run in the browser, in Node and in a VS Code web
extension.

```markdown
---
format: prolog-notebook/1
kicker: Cut and control
rerun: manual
---
```

| key      | meaning                                                              |
| -------- | -------------------------------------------------------------------- |
| `format` | required. `prolog-notebook/1`. A newer major is refused, not guessed. |
| `kicker` | the `.kicker` line above the title, used when this notebook is built **alone**. No markdown spelling exists for it. |
| `rerun`  | notebook-wide default for query cells, `manual` (default) or `auto`.  |

Unknown keys are preserved verbatim and ignored.

**A notebook never states its own position.** No chapter number, no book, no ordering —
`kicker: Chapter 4 · Cut and control` was the original spelling here and it is wrong: which
chapter this is is the *binder's* opinion, not the notebook's, and the same notebook may sit
at a different position in another book. See [binding.md](binding.md).

So the kicker has two sources, and the file changes between them not at all:

- **Built alone** — this key, if present, and never a number.
- **Built as part of a book** — nothing in this file changes. The binder emits a *cover
  section* before the chapter, carrying the label it derived from the entry's position
  (`Chapter 4 · Cut and control`); the HTML emitter renders that cover as the `.kicker` line
  above the title, and a print emitter renders it as a page. See [binding.md §4](binding.md).

`--check` warns when a notebook's own `kicker` looks like it contains a chapter number. It is
a warning, not an error: a notebook that will only ever be read alone is entitled to say
whatever it likes above its title.

**There is no `title` key.** The title is the first `# H1` in the body — one source of truth,
and it means the GitHub view has a real heading rather than a heading hidden in metadata.
The generated page takes `<title>` and `<h1>` from it.

## 3. Cell syntax — one grammar, all kinds

Every cell is a fenced code block whose info string is:

```
<language> <kind> [key="value"]...
```

Three positional rules, forever:

- **token 1 is the highlight language.** It exists for GitHub, which uses the first word and
  ignores the rest of the info string. That single fact is what makes this whole format
  degrade well.
- **token 2 is the cell kind.**
- **the rest are attributes**, always `key="value"`, always double-quoted. Inside a value,
  `\"` and `\\` are the only escapes. No bare values, no single quotes, no spaces around `=`.

Cell kinds in v0.2: `program`, `query`, `output`. Reserved for later, so the grammar is
settled once: `trace` (v0.6), `exercise` and `check` (v0.7).

An unknown kind is **not** an error: the block is kept as prose, rendered as an ordinary code
block, and round-trips untouched. A v0.2 renderer opening a v0.4 notebook degrades instead of
refusing.

The canonical fence is exactly three backticks. Longer fences are accepted on read, and the
serialiser lengthens a fence only if the content itself contains a line of backticks.

### Cell ids

```
id="q-is-son"     [a-z0-9][a-z0-9-]*, ≤ 64 chars, unique in the file
```

Assigned on insert, **never derived from content** — the content is exactly what changes.
Prefixes like `p-`/`q-` are a human convention; no tool may infer a cell's kind from its id.

The charset is restrictive on purpose: the id becomes the virtual file name `cell-<id>.pl`
(§8), and **SWI expands `$var` in file names like a shell** — a path containing `$` resolves
to nothing and the consult fails with no error at all. Verified 2026-08-04. Excluding `$`,
`/` and `.` from the charset makes that failure unconstructable.

`id` is *optional in hand-written source and required in canonical form*. A parser tolerates
its absence and mints an in-memory id; the moment any tool writes the file back, real ids are
written in — the file self-heals to canonical form the way `gofmt` fixes spacing. Hand-write
a chapter without ids; run it once; the ids are there.

## 4. Program cells

**Inline is the form. The Prolog lives in the notebook.**

````markdown
```prolog program id="p-family"
male(albert).
father(albert, edward).
```
````

Decided 2026-08-05, reversing the earlier "cite, never paste" position, because most Prolog
in a teaching chapter is a **foil rather than a library**. `son_a` and `son_b` exist to be
instructively wrong; there is nothing to test in them and no world in which they belong in
`family-relations.pl`. A notebook that is one self-contained file is also a notebook you can
hand to someone. The prior art splits exactly here: notebooks (Jupyter, Livebook, Pluto) are
self-contained, while books *about* code (the Rust book via mdBook, Quarto with external
scripts) include by reference to stop drift — and pay for it with source you cannot read in
one place.

### `src=` — include by reference

Specified, not implemented in v0.2. The grammar is fixed now so adding it later is not a
format change:

````markdown
```prolog program id="p-db" src="family-relations.pl"
```
````

- With `src`, the body **must be empty**. A body plus a `src` is an error — never a merge,
  never a cache. There must be exactly one answer to "what does this cell contain".
- A v0.2 parser recognises `src` and reports *not implemented in this version* rather than
  ignoring it, so a future notebook fails loudly instead of consulting nothing.
- When it is built, paths resolve relative to the notebook file through an **injectable
  filesystem**, never Node's `fs` — the VS Code web extension has none. Absolute paths and
  `..` segments escaping the notebook's directory are refused; a notebook is untrusted input
  the moment you can open someone else's.

It earns its place for exactly one case: a shared, `.plt`-tested database used across several
chapters, where the notebook should cite the tested file rather than hold a copy that drifts.
Deferring it keeps one answer to "where does this cell's text come from", a question every
downstream feature asks — editing, reset-to-source, `input-hash`, staleness, the CLI runner.
It also defers the injectable filesystem, which is a standing architecture principle and
should be built the moment `src` is.

## 5. Query cells

````markdown
```prolog query id="q-is-son" rerun="manual"
is_son(X)
```
````

- Exactly **one goal** per cell. A trailing `.` is optional and is stripped; canonical form
  omits it, matching what a reader types at a toplevel prompt. Two goals in a cell is an
  error — the output block keys one solution sequence to one cell.
- A goal may span lines; the lines are joined with a space.
- `rerun="manual"` (default, or the front-matter default) marks the output stale and offers
  *Run again*. `rerun="auto"` re-runs when a dependency changes. A cell with an unanswered
  prediction attached is forced to manual whatever it declares — reactivity spoils
  prediction, and prediction is the teaching device. Details on [869eddzgq].

## 6. Output blocks

A query cell's saved answers, in the notebook file itself:

````markdown
```prolog query id="q-is-son"
is_son(X)
```

```text output for="q-is-son" input-hash="9ae1c4f0b73d2210"
X = edward ;
X = edward ;
X = george ;
false.
```
````

The language token is `text`; the two-token rule holds even where there is nothing to
highlight.

**In the notebook file, not a sidecar.** The diff noise is the point: a changed solution set
is a meaningful review event, and you want it in the diff when a rule change silently drops
an answer.

**Attachment is structural.** An output block belongs to the cell it *immediately follows*
(only blank lines between). In the cell model it is not a cell at all — it is a property of
the query cell (§9). That makes requirement 3 of [869edpd0z] unbreakable rather than merely
observed: reorder a query and the output moves because it is *part* of the query; delete the
query and the output cannot survive it. Orphaned outputs are silent and render a stale answer
attached to nothing, so they must be structurally impossible, not policed.

`for` is therefore redundant with position — and stays, because redundancy is the check that
catches a GUI bug, and it makes the block self-describing on the GitHub page. A `for` that
disagrees with the preceding cell is an error. An output block following no cell is an error.

### The solution sequence

The body is **SWI's own toplevel spelling**, which is what makes it readable on GitHub and
faithful to what the reader will see:

- each solution is terminated by a line ending in ` ;`
- the sequence ends with a line ending in `.` — `false.` (exhausted), `true.` (success, no
  bindings), or the last solution's bindings when the query ran deterministically
- an error ends the sequence with a line beginning `ERROR:`
- **or it does not end at all.** A sequence whose *last* line ends in ` ;`, with no final `.`
  line, was **never exhausted**:

  ````markdown
  ```text output for="q-nat" input-hash="4f1c0a8e2b7d6390"
  N = 0 ;
  N = s(0) ;
  N = s(s(0)) ;
  ```
  ````

  Every other ending is a claim that the search *finished*, and there has to be a spelling
  for the commonest thing a reader does: press Run, take three answers out of six, and stop.
  Without one, a downloaded half-run must either throw those three answers away or forge an
  exhaustion that never happened — and an author showing the first four of infinitely many
  `nat(N)` has no honest way to write them down at all. This needs no invention: it is the
  literal transcript of a toplevel somebody walked away from, which is exactly what SWI
  prints and then waits. The renderer ends it with *"more solutions may follow."*, never
  *"no more solutions."* — the two must not be confusable.
- an output block with **no lines at all** is an error. It claims a query has answers and
  then shows none; a query with nothing to show simply has no output block.

We store the **sequence, not a blob**, because `; next` must replay saved solutions one at a
time with no engine present ([869ectt0y]). That is the thing this project exists for, and it
survives on a cold page: the chapter is readable the instant it loads, and stays readable if
the 5.9 MB WASM never arrives at all. Pressing `; next` past the end of the saved sequence is
the natural moment to boot the engine.

## 7. `input-hash` — staleness before first paint

`input-hash` lets a page mark outputs stale on first paint, before the engine has loaded,
including for a notebook whose markdown was hand-edited without re-running.

Pinned exactly, because it is a file-format constant:

- **FNV-1a, 64-bit**, offset basis `0xcbf29ce484222325`, prime `0x100000001b3`, over the
  UTF-8 bytes of the digest string, rendered as 16 lowercase hex digits.
- Digest string = the canonical goal text, then for each program cell **preceding this query
  in document order**, its id and its source — every field followed by a NUL:

  ```
  <goal>\0 ( <cell-id>\0 <resolved-source>\0 )*
  ```

Not a security boundary and not trying to be: a notebook that lies about its outputs can lie
about the hash too. It is a change detector, so a fast dependency-free sync hash beats
SHA-256 via WebCrypto, which is async in the browser and would push staleness past first
paint for no benefit.

v0.2 uses *all preceding program cells*, not the dependency closure. It over-approximates —
editing an unrelated earlier cell marks a query stale. [869eddzgq] may narrow it to the
closure; when it does, every stored hash changes once and every output shows stale until
re-run. That is a one-time cost, worth accepting rather than pre-building a dependency graph
into the format.

## 8. Execution model and ordering

- **One cell, one virtual file**: program cell `id` consults as `/cell-<id>.pl`. SWI
  attributes clauses to their source file, so re-consulting replaces exactly that cell's
  clauses and leaves every other cell alone; dependents see the new clauses immediately with
  no re-consult; a renamed predicate leaves no ghost. Verified 2026-08-04, [869eddzfp].
- Consequence: the clause store **self-heals**. A dependency graph is never needed for
  correctness — only to know which *displayed outputs* are stale.
- **One predicate is defined by exactly one cell.** SWI enforces this destructively, so the
  alternative to the rule is not merging but silent data loss. Cross-cell redefinition is an
  error in the notebook UI naming both cells. `:- multifile` is the escape hatch.
- A cell declaring `:- dynamic` is **stateful**: assert/retract state lives in no file and no
  re-consult undoes it. Detected statically; the UI offers *restart engine and run all*. SWI
  refuses `assertz` against a static predicate, so hidden state is opt-in, never accidental.
- Deleting a cell must un-consult its file, or its clauses linger.

**Document order is execution order, and reordering is semantically meaningful, not
presentational.** The CLI runs top to bottom from clean, so order decides the narrative, and
which cell wins a redefinition. What is *not* exposed, ever, is out-of-order execution —
"run cell 7 before cell 3" is the original sin that makes notebooks irreproducible. Reorder
freely; run top to bottom always.

## 9. The cell model

Format-agnostic by contract: nothing in it may assume markdown, so an `.ipynb` importer, a
VS Code serializer or an HTML emitter is a small pure function over the model rather than a
second parser. DOM-free, like `src/engine.js`, so the CLI runner (v0.3) reuses it verbatim.

```js
{ kind: 'markdown',  source }                       // verbatim, never re-generated
{ kind: 'program',   id, source, src, attrs }       // src XOR source; src unused in v0.2
{ kind: 'query',     id, goal, rerun, attrs,
                     output: { solutions: [string], terminator, inputHash } | null }
{ kind: 'container', variant, title, body, attrs }  // §10
{ kind: 'unknown',   source }                       // future cell kinds, preserved
```

Every block carries the attributes it did not recognise, so nothing is lost on write-back.

## 10. Prose and containers

Everything that is not a cell is markdown prose, stored **verbatim** and handed to the
markdown renderer only at render time.

The visual vocabulary the stylesheet already targets needs a markdown spelling, or the once/1
chapter cannot be reproduced from a file. One container grammar covers all of them:

```markdown
> [!kind] Optional title
> …blockquoted markdown…
```

| marker       | class      | notes                                                        |
| ------------ | ---------- | ------------------------------------------------------------ |
| `[!predict]` | `.predict` | title → `h3`; renderer adds the reader's `textarea`; a `<details>` in the body is the reveal |
| `[!aside]`   | `.aside`   | first `**bold**` line is the lead-in                          |
| `[!margin]`  | `.note`    | the handwritten margin note                                   |
| `[!bullets]` | `.bullets` | title → `h2`, body is the closing list                        |

`[!margin]`, not `[!note]`, deliberately: GitHub owns `[!NOTE]` and renders it as its own
admonition. Ours is a rotated handwriting scrawl in the margin; colliding with GitHub's would
render it wrongly on the repo page. The CSS class stays `.note` — [869edyyvm] fixes the class
vocabulary, and this spec does not get to change it.

On GitHub an unknown marker degrades to a plain blockquote with a literal `[!predict]` label,
which reads as an admonition tag. The `<details>` reveal is native there, so **the prediction
device survives on the repo page** — the reader still gets the question, and still has to
click to see the answer.

The grammar allows attributes inside the brackets (`> [!predict id="pr-fence"] Title`) for
v0.7, when a prediction must bind to a query cell. v0.2 emits none, keeping the GitHub view
clean.

Unknown container kinds render as plain blockquotes and round-trip untouched.

### Where our renderer diverges from GitHub

The prose renderer is markdown-it: CommonMark, plus GFM tables, strikethrough and autolinks.
Two GFM extensions it does not carry, both of which fail silently on our side while working on
the repo page — so an author who uses one sees a chapter that renders two different ways:

- `- [ ] task` — renders as the literal text `[ ] task`, not a checkbox.
- `[^1]` — footnote references and definitions are left as literal text.

One plugin each, and neither is needed by any chapter yet, so both are deferred to
[869ejgybm]. Until it lands, do not use them.

Raw HTML in prose is a different matter and is **not** a divergence to be fixed: it is escaped
deliberately, so a notebook from a stranger cannot run script in the reader's page. Everything
markdown can express still works; `<kbd>`, `<sup>` and sized `<img>` do not.

## 11. Canonical serialisation

Stronger than round-trip. Round-trip says *do not corrupt what is there*; this says *agree on
what to write*, so a GUI insert and a hand-typed cell produce the same bytes and commits stop
alternating between two spellings of the same file.

1. **Prose is passed through byte for byte.** The serialiser is not a markdown printer. Only
   blocks the tool owns — cell fences, output blocks, container heads — have a canonical
   spelling. This is what makes byte-exact round-trip achievable rather than aspirational.
2. Fence: exactly three backticks, at column 0, lengthened only if the content forces it.
3. Info string: single spaces, `<language> <kind>`, then attributes in **fixed order** —
   `id` first, then the kind's own attributes in the order documented here (`src`;
   `rerun`; `for`, `input-hash`), then unrecognised attributes in the order they were read.
4. Attribute values always double-quoted, `\"`/`\\` escaped, no other escaping.
5. Exactly one blank line between an output block and the query cell above it; exactly one
   blank line between a cell and adjacent prose. Runs of blank lines *within* prose are the
   author's and are untouched.
6. Canonical query text has no trailing `.`; canonical ids are present on every program and
   query cell.
7. LF, one trailing newline, no trailing whitespace on lines the tool writes.

Test: parse → serialise is byte-identical for any conforming file, and inserting a cell
programmatically produces exactly the bytes documented above ([869ectt20]).

## 12. Not in v0.2 — recorded so it is not rediscovered

- **`src=` itself** (§4). Grammar fixed, behaviour deferred.
- **Mirroring `src` file contents into the fence body**, written back by the CLI so a `src`
  cell is not an empty block on GitHub — the `.pl` file stays the truth and the body is a
  generated copy, like an `output` block. Costs a second write-back path and a divergence
  check. Only worth revisiting once `src` exists at all.
- `src="file.pl#section"` — including part of a file, the way mdBook anchors do.
- `.ipynb` **import only**, if a real Jupyter Prolog notebook ever turns up. Never an output.
- Saving reader edits back to the source file from the browser. The reader's copy is a
  scratchpad; authoring round-trip is v0.5 (VS Code), where a file and a save gesture exist.

## 13. A complete example

````markdown
---
format: prolog-notebook/1
kicker: Cut and control
---

# Where does the fence go?

*You have a rule that answers correctly and says everything twice.*

```prolog program id="p-family"
male(albert).
male(edward).
father(albert, edward).
is_son(X) :- male(X), parent(_, X).
```

Ask for every son.

```prolog query id="q-is-son"
is_son(X)
```

```text output for="q-is-son" input-hash="9ae1c4f0b73d2210"
X = edward ;
X = edward ;
X = george ;
false.
```

> [!margin] edward, then edward again. Nobody has two fathers.

> [!aside] **So stop it after the first proof.**
> `once(Goal)` proves `Goal` and then throws away every alternative it found along
> the way.

> [!predict] Sharpen your pencil
> Write down how many answers you expect from each — then run them.
>
> <details><summary>Reveal the answer (run them first!)</summary>
>
> **A gives exactly one son. B gives three, each once.**
>
> </details>

> [!bullets] Bullet points
> - Prolog enumerates **proofs**, not answers.
> - Fencing a **test** is free. Fencing a **generator** destroys it.
````

[869ectryj]: https://app.clickup.com/t/869ectryj
[869edpd0z]: https://app.clickup.com/t/869edpd0z
[869eddzfp]: https://app.clickup.com/t/869eddzfp
[869ectt0y]: https://app.clickup.com/t/869ectt0y
[869eddzgq]: https://app.clickup.com/t/869eddzgq
[869edyyvm]: https://app.clickup.com/t/869edyyvm
[869ectt20]: https://app.clickup.com/t/869ectt20
[869ejgybm]: https://app.clickup.com/t/869ejgybm
