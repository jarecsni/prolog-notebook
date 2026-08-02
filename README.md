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
solutions you walk through. In the included example, `is_son(X)` reports edward *twice* — and
that duplication **is the lesson**, because it means Prolog found two proofs. A notebook that
showed only a final list of results would have hidden the very thing worth teaching.

So a query cell gives you the first solution, and then you step.

## Try it

```sh
git clone https://github.com/jarecsni/prolog-notebook
cd prolog-notebook
npm install
npm run example        # then open http://localhost:8777/example/
```

The example is a real worked section — the `once/1` placement puzzle — not a widget demo.
Predict what each version returns before you press Run.

It has to be **served over HTTP**. Opening `example/index.html` straight from disk leaves the
buttons inert, because browsers block ES modules over `file://` — the page detects this and
says so rather than failing silently.

## Use it

Headless, in Node — this is how you test that every example in a document still works:

```js
import { createSession, formatSolution } from 'prolog-notebook';

const session = await createSession();
session.consult(`
  male(edward).  male(alfred).
  father(albert, edward).  mother(victoria, edward).
  parent(X, Y) :- father(X, Y) ; mother(X, Y).
  is_son(X) :- male(X), parent(_, X).
`);

// Step solutions one at a time, as at the prompt
const q = session.query('is_son(X)');
let r;
while (!(r = q.next()).done) console.log(formatSolution(r.solution));

// …or drain it
const { solutions } = session.query('is_son(X)').all();
```

In a browser, load the WASM bundle with a `<script>` tag, then import from
`prolog-notebook/browser`. See [`example/index.html`](example/index.html) for the cell
markup and [`src/notebook.js`](src/notebook.js) for the wiring.

### API

| | |
|---|---|
| `createSession(options?)` | boots SWI-Prolog; returns a `PrologSession` |
| `session.consult(text, name?)` | loads a clause base into `user`; `{ok, error?}` |
| `session.query(goal)` | opens a query; returns a `PrologQuery` |
| `query.next()` | one solution: `{done, solution?, error?}` |
| `query.all(limit?)` | drains it: `{solutions, error?, truncated}` |
| `formatSolution(s)` | renders bindings the way a top level would |

## Two things that will bite you if you build this yourself

Both were found by driving a real browser, not by reading documentation.

**Module context.** `prolog.query(Goal)` runs with `system` as its context module, while
`consult/1` loads into `user`. Unqualified goals raise `Unknown procedure: system:foo/1`
*even though the consult reported success*. Goals are wrapped as `user:( Goal )`.

**The last solution arrives with `done`.** `next()` can return `{done: true, value: {...}}` —
a final binding and the end of the search in a single step. Treating `done` as "stop, no more
answers" silently drops the last solution, which is the kind of bug you don't notice until a
lesson about backtracking quietly teaches the wrong thing.

## Status

Working and tested:

- execution core, environment-agnostic (`src/engine.js`), 8 passing tests
- Node entry point, browser entry point
- program cells and query cells with `Run` / `; next` / `all`
- the worked example

Not built yet:

- **a file-backed renderer** — reading `.ipynb` or markdown and *generating* the cells.
  Today the example's cells are hand-written HTML. This is the next real piece of work.
- custom elements (`<prolog-program>`, `<prolog-query>`) so notebooks drop into any static site
- a VS Code notebook controller — VS Code supplies the UI, this supplies the kernel, still no Python
- a CLI runner, to execute a document's cells in CI and fail the build when an example rots
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
