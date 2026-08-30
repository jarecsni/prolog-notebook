# Changelog

## [0.4.1] — 2026-08-30

### Changed

- **The update notice says what you have**, not just what exists:

      You have the latest version of Prolog Notebook, 0.4.1.
      You have Prolog Notebook 0.4.0. The latest is 0.4.1.
      Update with: npm i -g prolog-notebook

  *Prolog Notebook 0.4.1 is the latest* states a fact about the world and leaves the reader to
  work out that it is also a fact about them — which is the whole question they asked.

## [0.4.0] — 2026-08-30

### Added

- **The CLI notices when it is out of date.** On real work — `run` — it asks npm at most once
  a day whether there is something newer, and says nothing unless there is:

      You have Prolog Notebook 0.4.0. The latest is 0.5.0.
      Update with: npm i -g prolog-notebook

  `--check-update` forces the question and answers it either way, including *you are on the
  latest* — which the daily check deliberately never says, because a tool that congratulates
  you on every command is one you learn to read past.

  It stays out of the way by design: never for `--help` or `--version`, never under `--quiet`,
  never when `CI` or `NO_UPDATE_NOTIFIER` is set, and never between the reader and their
  answers — the request is started before the run and collected after it. The notice goes to
  **stderr**, because `run --stdout` is a notebook going down a pipe.

  A registry it cannot reach is reported once a day rather than on every command: silence
  there would be indistinguishable from *you are up to date*, which is the one thing a broken
  check must not look like. The answer is remembered in `~/.cache/prolog-notebook/`
  (XDG-aware), not beside the package, because a global install is often read-only. A private
  registry is honoured through npm's own `registry` config.

## [0.3.1] — 2026-08-30

### Changed

- **The build line in `--version` carries one date, and it is the build's.**

      Built from commit ca69c2a on 2026-08-30 14:42:46 UTC
      Working copy ca69c2a (modified)

  The commit's own date is gone: the hash already identifies it, and anyone who wants it can
  ask git. A working copy now carries no date at all, which follows from the same rule rather
  than being a separate decision — the only date left is the build's, and a working copy has
  not been built. UTC, to the second, because a build stamp is read by whoever is holding the
  package, wherever they are.

## [0.3.0] — 2026-08-30

**A chapter is a file you can read, run, and fill in from the command line.** The renderer,
the page's own behaviour, and the first half of the CLI.

### Why

0.2.0 made a `.prolog.md` executable. It did not make one *publishable*: the answers a chapter
shows had to be typed by its author, which means they were the author's guess at what SWI
prints, published as though it ran. Everything here follows from closing that gap and from
what the closing revealed.

`prolog-notebook run` now fills a chapter's answers in from a real engine. Run against the
chapter in this repository it changes nothing — the hand-written answers were already exactly
what SWI produces, hashes included, which is now a test.

### Added

- **`prolog-notebook run <file>…`** — consults every program cell, runs every query below it,
  and writes the solution sequences back with an `input-hash` for each. `--limit`, `--stdout`,
  `--quiet`. The logic is in `src/run.js` and takes a parsed notebook and a session, so
  `--check` and a VS Code "run all" will get the same behaviour without a shell.
- **`--version`**, which says which SWI-Prolog will produce your answers. swipl-wasm 8.0.7
  ships SWI-Prolog 10.1.13, and the two numbers are unrelated — so the engine version is the
  one fact there that nobody could have looked up. A published install also reports the commit
  it was built from; a working copy says so, and says when it has uncommitted edits.
- **A chapter is readable cold.** Saved answers render with no engine anywhere, and are marked
  stale when the program above them has moved.
- **`hold`** — a query cell can withhold its saved answers until the reader runs it, or until
  they have written the prediction above it. A page that has already printed all six answers is
  arguing with prose that says "press Run".
- **`rerun="auto"`** — the answers follow the program. On consult, never on edit; never
  starting work nobody asked for; and a held cell stays manual until its wait ends.
- **The page's own controls**: a lozenge that raises a card — what the engine is holding, the
  chapter's answers shown or hidden, and the notebook itself. It says which version is on
  screen, and once the two differ, lets you download either.
- **Per-cell reset**, on both runnable kinds. On a program cell that means out of the engine
  as well as back to the chapter's text.
- **A stateful cell says so** before anything is asserted into it.
- **Download your own copy** — the reader leaves with a real `.prolog.md`, their edits and
  their answers in it, hashed against the program that produced them.

### Fixed

- **An answer containing variables was not what SWI would print.** `app([1,2], Tail, L)` came
  out as `L = [1,2|_20306],  Tail = _20428` where a toplevel prints `L = [1, 2|Tail]` — the
  same variable shown as two, with the reader's own name for it discarded. Each binding was
  rendered in a separate round trip into Prolog, and two round trips cannot share a variable.
  Prolog now renders the whole answer, once, with the goal's own `variable_names`. Invisible
  until now because every answer in the shipped chapter is a ground atom.
- **A half-walked query was destroyed by running any other cell.** SWI keeps open queries on a
  stack; nothing here released one, and the next query nested inside it. There is now one open
  sequence per engine, and the cell that loses its own is told so in words about the notebook
  rather than about SWI's internals.
- **A `hold` release, a stuck Hide control, and a panel that resized under the cursor** — all
  found by reading the page rather than the tests, which is why `src/notebook.js` now has a
  jsdom harness and the page's behaviour is asserted from Node.
- **A compile error is reported in the cell's own terms**, not as a path the reader never
  chose.

### Changed

- **The engine is pinned exactly** (`swipl-wasm 8.0.7`). Two installs of one release, ten
  minutes apart, ran SWI-Prolog 10.1.10 and 10.1.13 — and a chapter's saved answers are only
  ever true of the engine that produced them. Moving the engine is now a commit with the
  chapters re-run in it.
- Solutions are spelled as SWI's own writer spells them, so compounds gain a space after each
  comma: `foo(1, 2)`, not `foo(1,2)`. Any file with saved answers containing a compound will
  differ on its next `run`.
- `offerDownload()` takes an options object rather than positional arguments.
- The engine is imported where it is used rather than at the top of the CLI, so `--help` still
  works on an install whose WebAssembly is missing.

### Notes

`--check` — run a chapter in CI and fail the build when its answers have drifted — is
deliberately **not** here. It needs a timeout first: the Node engine runs in-process, so a
non-terminating goal hangs the command, and a test suite that can hang forever is not a test
suite. The command says so on every run.

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

- **The page says what the engine is holding.** A program cell's tick carries the time it was
  consulted (`title="consulted at 14:32:05"`, absolute — a relative time baked into an
  attribute is wrong the moment it is written), and flips to **edited since consulted** as soon
  as the textarea diverges from what was actually loaded. That state, not the clock, is the
  reader's real question, and it became easy to get wrong the moment Run started consulting
  cells by itself.
- **Reset, at two scales.** Per cell: restore the chapter's text *and re-consult it*, because
  putting the page back without putting the engine back leaves them disagreeing. Page-level:
  **restart engine**, which throws the worker away and replays the consult log — the documented
  answer for a `:- dynamic` cell whose state lives in no file. Verified in a browser: a counter
  mutated to 41 is 0 again afterwards. Per-cell *unconsult* is deliberately absent; it raises
  "what happens to the cells that depended on it", and page-level restart has no such question.
- **The engine's state is visible**: *engine not started* until something needs it, which is
  also the plainest evidence that a cold chapter is readable without it.
- **The chapter is readable before the engine arrives, and without it.** A query cell renders
  the answers stored in the file — labelled as the chapter's, not the reader's (docs/modes.md
  §3) — and the 5.9 MB WASM bundle is fetched only when someone presses Run. Verified in a
  browser by watching the network: on a cold load there is no request for it at all. This is
  what makes a published chapter degrade to a book rather than to a blank page.
- **Saved answers that no longer follow from the program above them are marked**, before first
  paint and with no engine: the stored `input-hash` is compared against a 64-bit FNV-1a of the
  goal and the program cells preceding it. Marked rather than hidden — never silently
  discarded and never silently trusted.
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

### Fixed

- **The browser session had no `restart()`**, while the in-process one and the README both did
  — found by wiring a button to it. Both sessions now implement one interface, and a test
  compares them, because nothing else could: Node never runs the worker session and a browser
  never runs the other.
- `session.formatSolution()` is **removed** rather than added to the worker session. The
  engine-backed one renders through SWI; a worker-backed one could only fall back to the
  engine-free spelling, so the same call would have quietly meant two different things
  depending on where it ran. Use `query.next().text`, or the exported `formatSolution()`.

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
