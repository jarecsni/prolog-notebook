# Writing a chapter — the author's handbook

For somebody writing a `.prolog.md` and publishing it. The [format spec](format.md) is the
authority on what the file may contain; this is how you actually work.

Two rules underneath everything here, and most of the rest follows from them:

- **The markdown file is the truth.** Not a build artefact, not a database row. Everything —
  prose, Prolog, the saved answers — is in one file you can read, diff, review and hand to
  somebody.
- **The chapter is readable with no engine.** A reader gets the whole chapter, answers
  included, before 6.2 MB of WebAssembly arrives — and still gets it if that never arrives at
  all. Every decision below protects this.

---

## 1. The loop

```sh
npm i -g prolog-notebook
```

| | |
| --- | --- |
| `prolog-notebook execute <file>` | run every query and write the answers into the file |
| `prolog-notebook view <file>` | read it in a browser, cells live |
| `prolog-notebook clear <file>` | take the answers back out |
| `prolog-notebook build <file>` | write a static directory you can host or send |

Write prose and cells in your editor → `execute` to fill in the answers → `view` to read it as
a reader will → `build` when it is ready. `clear` is there when you want the chapter back
without its answers.

**Leave `view` running while you write.** Every reload serves the file as it is at that
moment, so editing and refreshing is the loop — no restart, and nothing to remember. If the
chapter stops parsing you keep the last version that did, with the parser's message across the
top of it, and fixing the file puts it back.

You never hand-write an answer. See §5.

## 2. Your first chapter

A complete file. No ids, no output blocks, no configuration:

````markdown
---
format: prolog-notebook/1
---

# Splitting a list

`append/3` is usually introduced as the predicate that joins two lists. That is the
least interesting thing it does.

```prolog program
greeting([hello, there, world]).
```

Run it forwards and it joins:

```prolog query
append([hello], [there, world], L)
```

Run it backwards and the same predicate takes a list apart — every way it can be
split, one solution at a time.

```prolog query
greeting(G), append(Front, Back, G)
```
````

Then:

```sh
$ prolog-notebook execute greeting.prolog.md
  ✓ p-1
  ✓ q-1 — 1 solution
  ✓ q-2 — 4 solutions
greeting.prolog.md: written
```

Your file now has ids and answers in it:

````markdown
```prolog query id="q-2"
greeting(G), append(Front, Back, G)
```

```text output for="q-2" input-hash="07fb11d29432f154"
G = [hello, there, world],  Front = [],  Back = [hello, there, world] ;
G = [hello, there, world],  Front = [hello],  Back = [there, world] ;
G = [hello, there, world],  Front = [hello, there],  Back = [world] ;
G = [hello, there, world],  Front = [hello, there, world],  Back = [].
```
````

That is SWI's own spelling, produced by SWI, inside Prolog, in one call per answer — which is
why shared variables come out as a reader would get them at a prompt rather than as
`_20306` and `_20428`.

```sh
$ prolog-notebook view greeting.prolog.md
greeting.prolog.md is at http://127.0.0.1:8777/ — Ctrl-C to stop.
```

The ids were minted for you and written in. **Hand-write a chapter without ids; run it once;
the ids are there** — the file self-heals to canonical form the way `gofmt` fixes spacing.
After that they are stable, and you can refer to them.

## 3. The file

### Front matter

Optional, and small on purpose — a flat `key: value` subset of YAML, hand-parsed, no
dependency.

```yaml
---
format: prolog-notebook/1     # required
kicker: Cut and control       # the line above the title, when built alone
rerun: manual                 # notebook-wide default for query cells
---
```

**There is no `title` key.** The title is the first `# H1` in the body, so the GitHub view has
a real heading and there is one source of truth.

**A notebook never states its own position.** No chapter number, no book, no ordering — which
chapter this is is the binder's opinion, not the file's, and the same chapter may sit
somewhere else in another book. See [binding.md](binding.md).

### Cells

Every cell is a fenced block whose info string is `<language> <kind> [key="value"]...`:

````markdown
```prolog program id="p-family"
male(albert).
```
````

The first token is the highlight language and exists **for GitHub**, which uses the first word
and ignores the rest. That one fact is what makes the whole format degrade well: your chapter
reads on the repo page — prose as prose, Prolog highlighted, answers in place — with no build
step and no site.

Attributes are always `key="value"`, always double-quoted. A block whose kind you don't
recognise is kept as prose and round-trips untouched, so a newer chapter opened by an older
tool degrades instead of refusing.

## 4. Program cells

```prolog program id="p-family"
male(albert).
father(albert, edward).
parent(X, Y) :- father(X, Y).
```

**The Prolog lives in the notebook.** Most Prolog in a teaching chapter is a *foil rather than
a library* — a rule that exists to be instructively wrong belongs in the chapter that
discusses it, not in a file somewhere else. (`src="file.pl"` is specified for the one case
that earns it, a shared `.plt`-tested database, and is not implemented yet.)

Four things worth knowing before you write the third cell:

- **One cell is one virtual file.** Cell `p-family` consults as `/p-family.pl`, so
  re-consulting it replaces exactly that cell's clauses and leaves every other cell alone. The
  clause store self-heals; you never need a dependency graph.
- **One predicate is defined by exactly one cell.** SWI enforces this destructively, so
  splitting `son/1` across two cells is not a merge — it is silent data loss. Use
  `:- multifile` if you really mean it.
- **Document order is execution order.** A query runs against the program cells *above* it.
  Reorder freely; it always runs top to bottom, and out-of-order execution — the original sin
  that makes notebooks irreproducible — is not offered.
- **A cell declaring `:- dynamic` is stateful.** Assert/retract state lives in no file, so
  neither re-consulting nor reset undoes it. Only restarting the engine does, and the page
  says so where it matters.

## 5. Query cells

```prolog query id="q-is-son" hold="until-run" rerun="auto"
is_son(X)
```

**Exactly one goal per cell**; the trailing `.` is optional and canonical form drops it. A goal
may span lines.

### `hold` — withhold the answers from a reader who has not earned them

| value | the wait ends when |
| --- | --- |
| `until-run` | the reader runs the cell |
| `until-answered` | the reader writes something in the nearest prediction above it |

Without it, prose saying *press Run and then `; next` to walk through the rest* is arguing
with a page that has already printed all six answers, and the reader loses either the exercise
or their trust in your instructions.

This is your call, per cell, in the file — never inferred from position, because a rule that
is invisible in the source breaks when you reorder prose and cannot be turned off.

It withholds from the **rendering**, never from the content: the answers are in the file, and
print, EPUB and the GitHub view show them. A book cannot withhold anything, and a reader on the
repo page has no Run button to press. Nor is it a lock — the held line says what it is waiting
for and carries a *show* control, because withholding an answer from someone who has decided
they want it is theatre rather than teaching.

### `rerun` — who decides when these answers are refreshed

| value | when the program above changes |
| --- | --- |
| `manual` | default. The answers are **marked** stale; the reader presses Run |
| `auto` | the cell re-runs itself, and says in its first line that nobody pressed anything |

`manual` is the default because prediction is the teaching device and reactivity spoils it.
Reach for `auto` in the demonstration case — reorder the goals in a rule and watch the solution
set change — where making the reader press Run in every cell below adds friction exactly where
the loop should be tight.

An auto cell re-runs on a **consult**, never on a keystroke, and never on page load: a reader
arriving at your chapter must not have 5.9 MB pulled down on their behalf.

### Predictions

A `<details>` block in your prose is a prediction box. Pair it with `hold="until-answered"` on
the query below it and the reader has to commit before the chapter answers.

## 6. Answers

**Never hand-write an output block.** A hand-written one is your *guess* at what SWI prints,
published as though it ran — and it will be subtly wrong about spacing, about quoting, and
about shared variables, in a chapter whose whole purpose is to show a reader what they will
see. Write the chapter with no output blocks and let `execute` fill them in.

```sh
prolog-notebook execute chapter.prolog.md
```

It consults every program cell, runs every query below it, writes the solution sequences back
along with an `input-hash` for each, and running it again on an unchanged chapter changes
nothing.

Two things it will not do:

- A query stopped at `--limit` (default 100) is written **without a terminator** — the format's
  way of saying the search was never exhausted. `false.` there would be a forgery.
- If a program cell fails to load, **nothing is written at all**. Every answer below it would
  have been produced against a chapter that does not exist.

### Staleness, and what `input-hash` buys you

Each output carries a hash of the goal and every program cell above it. So a reader opening
your chapter sees an answer marked stale **before the engine has loaded** — including when you
edited the markdown by hand and forgot to re-run.

The failure this prevents is specific: a reader who sees a program above answers that no longer
follow from it does not conclude that the tool is confused. They conclude something false about
**Prolog**. That is the one failure this project may not have — which is also why the tool
never rehashes your answers against somebody else's program.

Practically: **if you edit a program cell, re-run `execute`.** The chapter will tell on you if
you don't.

### Taking the answers back out

```sh
$ prolog-notebook clear chapter.prolog.md
chapter.prolog.md: 19 answers removed
```

It empties every output block and touches nothing else — prose, program cells, goals and
attributes are yours. A chapter with no answers is a valid chapter: one that has not been
executed yet, and `execute` fills it in again. The round trip is exact:

```sh
prolog-notebook clear chapter.prolog.md && prolog-notebook execute chapter.prolog.md
# byte-identical to what you started with
```

Three uses:

- **a workbook edition** — the chapter with the answers withheld, for a class. Where `hold`
  withholds them from a *reader*, this withholds them from the *file*.
- **a readable diff** — reviewing a prose change without nineteen solution sequences in the way.
- **starting again**, deliberately, rather than trusting an overwrite.

## 7. What a reader can do to your chapter

Worth knowing, because it is what your chapter has to survive. All of it is local to their
browser; the file you published is never written to.

| they press | and | undone by |
| --- | --- | --- |
| **Run** / `; next` / **all** | their answers replace yours on screen, labelled *your run* | reset |
| edit a cell and **Consult** | the engine holds their program, not yours | reset |
| **hide** (a cell, or all at once) | your answers go out of sight, still in the file | show |
| **Clear all outputs** | every output is emptied, and gone from a download too | **Restore outputs** |
| **reset** (per cell) | that cell goes back to the chapter exactly | — |
| **Download .prolog.md** | they leave with a real file — theirs, or yours as published | — |
| **restart engine** | a fresh engine; assert/retract state gone | — |

The model, which is worth stating because a reader learns it once:

> **One origin, one way back.** The chapter as published is the origin. Run, edit and clear
> move away from it; reset returns.

Two consequences for you as an author:

- **Your answers are never confused with theirs.** Every output on the page says whose it is,
  and a downloaded copy keeps your hash on your answers and hashes theirs against their
  program. A reader who edited a program and did not re-run opens their copy with those answers
  marked stale — exactly what the page they downloaded from was showing.
- **Hiding and clearing are different, and reversible.** Hiding acts on the screen; clearing
  acts on the file they would download. Neither can touch what you published.

See [modes.md](modes.md) for the whole doctrine.

## 8. Publishing

```sh
$ prolog-notebook build chapter.prolog.md
3 files → prolog-notebook-site/chapter/ (runtime and engine already there)
prolog-notebook-site/index.html lists 3 notebooks
Host prolog-notebook-site over HTTP — opening it from disk will not run.
```

A plain static directory: prerendered HTML with your answers in it, the runtime in `lib/`, the
engine in `swipl/`, and an `index.html` listing every chapter in the site. No bundler, no build
step of your own, nothing to configure. Push it to GitHub Pages, drop it on any static host, zip
it and email it.

**One site, however many chapters.** `build` does not write beside the notebook you gave it. It
walks up looking for an existing `prolog-notebook-site`, then for a `.git`, and writes there —
so a second chapter from a different folder joins the first rather than starting a site of its
own, and the runtime and the engine are written once for all of them. The index is regenerated
from the directory every time, with each chapter's title taken from its own H1. Order is
alphabetical for now: a chapter never states its position, so an index is the site's opinion
rather than the notebook's.

`--here` writes `prolog-notebook-site` beside the notebook instead, and `--out <dir>` puts it
wherever you say. Every build prints where it went, because writing outside the directory you
named is not something a tool should do quietly.

**Your chapter goes into the site too**, as `prolog-notebook-site/chapter/chapter.prolog.md`,
beside the page it produced. A reader can have the markdown, and the site can rebuild itself
without your source tree.

### A site has exactly one runtime

Every page in a site loads the same `lib/` and the same engine, and a page's generated `app.js`
is written against the runtime of the day it was built. Those two facts together mean a site can
never hold two generations of page: whichever copy of `lib/` is there, one of them is wrong. So a
build reconciles the site rather than warning you about it.

| what the site was built by | what a build does |
|---|---|
| the same versions | writes your page. Nothing else moves — the 6.2 MB engine is not copied again, so a post costs its own page |
| an older prolog-notebook | replaces the shared files and **regenerates every page**: `runtime 0.6.0 → 0.7.0 · 2 pages regenerated` |
| an older engine | the same, and names what regenerating cannot fix: `engine 8.0.1 → 8.0.7 · re-run execute on your chapters` |
| a **newer** prolog-notebook | refuses. Run `prolog-notebook upgrade`, or build elsewhere with `--out` |

A build aimed at one chapter rewriting five other pages is a lot of initiative, which is why it
is never quiet about it: one line names what moved and how many pages came with it.

**An engine bump never clears your answers.** A newer engine means those answers came from a
different SWI-Prolog — not that they are wrong, and most engine releases change nothing a chapter
displays. Erasing them would assert more than anyone knows, and would trade a probably-correct
chapter for a definitely-empty one. `execute` is how you re-run them when you want to.

- **It must be served over HTTP.** Browsers block ES modules over `file://`, so opening
  `index.html` from disk leaves the buttons inert — the page detects that and says so rather
  than failing silently. The prose and the answers are readable either way.
- **The engine is fetched on the first Run, never on load.** Your chapter is readable in full
  before any of it arrives.
- `build` ships **whatever the file has**. `execute` then `build` publishes a worked chapter;
  `clear` then `build` publishes one that has never been run.

You can also publish nothing at all and just push the `.prolog.md` to a repo. It reads on the
GitHub page, answers and all. That is the whole reason the format is markdown.

## 9. Things that will cost you an afternoon

- **A non-terminating goal hangs `execute`.** The engine runs in that process and there is no
  timeout yet ([869ejgyax]) — the command warns you about this every time it runs. `--limit`
  bounds *solutions*, not a runaway consult. In a browser it is fine: the engine is in a Web
  Worker and Stop terminates it.
- **One open sequence at a time.** SWI keeps open queries on a stack, so a reader stepping one
  query and then running another closes the first — the page tells them so in the cell it
  happened to. Nothing you write can hold two.
- **A predicate defined below a query is not in scope for it.** The page will say so by name
  rather than leaving them with "Unknown procedure", but the fix is to move the cell up.
- **`:- dynamic` state survives everything except a restart.** If your chapter asserts, say so
  in the prose; re-consulting the cell will not put it back.
- **Ids are stable once written.** Rename one and the output block that names it in `for=` is
  an error. Let `execute` mint them.
- **The engine version is pinned exactly, and moving it is a real event.** `swipl-wasm@8.0.4`
  ships SWI-Prolog 10.1.10 and `8.0.7` ships 10.1.13. Saved answers are only true of the engine
  that produced them, and SWI's answer spelling changes between releases — so bumping it means
  re-running every chapter in the same commit.

---

Reference: [format.md](format.md) — the file format · [modes.md](modes.md) — what a reader may
change · [binding.md](binding.md) — chapters into books.
