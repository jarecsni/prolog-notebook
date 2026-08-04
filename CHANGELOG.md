# Changelog

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
