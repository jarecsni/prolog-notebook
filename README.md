# prolog-notebook

**Jupyter-style notebooks for Prolog. Runs in the browser, installs nothing.**

> **v0.11 — usable, and moving.** A chapter is a markdown file; the CLI runs it, serves it and
> publishes it. Writing one is [the author's handbook](docs/authoring.md). See
> [Status](#status) for what is not built yet.

### → [Read a chapter and run it](https://jarecsni.github.io/prolog-notebook/ch04-cut/)

No install, no clone, no sign-up. Press **Run**, then **`; next`**, and watch the solutions
arrive one at a time. Edit the program and consult your own version. The engine — SWI-Prolog
compiled to WebAssembly — is fetched only when you press Run, and everything happens in your
browser.

## The idea

Prolog is unusually badly served by a printed page, and unusually well served by an
executable one.

Almost everything that trips up a Prolog learner is something you have to *watch happen*.
A query does not return an answer, it returns answers one at a time on backtracking. A rule
that reads correctly can be wrong because of the order its goals are in. `once/1` around one
goal is free and around the goal next to it is catastrophic. None of that survives being
described; all of it is obvious the moment you run it and press `;` a few times.

So the aim here is notebooks where the prose and the Prolog live together and the Prolog
actually runs — for the reader, not just the author. That last part is the whole problem.
A Jupyter kernel for Prolog [already exists][kernel] and is good, but it needs Python, then
Jupyter, then the kernel, then a local SWI-Prolog: four installs before the first query. A
reader who has to do that has already closed the tab.

`prolog-notebook` uses [SWI-Prolog compiled to WebAssembly][wasm], so the Prolog system runs
*inside the page*. No server, no kernel process, no install. You publish a static file and
the reader clicks a link.

### `; next` is the point

The reason this is not "Jupyter with a different kernel" is the button marked `; next`.

Jupyter's model is request/response: run a cell, get a result. Prolog's model is a stream of
solutions you walk through. In the included chapter, `is_son(X)` reports edward *twice* — and
that duplication **is the lesson**, because it means Prolog found two proofs. A notebook that
showed only a final list of results would have hidden the very thing worth teaching.

So a query cell gives you the first solution, and then you step.

## Try it

A whole chapter, from nothing, in four commands:

````sh
npm i -g prolog-notebook

cat > splitting.prolog.md <<'EOF'
# Splitting a list

`append/3` is usually introduced as the predicate that joins two lists. That is the
least interesting thing it does — run it backwards and it takes a list apart, every
way it can be split, one solution at a time.

```prolog query
append(Front, Back, [hello, there, world])
```
EOF

prolog-notebook execute splitting.prolog.md   # SWI fills the answers in
prolog-notebook view splitting.prolog.md      # read it, cells live
````

`prolog-notebook guide` is the two-minute tour — what a project looks like, the loop, and what
a bare command does — and `man prolog-notebook` is the same thing where you would expect it.

`execute` runs the chapter and writes the solutions back into the markdown — you never
hand-write an answer. `view` opens it in your browser: press Run, then `; next`, and watch the
four splits arrive one at a time. Nothing is installed but the command.

To send it to somebody, or host it:

```sh
$ prolog-notebook build splitting.prolog.md
created prolog-notebook-site/ — you may want it in .gitignore
created prolog-notebook-index.md — the contents of your site. Reorder it, rename chapters, …
3 files → prolog-notebook-site/splitting/ (13 shared with the site)
1 query · all answered
prolog-notebook-site/index.html lists 1 notebook
```

A plain directory: prerendered HTML with the saved answers in it, the runtime and the 6.2 MB
engine shared at the root, and an index listing every chapter you have built. The engine is
fetched only when a reader presses Run. No bundler, no build step of your own, nothing to
configure.

**One rule for every command: the operand is a filter.** Name files and a command acts on
those; name none and it acts on the whole book — every chapter your project holds, which is
what `prolog-notebook-index.md` above is for.

|  | `<file(s)>` | bare |
|---|---|---|
| `view` | opens on that chapter | the whole book, live from your sources |
| `execute` | those chapters | every chapter in the book |
| `clear` | those chapters | every chapter (asks first) |
| `build` | those chapters into the site | the whole book, in order |
| `publish` | — | the site |

So `prolog-notebook view` reads your whole book in a browser, live from your sources and with
no build step at all — reorder the contents and reload, and the contents page and the
prev/next cards follow. `prolog-notebook execute` fills in every answer before you publish.
`--built` serves the site as it stands instead: the rehearsal for the one command you cannot
take back. And `--watch` reloads the page when you save, keeping your scroll position, so an
editor on one side of the screen and a browser on the other behave like one thing.

That first build also writes **`prolog-notebook-index.md`** beside the site — the one file that
says what the site holds:

```markdown
---
format: prolog-notebook-book/1
---

# Prolog Studies

Working through the classics, one chapter at a time.

## Part I — Foundations
- [Splitting a list](splitting.prolog.md)
```

Track it; it is yours. Reorder the entries, rename a chapter for your table of contents, group
them under headings — the contents page is a rendering of this file, so what you write is what
readers see. Then **`prolog-notebook build`, with no arguments, builds the whole book**, in your
order, and drops any page whose entry you have removed. About 55 ms a chapter, so rebuilding
everything is the normal gesture rather than an occasion.

A link to another one of these files is a **sub-book**, to any depth:

```markdown
- [Bratko — Programming for AI](bratko/prolog-notebook-index.md)
- [Clocksin & Mellish](cm/prolog-notebook-index.md)
```

Each gets its own contents page and its chapters are published beneath it — `/bratko/lists/`.
That is how one repository holds several books, which matters because it cannot hold several
sites: GitHub Pages serves exactly one per repository.

Build a chapter by name from anywhere in the project and it joins the same site — `build` walks
up for an existing `prolog-notebook-site`, then for a `.git`, so chapters that live in
different folders still publish as one thing, and a chapter the book does not yet list is added
to it. `--root` skips a nearer site and writes to the project's; `--out <dir>` puts it wherever
you say.

A site has exactly one runtime and one engine, so the second post costs its own page rather than
another 6.2 MB. When you upgrade the tool, the next build brings the whole site with it and says
so — `runtime 0.6.0 → 0.7.0 · 2 pages regenerated` — because each page keeps the chapter it was
built from.

### Or from a checkout

```sh
git clone https://github.com/jarecsni/prolog-notebook
cd prolog-notebook
npm install
npm run dev            # serves the repo root on :8777
```

Then open **http://localhost:8777/viewer/**. That is a chapter — the `once/1` placement puzzle,
a real worked section rather than a widget demo — rendered from
[`notebooks/ch04-cut.prolog.md`](notebooks/ch04-cut.prolog.md). Predict what each version
returns before you press Run.

Edit that file, reload, and the chapter changes: prose, Prolog, margin note and prediction box
are all in it, and there is no HTML anywhere. Point the viewer at any other notebook with
`?src=`.

| | |
|---|---|
| `notebooks/` | chapters. The product. |
| `viewer/` | the development shell, for working on the renderer itself. `view` and `build` are what everyone else uses. |

The chapter also reads on the repo page, [as a file](notebooks/ch04-cut.prolog.md), with no
build step and no site: prose as prose, Prolog syntax-highlighted, the saved answers in place,
and the prediction still hidden behind a `<details>` you have to click. That is the whole
reason the format is markdown.

It has to be **served over HTTP**. Opening the page straight from disk leaves the buttons
inert, because browsers block ES modules over `file://` — the page detects this and says so
rather than failing silently.

## Fill in a chapter's answers

A chapter's saved answers have to come from a real run — a hand-written output block is the
author's *guess* at what SWI prints, published as though it ran. So write the file with no
output blocks and let the engine fill them in:

```sh
prolog-notebook execute chapter.prolog.md
```

It consults every program cell, runs every query below it, and writes the solution sequences
back into the file along with an `input-hash` for each — which is what makes the chapter render
complete, and render as *current*, before the engine arrives. Running it again on an unchanged
chapter changes nothing.

And back out again, for a workbook edition or a diff you can read:

```sh
prolog-notebook clear chapter.prolog.md
chapter.prolog.md: 4 answers removed
```

`clear` empties every output block and touches nothing else; `execute` fills them in again from
the engine. A chapter with no answers is a valid chapter — one that has not been executed yet.

## Keep it from rotting

A chapter's saved answers are a claim about what SWI prints. Technical books rot because that
claim quietly stops being true — the library moves, the engine's spelling changes, a clause
above an answer is edited and never rerun — and nobody notices for two years.

```sh
prolog-notebook execute --check
```

Runs everything, writes nothing, and fails when the file no longer says what SWI says. It names
the line rather than counting them, because in CI nobody can rerun it by hand:

```
ch04-cut.prolog.md: q-is-son is not what it says it is — ?- is_son(X)
    saved: X = victoria
    now:   X = alfred
```

Two things fail it: an answer that has **moved**, and one that still holds but whose **program
has changed underneath it** — a file certifying answers against code it no longer contains. A
query with **no saved answer** is reported and passes, because a workbook edition is a
deliberate thing and nothing can tell it from an author who forgot to run `execute`. It is
silent when it passes, so a green pipeline has nothing to read.

This repository runs it on its own book on every pull request:

```yaml
      - name: Check the book
        run: npx prolog-notebook execute --check
```

Each option belongs to a command, and typing one under the wrong command tells you which:

| flag | on | |
|---|---|---|
| `--no-pager` | `guide` | print the tour rather than opening a pager |
| `--title <text>` | `new` | the chapter's heading. Default: from the filename |
| `--limit <n>` | `execute` | solutions to take from one query before stopping. Default 100. |
| `--timeout <s>` | `execute` | seconds a cell may say nothing before it is abandoned. Default 30; `0` waits |
| `--check` | `execute` | write nothing; fail if a saved answer is no longer what SWI says |
| `--stdout` | `execute`, `clear` | print the result instead of writing the file |
| `--quiet` | `execute`, `clear` | report only failures |
| `--out <dir>` | `build` | where the site is. Default: the nearest `prolog-notebook-site`, else one at the project root |
| `--root` | `build` | write to the project's `prolog-notebook-site`, skipping any nearer one |
| `--dry-run` | `publish` | say what would go and where, push nothing |
| `--yes` | `publish`, `clear` | do not ask first — for CI, where there is nobody to ask |
| `--port <n>` | `view` | what it listens on. Default 8777, and it takes another if that one is busy |
| `--no-open` | `view` | print the URL instead of opening a browser |
| `--built` | `view` | serve the site as built, rather than your sources as they are |
| `--watch` | `view` | reload the page in the browser when a file changes |

Two are about the tool rather than about a notebook:

| flag | |
|---|---|
| `--version` | the tool's version, **the SWI-Prolog version it will run your chapters with**, and the copyright. On its own — it is a command, not a modifier |
| `-h`, `--help` | help for the command you named, or the summary if you named none. This one really does work anywhere |

Three tiers, and they answer different questions: the bare screen says **which command**, a
command's own `--help` says **how to call it**, and `prolog-notebook guide` says **what a
project is** — paged at a terminal, plain down a pipe. The man page is generated from the same
two tables the help screens read, so `man prolog-notebook` cannot drift from the tool.

```sh
prolog-notebook upgrade      # fetch the latest
```

Two things it will not do. A query stopped at the limit is written **without** a terminator,
which is the format's way of saying the search was never exhausted — `false.` there would be a
forgery. And if a program cell fails to load, nothing is written at all: every answer below it
was produced against a chapter that does not exist.

When it does real work it asks npm, at most once a day, whether there is a newer version, and
says nothing unless there is. Never for `--help` or `--version`, never under `--quiet`, never
when `CI` or `NO_UPDATE_NOTIFIER` is set, and never blocking the run. A registry it cannot
reach is reported once a day rather than on every command — silence there would be
indistinguishable from *you are up to date*.

To ask outright, run `prolog-notebook upgrade`: it checks whatever the daily timer thinks, says
where you stand either way, and fetches a new version only if there is one.

When it finds something newer **and you are at a terminal**, it offers to fetch it *before*
doing the work — and if you say yes it upgrades, then runs your command on the new version.
One command, no re-run:

```
$ prolog-notebook execute ch04.prolog.md
You have Prolog Notebook 0.4.0. The latest is 0.4.2.
Update and continue on the new version? [Y/n] y
Updating with npm i -g prolog-notebook@0.4.2
You now have Prolog Notebook 0.4.2.
Continuing on the new version.
  ✓ p-family
  ✓ q-is-son — 6 solutions
```

That costs a network round trip once a day rather than once a run, because the answer is
cached. Down a pipe or in a script there is nobody to ask, so it prints `Update with:
prolog-notebook upgrade` after the work instead — a question nobody can answer is a hang.

`upgrade` replaces this copy only when it can prove how it was installed. A global `npm i -g`
it will do; a dependency of somebody's project it will not touch, and a source checkout is
git's business. Guessing wrong there breaks a project while trying to help.

A goal that never comes back no longer hangs the command. `execute` runs the engine in a worker
thread it can terminate, with a deadline **on progress rather than on total time** — so a
chapter of fifty slow cells never trips it, and a single cell that has said nothing for half a
minute always does:

```
$ prolog-notebook execute --timeout 3 loop.prolog.md
loop.prolog.md: q-loop did not finish within 3s — ?- loop
loop.prolog.md: not written. Fix the goal, or raise --timeout.
```

`--timeout <seconds>`, default 30, `0` to wait forever. Nothing is written for a chapter that
hung: a file that is part fresh and part stale is worse than one that was not touched. Note that
`--limit` was never the answer here — a runaway *consult* is not a solution count.

## Write one

**[The author's handbook](docs/authoring.md)** — the loop, a chapter from scratch, what `hold`
and `rerun` do to a reader, why you never hand-write an answer, publishing, and the things that
will otherwise cost you an afternoon.

| | |
|---|---|
| [docs/authoring.md](docs/authoring.md) | writing and publishing a chapter |
| [docs/format.md](docs/format.md) | the `.prolog.md` format, normatively |
| [docs/modes.md](docs/modes.md) | Read, Explore, Own — what a reader may change, and what may never be confused with what |
| [docs/binding.md](docs/binding.md) | chapters into books; why a notebook never states its own position |
| [docs/platform-seams.md](docs/platform-seams.md) | what is environment-specific, and where |

## Use it

Headless, in Node — this is how you test that every example in a document still works:

```js
import { createSession, formatSolution } from 'prolog-notebook';

const session = await createSession();
await session.consult(`
  male(edward).  male(alfred).
  father(albert, edward).  mother(victoria, edward).
  parent(X, Y) :- father(X, Y) ; mother(X, Y).
  is_son(X) :- male(X), parent(_, X).
`, 'cell-family');

// Step solutions one at a time, as at the prompt
const q = session.query('is_son(X)');
let r;
while (!(r = await q.next()).done) console.log(r.text);

// …or drain it
const { solutions } = await session.query('is_son(X)').all();
```

**Every call is awaited**, because in the browser the engine runs in a Web Worker. A Prolog
query is synchronous WASM, so a goal that never terminates blocks whatever thread it is on —
and non-termination is *chapter material* in a Prolog book. Running the engine somewhere that
can be terminated is what turns `loop :- loop.` from a dead tab into a Stop button.

In a browser, import from `prolog-notebook/browser` and let it start the worker; the page does
**not** need a `<script>` tag for the WASM bundle any more, because the worker loads it. See
[`viewer/index.html`](viewer/index.html) for the whole of a host page, and
[`src/notebook.js`](src/notebook.js) for the wiring.

```js
import { createSession } from 'prolog-notebook/browser';
const session = await createSession();       // boots the worker
await session.abort();                       // stop a runaway goal; cells are re-consulted
```

To render a notebook file instead of marking up cells by hand — the whole page from one call:

```js
import { load } from 'prolog-notebook/page';
await load('chapter-04-cut.prolog.md');      // parse, render into <main>, wire up the cells
```

`prolog-notebook/format` (parse, serialise, `inputHash`) and `prolog-notebook/render` (model to
HTML strings) are exported separately, and neither touches the DOM — the same two modules back
the browser, the CLI runner and a future VS Code serializer.

**As a library, Node runs the engine in your own process and it is deliberately not protected**:
a non-terminating goal hangs the thread that called it. You own that thread, and hiding the fact
behind a worker you did not ask for would hide the difference between the two environments. The
`execute` command does own its thread, so it puts the engine in one it can terminate — see
`--timeout` above. If you need the same guarantee from the API, run `createSession` in a worker
of your own.

### API

| | |
|---|---|
| `createSession(options?)` | boots SWI-Prolog; returns a session |
| `await session.consult(text, name?)` | loads a clause base into `user`; `{ok, error?, messages}` |
| `session.query(goal)` | opens a query; nothing runs until you pull a solution |
| `await query.next()` | one solution: `{done, solution?, text?, error?}` |
| `await query.all(limit?)` | drains it: `{solutions, error?, truncated}` |
| `await session.abort()` | terminates a running goal and replays the consults |
| `await session.restart()` | same, without anything needing to be running |
| `formatSolution(s)` | renders bindings the way a top level would, with no engine |

Abort is cheap because of a decision made elsewhere: one cell is one virtual file, so the
clause store rebuilds from the cells in milliseconds. Terminating the worker also reclaims the
whole WASM heap, so a runaway loop and a memory blow-up have the same cure. Assert/retract
state does not survive it — see [`docs/format.md`](docs/format.md) §8.

## Two things that will bite you if you build this yourself

Both were found by driving a real browser, not by reading documentation.

**Module context.** `prolog.query(Goal)` runs with `system` as its context module, while
`consult/1` loads into `user`. Unqualified goals raise `Unknown procedure: system:foo/1`
*even though the consult reported success*. Goals are read and called in `user`.

**One round trip per answer, or the variables come apart.** Formatting each binding with its
own `term_string/2` call loses the fact that two of them are the *same* variable:
`app([1,2], Tail, L)` came out as `L = [1,2|_20306],  Tail = _20428` where a real toplevel
prints `L = [1, 2|Tail]`. Render the whole answer inside Prolog, in one call, with the goal's
own `variable_names`.

**The engine version is not the package version, and it must not float.**
`swipl-wasm@8.0.4` ships SWI-Prolog 10.1.10; `8.0.7` ships 10.1.13. Two installs of the same
release, ten minutes apart, ran different Prologs. Since a notebook's saved answers are only
true of the engine that produced them — and SWI's answer spelling changes between releases —
the dependency is pinned exactly, and moving it is a commit with the chapters re-run in it.

**The last solution arrives with `done`.** `next()` can return `{done: true, value: {...}}` —
a final binding and the end of the search in a single step. Treating `done` as "stop, no more
answers" silently drops the last solution, which is the kind of bug you don't notice until a
lesson about backtracking quietly teaches the wrong thing.

## Status

Working and tested:

- execution core, environment-agnostic (`src/engine.js`), run in a Web Worker in the browser
- Node entry point, browser entry point
- **a chapter is a file** — parse, render and mount a `.prolog.md`, cells and all
- **a chapter is readable cold** — saved answers render with no engine, and are marked stale
  when the program above them has moved
- program cells and query cells with `Run` / `; next` / `all` / `stop`, per-cell reset, and a
  page that says what the engine is holding
- `hold` and `rerun="auto"` — the author decides what a reader may see and when it refreshes
- **a book that cannot rot**: `execute --check` fails when a saved answer is no longer what SWI
  gives, or when the program above it has changed — and this repository runs it on its own
  chapter in CI
- **the authoring loop**: `view --watch` reloads the page when you save, keeping your place
- **three tiers of help**: the command list, a command's own screen, and `prolog-notebook
  guide` — plus a `man` page generated from the same source, so none of them can drift
- **the CLI**: `new` starts a chapter, `execute` runs one headlessly and writes its answers
  back, `clear` takes them out again, `view` serves your sources live, `build` writes the site
  and `publish` pushes it where a host will serve it — and it updates itself
- **a project is a book**: `prolog-notebook-index.md` says what the site holds and in what
  order, sub-books nest to any depth, and every chapter page carries a breadcrumb and
  prev/next. Name files and a command acts on those; name none and it acts on the book
- **a goal that never comes back** is abandoned on a deadline and named, because the engine
  runs in a thread the CLI can terminate
- **page controls**: hide the saved answers to work a chapter cold, clear them out and restore
  them, and download your own copy — yours or the chapter as published
- 355 passing tests

Not built yet:

- custom elements (`<prolog-program>`, `<prolog-query>`) so notebooks drop into any static site
- a VS Code notebook controller — VS Code supplies the UI, this supplies the kernel, still no Python
- persistence, so a reader's edits survive a reload
- `trace/0` integration, for visible backtracking — where [prolog-trace-viz][ptv] would plug in
- syntax highlighting

## Prior art

[prolog-jupyter-kernel][kernel] — a proper Jupyter kernel for SWI and SICStus, from Anne
Brecklinghaus's master's thesis at Düsseldorf. Use it if you already live in JupyterLab and
don't mind the installs.

[SWISH](https://swish.swi-prolog.org/) — SWI-Prolog's own browser environment, which has a
notebook feature. Server-hosted and sandboxed; this is neither.

## License

MIT

[kernel]: https://github.com/hhu-stups/prolog-jupyter-kernel
[wasm]: https://github.com/SWI-Prolog/swipl-wasm
[ptv]: https://github.com/textologylabs/prolog-trace-viz
