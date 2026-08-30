# prolog-notebook

**Jupyter-style notebooks for Prolog. Runs in the browser, installs nothing.**

> ⚠️ **v0.1.0 — early.** The execution core works and is tested. The renderer that turns a
> notebook *file* into a page is not written yet; today you mark cells up in HTML by hand.
> See [Status](#status).

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
| `viewer/` | one shell page that renders any of them. Replaced by `build` in v0.3. |

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
npx prolog-notebook run notebooks/ch04-cut.prolog.md
```

It consults every program cell, runs every query below it, and writes the solution sequences
back into the file along with an `input-hash` for each — which is what makes the chapter render
complete, and render as *current*, before the engine arrives. Running it again on an unchanged
chapter changes nothing.

| flag | |
|---|---|
| `--limit <n>` | solutions to take from one query before stopping. Default 100. |
| `--stdout` | print the result instead of writing the file |
| `--quiet` | report only failures |
| `--version` | the tool's version, **the SWI-Prolog version it will run your chapters with**, and the copyright |

Two things it will not do. A query stopped at the limit is written **without** a terminator,
which is the format's way of saying the search was never exhausted — `false.` there would be a
forgery. And if a program cell fails to load, nothing is written at all: every answer below it
was produced against a chapter that does not exist.

It has no defence against a non-terminating goal yet — the engine runs in this process, so
`loop :- loop.` hangs the command. Say the word `--limit` all you like; a runaway *consult* is
not a solution count. Fixing it properly means a worker thread, and it is the prerequisite for
putting this in CI.

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

Node runs the engine in-process and is deliberately **not** protected: a non-terminating goal
will hang it. The CLI is not an interactive page, and pretending otherwise would hide the
difference.

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
*even though the consult reported success*. Goals are wrapped as `user:( Goal )`.

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
- **the CLI runner**: `prolog-notebook run` executes a chapter headlessly and writes its
  answers back
- download your own copy of a chapter, answers and all
- 186 passing tests

Not built yet:

- `--check` — run a chapter in CI and fail the build when its answers have drifted. Needs a
  timeout first: a test suite that can hang forever is not a test suite.
- `build` — a static page a reader can open, without a dev server
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
