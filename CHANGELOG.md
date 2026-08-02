# Changelog

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
