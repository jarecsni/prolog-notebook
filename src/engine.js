// The execution core. No DOM, no browser assumptions — this same module backs the
// web renderer, a VS Code notebook controller, and a headless CLI runner.
//
// The engine is SWI-Prolog itself compiled to WebAssembly, so nothing is installed
// and nothing is spawned: the Prolog system runs inside the host process.

let fileSerial = 0;

export class PrologSession {
  /**
   * @param {Function} swiplFactory the SWIPL factory from swipl-wasm
   * @param {object} [options] passed through to the factory
   */
  static async create(swiplFactory, options = {}) {
    const module = await swiplFactory({ arguments: ['-q'], ...options });
    return new PrologSession(module);
  }

  constructor(module) {
    this.module = module;
  }

  /**
   * Load a clause base into the `user` module.
   * @param {string} text Prolog source
   * @returns {{ok: boolean, error?: string}}
   */
  consult(text, name = `cell${fileSerial++}`) {
    const path = `/${name}.pl`;
    try {
      this.module.FS.writeFile(path, text);
      const r = this.module.prolog.query(`user:consult('${path}')`).once();
      if (r && r.error) return { ok: false, error: r.message };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  /**
   * Open a query. Solutions are pulled one at a time — this is Prolog, not a
   * function call, and stepping the solutions is usually the point.
   * @param {string} goal
   * @returns {PrologQuery}
   */
  query(goal) {
    // Cells consult into `user`, but prolog.query/1 runs with `system` as the
    // context module, so an unqualified goal resolves against the wrong one.
    const cleaned = goal.trim().replace(/\.$/, '');
    return new PrologQuery(this.module.prolog.query(`user:( ${cleaned} )`));
  }
}

export class PrologQuery {
  constructor(handle) {
    this.handle = handle;
    this.exhausted = false;
    this.count = 0;
  }

  /**
   * Pull the next solution.
   * @returns {{done: boolean, solution?: object, error?: string}}
   */
  next() {
    if (this.exhausted) return { done: true };
    let r;
    try {
      r = this.handle.next();
    } catch (e) {
      this.exhausted = true;
      return { done: true, error: e.message };
    }
    if (r.error) {
      this.exhausted = true;
      return { done: true, error: r.message };
    }

    // The engine can deliver the final solution *together with* done:true — a
    // binding and the end of the search in one step. Reporting `done` without
    // the binding silently loses the last solution.
    const out = { done: !!r.done };
    if (r.value) {
      this.count += 1;
      out.solution = bindingsOf(r.value);
    }
    if (r.done) this.exhausted = true;
    return out;
  }

  /**
   * Drain the query. `limit` guards against a genuinely infinite generator.
   * @returns {{solutions: object[], error?: string, truncated: boolean}}
   */
  all(limit = 1000) {
    const solutions = [];
    let error;
    while (!this.exhausted && solutions.length < limit) {
      const r = this.next();
      if (r.solution) solutions.push(r.solution);
      if (r.error) error = r.error;
    }
    return { solutions, error, truncated: !this.exhausted };
  }
}

/** Strip the engine's bookkeeping keys from a solution. */
export function bindingsOf(value) {
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (k === '$tag' || k === 'success') continue;
    out[k] = v;
  }
  return out;
}

/** Render a solution the way a Prolog top level would. */
export function formatSolution(solution) {
  const pairs = Object.entries(solution);
  if (!pairs.length) return 'true';
  return pairs.map(([k, v]) => `${k} = ${formatTerm(v)}`).join(',  ');
}

export function formatTerm(v) {
  if (v === null || v === undefined) return '_';
  if (Array.isArray(v)) return `[${v.map(formatTerm).join(', ')}]`;
  if (typeof v === 'object') {
    if (v.$tag === 'string') return `"${v.text}"`;
    if (v.functor) return `${v.functor}(${(v.args || []).map(formatTerm).join(', ')})`;
    if (v.v !== undefined) return `_${v.v}`;
    return JSON.stringify(v);
  }
  return String(v);
}
