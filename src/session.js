// The async session interface, and the in-process implementation of it.
//
// Everything above the engine talks to this, never to PrologSession directly. The
// methods return promises whether or not the work is actually asynchronous,
// because one of the two implementations runs the engine in a worker and the
// other does not, and a caller that has to know which is a caller that will one
// day be ported wrongly.
//
//     await session.consult(text, 'cell-p-family')
//     const query = session.query('is_son(X)')
//     let r; while (!(r = await query.next()).done) …
//     await session.abort()
//
// WHY ASYNC AT ALL: a Prolog query is synchronous WASM, so a non-terminating goal
// blocks whatever thread it runs on — no timer fires, no button responds, nothing
// repaints. Non-termination is chapter material in a Prolog book, so the engine
// has to live somewhere that can be terminated. See docs/modes.md and 869ejgkfq.

/**
 * What every session replays after an abort.
 *
 * Abort is "throw the engine away and build a new one", which is only affordable
 * because of a decision already made: one cell, one virtual file (869eddzfp), so
 * the clause store is rebuilt from the cells in about 3.5 ms each. Nothing
 * cooperative has to reach inside a running Prolog goal.
 *
 * Insertion order is document order, which is also execution order.
 */
export class ConsultLog {
  constructor() {
    this.entries = new Map();
  }

  record(name, text) {
    // Re-consulting a cell replaces it, exactly as SWI does, so the log holds one
    // entry per cell rather than a history of edits.
    this.entries.set(name, text);
  }

  forget(name) {
    this.entries.delete(name);
  }

  /**
   * Is this cell already loaded, at exactly this text?
   *
   * What makes "Run consults the cells above it" cheap enough to do on every
   * click: the second Run of a chapter consults nothing, because nothing has
   * changed. An edited cell answers false for itself and only for itself.
   */
  isCurrent(name, text) {
    return this.entries.has(name) && this.entries.get(name) === text;
  }

  clear() {
    this.entries.clear();
  }

  *[Symbol.iterator]() {
    for (const [name, text] of this.entries) yield { name, text };
  }
}

let anonymousCells = 0;

/**
 * A consult with no cell name still needs a stable one, or the replay log cannot
 * key it and an abort would lose it.
 */
export function defaultCellName() {
  return `cell-anon-${++anonymousCells}`;
}

/**
 * A session that runs the engine on the caller's own thread.
 *
 * Correct, simple, and NOT protected: a non-terminating goal hangs the process,
 * because there is no second thread to notice. That is acceptable for Node — the
 * CLI is not an interactive page and CI has its own timeouts — and it is stated
 * here rather than implied, so nobody discovers it in a browser.
 */
export class InProcessSession {
  /**
   * @param {import('./engine.js').PrologSession} engine
   * @param {() => Promise<import('./engine.js').PrologSession>} rebuild
   */
  constructor(engine, rebuild) {
    this.engine = engine;
    this.rebuild = rebuild;
    this.log = new ConsultLog();
  }

  async consult(text, name = defaultCellName()) {
    const result = this.engine.consult(text, name);
    if (result.ok) this.log.record(name, text);
    return result;
  }

  query(goal) {
    return new InProcessQuery(this.engine.query(goal));
  }

  /**
   * Discard the engine and replay the consults into a fresh one.
   *
   * In-process this can only happen BETWEEN operations — a goal that is already
   * looping has the thread and will not give it back. Use the worker-backed
   * session where that matters.
   */
  async restart() {
    this.engine = await this.rebuild();
    for (const { name, text } of this.log) this.engine.consult(text, name);
  }

  async abort() {
    return this.restart();
  }

  async close() {}
}

// No formatSolution() on a session, deliberately. The engine-backed one renders
// through SWI itself and the worker-backed one could not — it would have to fall
// back to the engine-free spelling, so the same call would quietly mean two
// different things depending on where it ran. Use `query.next().text`, which SWI
// renders in both, or the exported formatSolution() when there is no engine at all.

class InProcessQuery {
  constructor(query) {
    this.query = query;
  }

  async next() {
    return this.query.next();
  }

  async all(limit) {
    return this.query.all(limit);
  }

  async close() {}
}
