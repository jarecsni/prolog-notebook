// The execution core. No DOM, no browser assumptions — this same module backs the
// web renderer, a VS Code notebook controller, and a headless CLI runner.
//
// The engine is SWI-Prolog itself compiled to WebAssembly, so nothing is installed
// and nothing is spawned: the Prolog system runs inside the host process.

let fileSerial = 0;

// What we teach the engine about itself, consulted once at startup.
//
// TWO THINGS, and both are about telling the truth to a reader.
//
// 1. SWI reports "Redefined static procedure" and friends by printing to
//    user_error and then carrying on, so a consult that quietly destroyed
//    another cell's clauses still succeeds. message_hook/3 is the documented way
//    to intercept those; failing at the end lets the normal printing happen too.
//
// 2. AN ANSWER IS RENDERED BY PROLOG, NOT BY US. Formatting each binding in a
//    separate round trip loses the one thing a Prolog answer is mostly about —
//    which variables are the SAME variable. `app([1,2], Tail, L)` really does
//    print `L = [1, 2|Tail]` at a toplevel, and we printed
//    `L = [1,2|_20306],  Tail = _20428`: two differently-numbered variables
//    where there is one, with the reader's own name for it thrown away
//    (869erjw27). For a chapter about partial lists that is the opposite of the
//    lesson.
//
// The rule the toplevel follows, and this reproduces: a variable is NAMED by the
// last binding that mentions it, and that binding is then omitted — so `X = Y`
// prints as `X = Y`, and an unbound `Tail` disappears from the list of bindings
// and reappears inside `L`. Anything still unnamed becomes _A, _B, … as SWI does.
const HOOK = String.raw`
:- dynamic '$nb_message'/2.
user:message_hook(_Term, Kind, Lines) :-
    memberchk(Kind, [warning, error]),
    catch(with_output_to(string(S),
                         print_message_lines(current_output, '', Lines)),
          _, S = ''),
    assertz('$nb_message'(Kind, S)),
    fail.

% One solution: the text a toplevel would print, and the bindings by name.
% The goal arrives as a STRING BOUND TO A VARIABLE, never interpolated into this
% query, so a goal containing quotes or brackets needs no escaping anywhere.
'$nb_answer'(GoalText, Text, Names, Values) :-
    read_term_from_atom(GoalText, Goal, [variable_names(Bindings)]),
    call(Goal),
    '$nb_render'(Bindings, Text),
    findall(N, member(N=_, Bindings), Names),
    findall(V, member(_=V, Bindings), Values).

'$nb_render'(Bindings, Text) :-
    '$nb_names'(Bindings, Bindings, Named),
    exclude('$nb_named_itself'(Named), Bindings, Shown),
    (   Shown == []
    ->  Text = true
    ;   '$nb_anonymous'(Shown, Named, All),
        maplist('$nb_pair'(All), Shown, Parts),
        % An ATOM, not a string: swipl-wasm hands an atom to JavaScript as a
        % plain string and a Prolog string as a wrapper object, and one
        % representation crossing the boundary is one fewer thing to unwrap.
        atomic_list_concat(Parts, ',  ', Text)
    ).

% Each unbound variable takes the LAST name bound to it.
'$nb_names'([], _, []).
'$nb_names'([Name=Value|T], All, Named) :-
    (   var(Value),
        '$nb_last_name'(All, Value, Name)
    ->  Named = [Name=Value|Rest]
    ;   Named = Rest
    ),
    '$nb_names'(T, All, Rest).

'$nb_last_name'(All, Var, Name) :-
    findall(N, (member(N=V, All), V == Var), Names),
    last(Names, Name).

% A binding that only says "this variable is called what it is called".
'$nb_named_itself'(Named, Name=Value) :-
    var(Value),
    member(N=V, Named),
    V == Value,
    N == Name.

'$nb_anonymous'(Shown, Named, All) :-
    term_variables(Shown, Vars),
    exclude('$nb_has_name'(Named), Vars, Unnamed),
    findall(A, ( between(0'A, 0'Z, C), char_code(Ch, C), atom_concat('_', Ch, A) ), Alphabet),
    '$nb_zip'(Unnamed, Alphabet, Extra),
    append(Named, Extra, All).

'$nb_has_name'(Named, Var) :- member(_=V, Named), V == Var.

'$nb_zip'([], _, []).
'$nb_zip'([V|Vs], [N|Ns], [N=V|T]) :- '$nb_zip'(Vs, Ns, T).

'$nb_pair'(Names, Name=Value, Part) :-
    with_output_to(string(S),
        write_term(Value, [ quoted(true), portray(true), numbervars(true),
                            spacing(next_argument), variable_names(Names) ])),
    format(atom(Part), '~w = ~w', [Name, S]).
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
    module.FS.writeFile('/nb-hook.pl', HOOK);
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
    // The goal is BOUND, not interpolated: `'$nb_answer'` reads it in the `user`
    // module (where cells consult) and renders each solution there, so operators,
    // quoting and shared variables are SWI's own work rather than ours. It also
    // means a goal containing quotes or brackets needs no escaping at any point.
    const cleaned = goal.trim().replace(/\.$/, '');
    const handle = this.module.prolog.query(
      "user:'$nb_answer'(G, Text, Names, Values)",
      { G: cleaned }
    );
    return new PrologQuery(handle, this);
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
    // Ended by something other than its own search — see close(). Kept apart from
    // `exhausted` because "the search finished" and "we stopped it" are different
    // facts, and only the first may ever be written down as `false.` (format §6).
    this.superseded = false;
    this.count = 0;
  }

  /**
   * Give the query frame back to the engine.
   *
   * SWI KEEPS OPEN QUERIES ON A STACK, and swipl-wasm enforces it: both
   * `next()` and `close()` call `__must_be_innermost_query`, which throws
   * "Attempt to access not innermost query". An abandoned query is therefore not
   * merely untidy — it is a frame every later query has to nest inside, and the
   * abandoned one can never be stepped again (869epzqpc).
   *
   * Nothing else releases it. Running the search to `done` does, because
   * swipl-wasm closes the query itself at that point, which is why a drained
   * sequence costs nothing. Everything else must come through here.
   *
   * @param {{superseded?: boolean}} [options] `superseded` when the session
   *   closed this to make room for another query rather than the caller being
   *   finished with it. It changes what next() reports, and it must: a caller
   *   that reads plain `done` concludes the search was exhausted.
   */
  close({ superseded = false } = {}) {
    if (superseded) this.superseded = true;
    if (this.exhausted) return;
    this.exhausted = true;
    this.handle.close();
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
    // `superseded` travels with the done, because a closed query and an exhausted
    // one are indistinguishable from `{done: true}` alone — and the difference is
    // whether the caller may write `false.` under it.
    if (this.exhausted) return this.superseded ? { done: true, superseded: true } : { done: true };
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
      // `Text` is what a toplevel would print for this solution, rendered inside
      // Prolog (see HOOK). `Names`/`Values` are the same answer as data, for a
      // caller that wants the bindings rather than the line.
      out.text = r.value.Text;
      out.solution = zipBindings(r.value.Names, r.value.Values);
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
  return String(message ?? '')
    .replace(/^wasm:wasm_call_string\/\d+:\s*/, '')
    // Our own wrapper, which the reader did not write and cannot act on. It is
    // the same plumbing argument as the frame above: `'$nb_answer'/4: Unknown
    // procedure: son_a/1` names a predicate of ours in the middle of a teaching
    // page.
    .replace(/^'\$nb_answer'\/\d+:\s*/, '');
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
/**
 * The query's own variable names, against their values.
 *
 * Two parallel lists rather than a list of `Name=Value` terms, because a term
 * would have to be taken apart on this side and the lists arrive as arrays
 * already. Order is the order the variables appear in the goal, which is the
 * order a toplevel reports them in.
 */
export function zipBindings(names = [], values = []) {
  const out = {};
  names.forEach((name, i) => { out[name] = values[i]; });
  return out;
}

export function bindingsOf(value) {
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (k === '$tag' || k === 'success') continue;
    out[k] = v;
  }
  return out;
}

/**
 * Which SWI-Prolog this is.
 *
 * Worth asking, and not derivable from anything on disk: swipl-wasm 8.0.4 ships
 * SWI-Prolog 10.1.10, and the two numbers have no relationship at all. A
 * chapter's saved answers are only true of the engine that produced them, so
 * the version is part of their attribution rather than a footnote.
 *
 * `version` rather than `version_git`: the integer flag is always present, and
 * its encoding is documented — MAJOR*10000 + MINOR*100 + PATCH.
 *
 * @param {{query: Function}} session any session, in either environment
 * @returns {Promise<string|null>} e.g. "10.1.10", or null if the engine will not say
 */
export async function prologVersion(session) {
  try {
    const result = await session.query('current_prolog_flag(version, V)').all(1);
    const encoded = result.solutions?.[0]?.V;
    if (!Number.isInteger(encoded)) return null;
    return `${Math.floor(encoded / 10000)}.${Math.floor(encoded / 100) % 100}.${encoded % 100}`;
  } catch {
    return null;
  }
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
