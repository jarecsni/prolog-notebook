// The execution core. No DOM, no browser assumptions — this same module backs the
// web renderer, a VS Code notebook controller, and a headless CLI runner.
//
// The engine is SWI-Prolog itself compiled to WebAssembly, so nothing is installed
// and nothing is spawned: the Prolog system runs inside the host process.

let fileSerial = 0;

// SWI reports "Redefined static procedure" and friends by printing to user_error
// and then carrying on, so a consult that quietly destroyed another cell's
// clauses still succeeds. message_hook/3 is the documented way to intercept
// those; failing at the end lets the normal printing happen as well.
const MESSAGE_HOOK = `
:- dynamic '$nb_message'/2.
user:message_hook(_Term, Kind, Lines) :-
    memberchk(Kind, [warning, error]),
    catch(with_output_to(string(S),
                         print_message_lines(current_output, '', Lines)),
          _, S = ''),
    assertz('$nb_message'(Kind, S)),
    fail.
`;

export class PrologSession {
  /**
   * @param {Function} swiplFactory the SWIPL factory from swipl-wasm
   * @param {object} [options] passed through to the factory
   */
  static async create(swiplFactory, options = {}) {
    const module = await swiplFactory({ arguments: ['-q'], ...options });
    const session = new PrologSession(module);
    // No `$` in the path: SWI expands $var in file names like a shell does, so
    // /$nb-hook.pl resolves to nothing and the consult fails silently.
    module.FS.writeFile('/nb-hook.pl', MESSAGE_HOOK);
    module.prolog.query("user:consult('/nb-hook.pl')").once();
    return session;
  }

  constructor(module) {
    this.module = module;
  }

  /**
   * Load a clause base into the `user` module.
   *
   * Each cell should pass its own stable `name`: SWI attributes clauses to the
   * file they came from, so re-consulting the same name replaces exactly that
   * cell's clauses and leaves every other cell alone.
   *
   * @param {string} text Prolog source
   * @param {string} [name] virtual file name; identifies the cell
   * @returns {{ok: boolean, error?: string, messages: {kind: string, text: string}[]}}
   */
  consult(text, name = `cell${fileSerial++}`) {
    const path = `/${name.replace(/\.pl$/, '')}.pl`;
    try {
      this.module.FS.writeFile(path, text);
      this.#drainMessages();
      const r = this.module.prolog.query(`user:consult('${path}')`).once();
      const messages = this.#drainMessages();
      if (r && r.error) return { ok: false, error: r.message, messages };
      // A clause SWI could not read is reported and then skipped, so consult
      // itself still succeeds. Reporting that as "✓ consulted" would leave the
      // reader with a cell that looks loaded and a predicate that is not there.
      const failed = messages.find((m) => m.kind === 'error');
      if (failed) return { ok: false, error: failed.text, messages };
      return { ok: true, messages };
    } catch (e) {
      return { ok: false, error: e.message, messages: [] };
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
    return new PrologQuery(this.module.prolog.query(`user:( ${cleaned} )`), this);
  }

  /**
   * Render a term the way SWI's own top level would, by asking SWI. Worth the
   * round trip: it gets operators (a-b, not -(a,b)), atom quoting and every
   * other rule of the writer right, none of which we want to reimplement.
   * @returns {string}
   */
  formatTerm(term) {
    try {
      const r = this.module.prolog
        .query('term_string(T, S)', { T: toEngineTerm(term) })
        .once();
      const s = r && r.S;
      if (typeof s === 'string') return s;
      if (s && typeof s.v === 'string') return s.v;
    } catch {
      // fall through to the DOM-free renderer below
    }
    return formatTerm(term);
  }

  /** Render a full solution the way a top level would. */
  formatSolution(solution) {
    const pairs = Object.entries(solution);
    if (!pairs.length) return 'true';
    return pairs.map(([k, v]) => `${k} = ${this.formatTerm(v)}`).join(',  ');
  }

  #drainMessages() {
    try {
      const r = this.module.prolog
        .query("user:( findall(m(K,T), '$nb_message'(K,T), L ), retractall('$nb_message'(_,_)) )")
        .once();
      if (!r || !Array.isArray(r.L)) return [];
      return r.L.map((m) => {
        const [kind, text] = argumentsOf(m);
        return { kind: String(kind), text: textOf(text).trim() };
      });
    } catch {
      return [];
    }
  }
}

export class PrologQuery {
  constructor(handle, session) {
    this.handle = handle;
    this.session = session;
    this.exhausted = false;
    this.count = 0;
  }

  /**
   * Pull the next solution.
   *
   * `text` is the solution rendered by SWI itself; prefer it over calling
   * formatSolution, which has no engine to ask and so cannot know about
   * operators or quoting.
   *
   * @returns {{done: boolean, solution?: object, text?: string, error?: string}}
   */
  next() {
    if (this.exhausted) return { done: true };
    let r;
    try {
      r = this.handle.next();
    } catch (e) {
      this.exhausted = true;
      return { done: true, error: readableError(e.message) };
    }
    if (r.error) {
      this.exhausted = true;
      return { done: true, error: readableError(r.message) };
    }

    // The engine can deliver the final solution *together with* done:true — a
    // binding and the end of the search in one step. Reporting `done` without
    // the binding silently loses the last solution.
    const out = { done: !!r.done };
    if (r.value) {
      this.count += 1;
      out.solution = bindingsOf(r.value);
      // Safe while the outer query is still open — verified by stepping a
      // three-solution query with a term_string call between every step.
      if (this.session) out.text = this.session.formatSolution(out.solution);
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

/**
 * Drop the frame that is ours rather than the reader's.
 *
 * SWI prefixes an error with the goal it was raised from, which is usually worth
 * keeping — `//2: Arithmetic: evaluation error` names the division. But every
 * goal we run is wrapped for the WASM boundary, so an unknown predicate reads
 * `wasm:wasm_call_string/3: Unknown procedure: is_son/1`. That prefix is our
 * plumbing in the middle of a teaching page: the reader did not write it, cannot
 * act on it, and it is the same words whatever they got wrong.
 *
 * Only that one frame is removed. Any other context is the reader's own code.
 */
export function readableError(message) {
  return String(message ?? '').replace(/^wasm:wasm_call_string\/\d+:\s*/, '');
}

/**
 * A message about THIS cell, said the way the cell would say it.
 *
 * One cell is one virtual file, so SWI's line numbers are already the cell's own
 * — that half of the problem solved itself. What is left is the path: a reader
 * looking at a syntax error printed on the very cell that caused it does not need
 * to be told which file it was in, and `/p-family.pl` is a filename they never
 * chose and cannot open.
 *
 *   /p-family.pl:4:6: Syntax error: Operator expected
 *   line 4, column 6: Syntax error: Operator expected
 *
 * ONLY THIS CELL'S OWN PATH IS REMOVED, which is the whole reason the name is a
 * parameter rather than a wildcard. A consult warning naming a DIFFERENT cell —
 * "Redefined static procedure male/1", the one that says another cell's clauses
 * have just been destroyed — is only useful because it names that other file, and
 * a regex that stripped any path would delete exactly the part worth reading.
 *
 * @param {string} message
 * @param {string} name the cell's own consult name
 */
export function readableInCell(message, name) {
  const path = `/${String(name ?? '')}.pl:`;
  const text = readableError(message);
  if (!text.startsWith(path)) return text;
  return text
    .slice(path.length)
    .replace(/^(\d+):(\d+):\s*/, 'line $1, column $2: ')
    .replace(/^(\d+):\s*/, 'line $1: ');
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

// swipl-wasm tags every non-atomic value it hands back:
//   compound  { $t: 't', functor: 'f', f: [[arg, ...]] }
//   string    { $t: 's', v: 'text' }
//   variable  { $t: 'v', v: '_123' }
//   rational  { $t: 'r', n, d }
//   list      { $t: 'l', v: [...], tail }
// Note the compound's arguments live under the key NAMED BY THE FUNCTOR, and
// arrive wrapped in one extra array — swipl-wasm builds them with
// `new Compound(name, args)` against a `(name, ...args)` signature. Its own
// arguments()/arity()/arg() accessors are wrong for the same reason, so read
// the arguments here rather than trusting them.
export function argumentsOf(term) {
  if (!term || typeof term !== 'object' || !term.functor) return [];
  const raw = term[term.functor];
  if (!Array.isArray(raw)) return [];
  return raw.length === 1 && Array.isArray(raw[0]) ? raw[0] : raw;
}

/**
 * Undo the extra wrapping so a term can be handed back to the engine.
 * swipl-wasm's JS-to-Prolog direction expects `term[functor]` to BE the
 * argument list, which is not what its Prolog-to-JS direction produces — round
 * tripping an untouched term turns point(1,2) into point([1,2]).
 */
export function toEngineTerm(v) {
  if (Array.isArray(v)) return v.map(toEngineTerm);
  if (!v || typeof v !== 'object') return v;
  if (v.$t !== 't' || !v.functor) return v;
  return { $t: 't', functor: v.functor, [v.functor]: argumentsOf(v).map(toEngineTerm) };
}

/** The text of a Prolog string, which arrives tagged rather than as a JS string. */
export function textOf(v) {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object' && typeof v.v === 'string') return v.v;
  return String(v);
}

/**
 * Render a term without an engine to ask.
 *
 * This is the fallback: it writes compounds in canonical functional notation,
 * so `a-b` comes out as `-(a, b)`. Correct, but not what a top level shows —
 * prefer PrologSession#formatTerm whenever a session is at hand.
 */
export function formatTerm(v) {
  if (v === null || v === undefined) return '_';
  if (Array.isArray(v)) return `[${v.map(formatTerm).join(', ')}]`;
  if (typeof v === 'object') {
    switch (v.$t) {
      case 't': return `${v.functor}(${argumentsOf(v).map(formatTerm).join(', ')})`;
      case 's': return `"${textOf(v)}"`;
      case 'v': return String(v.v ?? '_');
      case 'r': return `${v.d}r${v.n}`;
      case 'l': {
        const items = (v.v || []).map(formatTerm).join(', ');
        return v.tail === undefined ? `[${items}]` : `[${items}|${formatTerm(v.tail)}]`;
      }
      default: break;
    }
    if (v.functor) return `${v.functor}(${argumentsOf(v).map(formatTerm).join(', ')})`;
    return JSON.stringify(v);
  }
  return String(v);
}
