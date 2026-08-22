// Browser entry point. The engine runs in a Web Worker, so a query that never
// terminates costs the reader a click on Stop rather than the whole tab.
//
// The 5.9 MB swipl bundle is still fetched by the page's own URL rather than by a
// bundler — the worker is told where to find it.
import { ConsultLog, defaultCellName, unconsult } from './session.js';

export * from './engine.js';
export { ConsultLog } from './session.js';

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
  }

  async #open() {
    if (this.#qid === null) {
      await this.session.start();
      this.#qid = await this.session.send('open', { goal: this.goal });
    }
    return this.#qid;
  }

  async next() {
    if (this.done) return { done: true };
    const qid = await this.#open();
    const result = await this.session.send('next', { qid });
    if (result.done) this.done = true;
    return result;
  }

  async all(limit) {
    if (this.done) return { solutions: [], truncated: false };
    const qid = await this.#open();
    this.done = true;
    return this.session.send('all', { qid, limit });
  }

  async close() {
    if (this.#qid === null || this.done) return;
    this.done = true;
    await this.session.send('close', { qid: this.#qid });
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
