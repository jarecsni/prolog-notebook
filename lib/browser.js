// Browser entry point. The engine runs in a Web Worker, so a query that never
// terminates costs the reader a click on Stop rather than the whole tab.
//
// The 5.9 MB swipl bundle is still fetched by the page's own URL rather than by a
// bundler — the worker is told where to find it.
import { ConsultLog, defaultCellName, unconsult } from './session.js';

export * from './engine.js';
export { ConsultLog } from './session.js';

/**
 * WHERE A PAGE SERVED OUT OF THIS REPO FINDS THE ENGINE — and only such a page.
 *
 * The same-looking literal in build.js was a bug: it guessed at a node_modules
 * layout npm does not use, so `build` could not find the engine when the tool was
 * installed (869erzf1j). This one is NOT that bug, and must not be "fixed" into a
 * new one. There is no module resolution in a browser to ask instead, and every
 * caller that ships — the app.js of a built page — passes `swiplUrl` outright. So
 * this default is reached in exactly one situation: a page served from the repo
 * root by `npm run dev`, where `../node_modules/…` from `/src/` is the truth.
 */
const DEFAULT_SWIPL_URL = new URL(
  '../node_modules/swipl-wasm/dist/swipl/swipl-bundle.js',
  import.meta.url
).href;

/**
 * A session whose engine lives in a worker.
 *
 * Every method returns a promise. `abort()` terminates the worker outright and
 * replays the consult log into a new one, which is the only thing that works: a
 * thread blocked inside WASM cannot be asked politely to stop.
 */
export class WorkerSession {
  #worker = null;
  #pending = new Map();
  #nextId = 1;
  #booting = null;
  /** The one query allowed to hold a frame. See supersede(). */
  #open = null;

  constructor({ workerUrl, swiplUrl = DEFAULT_SWIPL_URL, engineUrl, options = {} } = {}) {
    this.workerUrl = workerUrl ?? new URL('./worker.js', import.meta.url).href;
    this.swiplUrl = swiplUrl;
    // The worker imports the engine itself, so it needs an absolute URL: a
    // relative specifier would resolve against the worker script, which may have
    // been served from anywhere.
    this.engineUrl = engineUrl ?? new URL('./engine.js', import.meta.url).href;
    this.options = options;
    this.log = new ConsultLog();
  }

  /** Boot the worker and the engine inside it. Idempotent. */
  async start() {
    if (this.#worker) return this;
    if (this.#booting) return this.#booting;
    this.#booting = (async () => {
      this.#spawn();
      await this.#send('boot', {
        swiplUrl: this.swiplUrl,
        engineUrl: this.engineUrl,
        options: this.options,
      });
      this.#booting = null;
      return this;
    })();
    return this.#booting;
  }

  async consult(text, name = defaultCellName()) {
    await this.start();
    const result = await this.#send('consult', { text, name });
    if (result.ok) this.log.record(name, text);
    return result;
  }

  /**
   * Open a query. Nothing runs until the first `next()` or `all()`, so opening
   * one is always safe even if the goal is a disaster.
   */
  query(goal) {
    return new WorkerQuery(this, goal);
  }

  /**
   * ONE OPEN SEQUENCE PER SESSION, and the reason is not tidiness.
   *
   * SWI keeps open queries on a stack and swipl-wasm enforces it: stepping or
   * closing anything but the innermost throws "Attempt to access not innermost
   * query". A page cannot promise the order — the order is whatever the reader
   * clicks — so the constraint is met by construction instead: there is never
   * more than one open query, which means the one being closed is always the
   * innermost, which means the close is always legal (869epzqpc).
   *
   * Called at the moment a frame is about to be opened, never when the query
   * OBJECT is made: a cell whose Run fails before it ever steps must not end
   * someone else's sequence for nothing.
   *
   * @internal
   */
  async supersede() {
    const previous = this.#open;
    this.#open = null;
    if (!previous) return;
    await previous.close({ superseded: true });
    // Said only after the frame is actually gone, so a listener that starts a new
    // query cannot race the close it was told about.
    previous.onSuperseded?.();
  }

  /** @internal a query's frame is gone — exhausted, closed, or died with the engine. */
  release(query) {
    if (this.#open === query) this.#open = null;
  }

  /** @internal a query has just taken the session's one frame. */
  hold(query) {
    this.#open = query;
  }

  /** Take one cell's clauses back out. See unconsult() in session.js. */
  async unconsult(name) {
    return unconsult(this, name);
  }

  /**
   * Throw the engine away and rebuild it from the consult log.
   *
   * Terminating is not a last resort here, it is the mechanism: it reclaims the
   * whole WASM heap as well as the stuck goal, so a memory blow-up and an
   * infinite loop have the same cure.
   *
   * A `:- dynamic` cell's assert/retract state does not survive this, which is
   * already the documented behaviour of "restart engine and run all"
   * (format §8) rather than a new surprise.
   */
  async restart() {
    this.#teardown(new Error('aborted'));
    // Every frame died with the worker, so nothing is holding the session's.
    this.#open = null;
    await this.start();
    for (const { name, text } of this.log) {
      await this.#send('consult', { text, name });
    }
  }

  /**
   * Stop whatever is running. Identical to restart() here, and named separately
   * because the two are different intentions: one rescues a page, the other
   * throws away assert/retract state deliberately.
   */
  async abort() {
    return this.restart();
  }

  async close() {
    this.#teardown(new Error('session closed'));
  }

  #spawn() {
    // Classic, not module: swipl-wasm has no ESM entry, and importScripts is the
    // only way to get its global. See the comment at the top of worker.js.
    this.#worker = new Worker(this.workerUrl);
    this.#worker.onmessage = ({ data }) => {
      const entry = this.#pending.get(data.id);
      if (!entry) return;
      this.#pending.delete(data.id);
      if (data.ok) entry.resolve(data.value);
      else entry.reject(new Error(data.error));
    };
    this.#worker.onerror = (event) => {
      this.#teardown(new Error(event.message ?? 'worker failed'));
    };
  }

  #teardown(reason) {
    this.#open = null;
    this.#worker?.terminate();
    this.#worker = null;
    this.#booting = null;
    // Anything still waiting will never hear back, so say so rather than leaving
    // a promise dangling forever — a silent hang is what this whole change exists
    // to remove.
    for (const { reject } of this.#pending.values()) reject(reason);
    this.#pending.clear();
  }

  #send(op, args = {}) {
    if (!this.#worker) return Promise.reject(new Error('worker is not running'));
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#worker.postMessage({ id, op, ...args });
    });
  }

  /** @internal */
  send(op, args) {
    return this.#send(op, args);
  }
}

class WorkerQuery {
  #qid = null;

  constructor(session, goal) {
    this.session = session;
    this.goal = goal;
    this.done = false;
    // Ended by another query taking the session's one frame, rather than by its
    // own search finishing. Kept apart from `done` because only one of the two
    // may ever be written down as an exhausted search (format §6).
    this.superseded = false;
    /** Set by the caller to hear that its sequence was closed for another one. */
    this.onSuperseded = null;
  }

  async #open() {
    if (this.#qid === null) {
      await this.session.start();
      // Before the frame exists, never after: once a second query is open the
      // first is no longer innermost and can never be closed at all.
      await this.session.supersede();
      this.#qid = await this.session.send('open', { goal: this.goal });
      this.session.hold(this);
    }
    return this.#qid;
  }

  async next() {
    if (this.done) return this.superseded ? { done: true, superseded: true } : { done: true };
    const qid = await this.#open();
    const result = await this.session.send('next', { qid });
    // The worker forgets a query that reports done — swipl-wasm has closed it —
    // so the frame is already back and nothing here needs to ask for it.
    if (result.done) this.#finish();
    return result;
  }

  async all(limit) {
    if (this.done) return { solutions: [], truncated: false };
    const qid = await this.#open();
    try {
      return await this.session.send('all', { qid, limit });
    } finally {
      // AFTER THE WORKER HAS ANSWERED, not before. Releasing the session's one
      // slot up front said "nothing is open here" while the engine was still
      // inside the goal, so anything that opened next nested inside a frame the
      // session had already forgotten (869erqvzu). The slot is the claim that
      // this query is the innermost one, and that stays true until it is done.
      this.#finish();
    }
  }

  async close({ superseded = false } = {}) {
    if (superseded) this.superseded = true;
    if (this.#qid === null || this.done) {
      this.#finish();
      return;
    }
    this.#finish();
    await this.session.send('close', { qid: this.#qid });
  }

  #finish() {
    this.done = true;
    this.session.release(this);
  }
}

let shared = null;

/**
 * Boot (once) and return the shared session for this page.
 * @returns {Promise<WorkerSession>}
 */
export function createSession(options = {}) {
  if (!shared) shared = new WorkerSession(options).start();
  return shared;
}
