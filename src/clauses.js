// What does this program cell define?
//
// A deliberately shallow reading of Prolog source — clause heads only, no terms,
// no operators, no module qualification. That is not laziness, it is the design:
// the answer is only ever used to IMPROVE AN ERROR MESSAGE that the engine has
// already produced. A head this misses costs a hint; a head it invents costs a
// hint that is wrong about a predicate nobody asked about. Neither can change
// what a query does, which is why a regex is an honest tool here and would not
// be anywhere near the execution path.
//
// DOM-free and engine-free, like format.js: the same reading serves the browser,
// the CLI runner and eventually the `:- dynamic` detection that 869eddzfp needs.

/** `name` and `'quoted name'`, the two spellings of a functor. */
const FUNCTOR = /^(?:'((?:[^'\\]|\\.)*)'|([a-z][a-zA-Z0-9_]*))/;

/**
 * The predicate indicators a cell defines, as `name/arity`.
 *
 * @param {string} source Prolog text
 * @returns {Set<string>}
 */
export function definedPredicates(source) {
  const found = new Set();
  for (const line of clauseStarts(source)) {
    const indicator = headOf(line);
    if (indicator) found.add(indicator);
  }
  return found;
}

/**
 * Lines that can begin a clause.
 *
 * A clause head starts at column 0 — the same rule the notebook format relies on
 * for cells (format §1), and the reason both can be line scanners. Continuation
 * lines of a clause body are indented by every convention in use, including
 * SWI's own portray_clause.
 */
function clauseStarts(source) {
  const lines = [];
  let inBlockComment = false;
  for (const raw of source.split('\n')) {
    let line = raw;
    if (inBlockComment) {
      const end = line.indexOf('*/');
      if (end === -1) continue;
      line = line.slice(end + 2);
      inBlockComment = false;
    }
    // A block comment opening on this line takes the rest of it with it.
    const open = line.indexOf('/*');
    if (open !== -1 && line.indexOf('*/', open) === -1) {
      inBlockComment = true;
      line = line.slice(0, open);
    }
    if (/^\s/.test(line) || line.trim() === '') continue;
    if (line.startsWith('%')) continue;
    // A directive is an instruction to the loader, not a definition. `:- dynamic
    // counter/1.` declares one, but the clauses are still what define it.
    if (line.startsWith(':-') || line.startsWith('?-')) continue;
    lines.push(line);
  }
  return lines;
}

/**
 * `foo(a, b) :- …` → `foo/2`. Null if the line does not start with a functor.
 */
function headOf(line) {
  const m = FUNCTOR.exec(line);
  if (!m) return null;
  const name = m[1] !== undefined ? m[1].replace(/\\(.)/g, '$1') : m[2];
  const rest = line.slice(m[0].length);

  let arity = 0;
  let after = rest;
  if (rest.startsWith('(')) {
    const args = countArguments(rest);
    if (args === null) return null;
    arity = args.count;
    after = rest.slice(args.end + 1);
  }

  // A DCG rule defines a predicate with two extra arguments — the difference list
  // SWI threads through it. `greeting --> [hello]` is greeting/2, and a reader
  // told otherwise would go looking for greeting/0.
  if (/^\s*-->/.test(after)) arity += 2;

  return `${name}/${arity}`;
}

/**
 * Count top-level arguments in `(…)`, respecting nesting and quotes.
 *
 * @returns {{count: number, end: number}|null} null if the parenthesis never closes
 */
function countArguments(text) {
  let depth = 0;
  let count = 1;
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if (c === '(' || c === '[' || c === '{') { depth++; continue; }
    if (c === ')' || c === ']' || c === '}') {
      depth--;
      if (depth === 0) return { count, end: i };
      continue;
    }
    // `foo(a, b)` has two arguments; `foo()` is not valid Prolog, so a comma at
    // depth 1 is always an argument separator.
    if (c === ',' && depth === 1) count++;
  }
  return null;
}

/** The predicate indicator an "Unknown procedure" error is complaining about. */
export function unknownProcedure(message) {
  const m = /Unknown procedure:\s*(?:[a-z][a-zA-Z0-9_]*:)?((?:'[^']*'|[^\s/]+)\/\d+)/.exec(message ?? '');
  return m ? m[1] : null;
}
