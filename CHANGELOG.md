# Changelog

## [0.2.0] — 2026-08-16

**Breaking: the session API is asynchronous.** `consult`, `next` and `all` now return
promises, and in the browser the engine runs in a Web Worker.

### Why

A Prolog query is synchronous WASM, so a goal that never terminates blocks the thread it
runs on. Measured, not assumed: `consult('loop :- loop.')` followed by `query('loop').next()`
stopped Node's event loop dead — a timer scheduled for 3 seconds never fired. In a browser
that is not a slow page, it is a dead one: no repaint, no button, no way back except closing
the tab.

That is unacceptable here specifically, because **non-termination is chapter material**. Left
recursion and a generator with no base case are things a Prolog book has to demonstrate, and
the demonstration has to be survivable.

### Added

- **A chapter is a file.** `prolog-notebook/page` fetches a `.prolog.md`, parses it, renders
  the whole page and wires up the cells: `await load('chapter-04-cut.prolog.md')`. Program and
  query cells are generated from the model rather than marked up by hand, which is what makes
  writing a chapter *writing markdown*.
- **The `once/1` chapter is now that file**, and the hand-written page it was ported from is
  deleted. Same prose, same four queries, same answers — six duplicated sons, one from `son_a`,
  three from `son_b`, `true` for the ground goal — driven from
  [`notebooks/ch04-cut.prolog.md`](notebooks/ch04-cut.prolog.md) instead of 200 lines of HTML.
  It carries its saved answers and their `input-hash`es, and a test asserts the chapter agrees
  with them, so an edit to a program cell that invalidates an answer below it fails CI.
  On the repo page it reads as a document: prose as prose, Prolog syntax-highlighted, and the
  prediction still hidden behind a `<details>` you have to click.
- **Run brings its own context.** Pressing Run on a query consults the program cells above it
  first, so a reader who lands halfway down a chapter gets an answer rather than
  `Unknown procedure`. Cells already loaded at their current text are skipped, so the second
  Run of a chapter consults nothing and an edited cell invalidates only itself.
  There is no dependency graph, and there is no need for one: **Prolog has no load-time name
  binding** — `q(X) :- p(X)` merely mentions `p/1`, which is looked up when it is *called* — so
  consult order cannot affect correctness, and at ~3.5 ms a cell there is nothing to gain by
  computing one.
- **An error a reader can act on.** `wasm:wasm_call_string/3: Unknown procedure: son_a/1` is
  our own plumbing in the middle of a lesson; it now reads `Unknown procedure: son_a/1`, and
  where the predicate is defined by a cell *below* the query, the notebook says so and names
  it. Context frames belonging to the reader's own code are untouched — `//2: Arithmetic:
  evaluation error` still names the division that failed.
- `prolog-notebook/render` — the cell model to HTML **strings**, DOM-free. The same emitter
  serves the browser today, the static build in v0.3 and the VS Code renderer later; one
  implementation, four consumers.
- A generated program cell carries its notebook id as `data-cell`, and the consult is named by
  it. SWI now says `Previously defined at /p-family.pl:20` — a warning that names a cell the
  reader can find in the source, rather than `/cell-3.pl`.
- **`notebooks/` holds chapters and `viewer/` holds the one page that renders them.** They had
  both been living in `example/`, under a script (`npm run example`, now `npm run dev`) that
  actually served the repo root. A chapter is not an example, there will be many of them, and
  the first one had been doubling as a parser fixture *with a deliberately wrong `input-hash`* —
  which a file anybody is meant to read must never carry. The wrong hash now lives in
  `test/fixtures/stale-output.prolog.md`, where being wrong is the point.
- **The engine runs in a Web Worker** in the browser, so a runaway goal costs a click on
  Stop rather than the tab. Verified by driving Chrome: with `loop` spinning, timers still
  fire, layout still runs, and the notebook is usable again afterwards.
- `session.abort()` and `session.restart()` — terminate the worker and replay the consults
  into a new engine. Affordable only because one cell is one virtual file, so a chapter's
  clause store rebuilds in milliseconds; terminating also reclaims the whole WASM heap, so a
  memory blow-up and an infinite loop have the same cure.
- A `stop` button in the query cell, and a `ConsultLog` holding one entry per cell — the
  latest text, not a history — so a replay restores what the reader actually has.
- `prolog-notebook/format` (0.1.3, listed here for completeness): the notebook parser,
  canonical serialiser and `input-hash`.

### Changed

- `createSession()` returns a session whose methods are all async. Migration is mechanical:
  `session.consult(…)` → `await session.consult(…)`, `q.next()` → `await q.next()`.
- The browser page no longer loads the WASM bundle with a `<script>` tag; the worker loads
  it. A page may pass `swiplUrl` if it lives somewhere unusual.
- Node still runs the engine in-process and is **not** protected against a runaway goal. The
  CLI is not an interactive page; the limitation is documented rather than implied.

### Notes

`assert`/`retract` state does not survive an abort, which is already the documented
behaviour of "restart engine and run all" (`docs/format.md` §8) rather than a new surprise.

## [0.1.2] — 2026-08-04

Two bugs, both of which made the library quietly say something untrue. Found by
running the published entry point, not by reading the code.

### Fixed

- **Compound terms lost their arguments.** `foo(1,2)` rendered as `foo()`,
  `a-b` as `-()`, `f(g(h))` as `f()`. The arguments of a compound arrive under
  the key *named by the functor* and wrapped in one extra array, not under
  `args` as the formatter assumed. Atoms, numbers and lists were unaffected,
  which is why the `once/1` example never showed it — that chapter only ever
  binds variables to atoms.
- **A syntax error reported a successful consult.** SWI prints the offending
  clause, skips it and carries on, so `consult/1` still succeeded and the cell
  said `✓ consulted` while the predicate was not there.
- **A cell could silently destroy another cell's clauses.** Two cells defining
  the same predicate make SWI print "Redefined static procedure" and keep only
  the later one. That warning went to the console and nothing reached the page.
- `consult` no longer produces paths like `/chapter.pl.pl` when the cell name
  already ends in `.pl`.

### Added

- `PrologSession#formatTerm` and `#formatSolution` render through SWI itself, so
  operators, quoting and every other rule of the writer come out right —
  `X = a-b`, not `X = -(a, b)`. `query.next()` now carries a `text` field with
  the solution already rendered this way; prefer it over `formatSolution`.
- `consult` returns `messages: [{kind, text}]` — SWI's warnings and errors for
  that cell, captured through `message_hook/3`.
- `argumentsOf`, `textOf` and `toEngineTerm` are exported for anything that
  needs to walk a term.
- Eleven more tests, including the reconsult behaviour the notebook renderer
  will depend on: re-consulting one cell replaces exactly that cell's clauses,
  leaves dependent cells working, and leaves no ghost behind when a predicate is
  renamed.

## [0.1.1] — 2026-08-02

No functional change. Published from CI via npm trusted publishing (OIDC) to
verify the release pipeline end to end — v0.1.0 was published by hand to claim
the name.

### Changed

- Release workflow authenticates over OIDC instead of an `NPM_TOKEN`. npm
  deprecates 2FA-bypass granular tokens for direct publishing around January
  2027 and points at trusted publishing instead; it also removes the 90-day
  token expiry from the loop.
- The example page now says so when it has not started, instead of leaving the
  buttons silently inert (browsers block ES modules over `file://`).

## [0.1.0] — 2026-08-02

First release. The execution core works; the file-backed renderer does not exist yet.

### Added

- **Execution core** (`src/engine.js`) — SWI-Prolog via WebAssembly, with no DOM in it, so
  the same module backs the browser, a future VS Code controller, and a headless runner.
  `PrologSession.consult/2`, `session.query/1`, `query.next()`, `query.all()`.
- **Node entry point** (`prolog-notebook`) and **browser entry point**
  (`prolog-notebook/browser`).
- **Cell wiring** (`src/notebook.js`) — program cells and query cells with `Run`, `; next`
  and `all`. Stepping solutions one at a time is deliberate: a Prolog query yields answers
  on backtracking, and watching that happen is usually the point.
- **Worked example** (`example/index.html`) — the `once/1` placement puzzle, a real section
  rather than a widget demo.
- Eight tests covering duplicate proofs, `once` around a generator versus a test, ground
  goals, failure, unknown predicates, and stepping.

### Notes

Two behaviours of `swipl-wasm` that the core papers over, both found by driving a browser
rather than reading documentation:

- `prolog.query/1` runs with `system` as its context module while `consult/1` loads into
  `user`, so goals are wrapped as `user:( Goal )`.
- `next()` can return the final binding together with `done: true`; treating `done` as
  "stop" drops the last solution.
