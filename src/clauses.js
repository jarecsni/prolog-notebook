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

/**
 * The predicates a cell declares `:- dynamic`, as `name/arity`.
 *
 * WHY THIS IS WORTH KNOWING WITHOUT RUNNING ANYTHING (format §8): a cell that
 * declares one is **stateful**. Its assert/retract state lives in no file, so
 * re-consulting the cell does not undo it and neither does resetting the cell —
 * only throwing the engine away does. That is the one place where the otherwise
 * reliable promise "the clause store self-heals" stops being true, and a reader
 * who does not know it will conclude something false about Prolog rather than
 * about us.
 *
 * Read statically so the page can say so BEFORE the reader has asserted anything,
 * rather than after they are already confused. Shallow like the rest of this file
 * and for the same reason: at worst it fails to warn, and it can never change
 * what a goal does.
 *
 * @param {string} source Prolog text
 * @returns {Set<string>} predicate indicators
 */
export function declaredDynamic(source) {
  const found = new Set();
  for (const body of directives(source)) {
    // `:- dynamic foo/1.` and `:- dynamic(foo/1).` are the same declaration.
    const m = /^dynamic\b\s*(.*)$/s.exec(body);
    if (!m) continue;
    let list = m[1].trim();
    if (list.startsWith('(') && list.endsWith(')')) list = list.slice(1, -1);
    for (const item of splitTopLevel(list)) {
      const indicator = /^\s*(?:'((?:[^'\\]|\\.)*)'|([a-z][a-zA-Z0-9_]*))\s*\/\s*(\d+)\s*$/.exec(item);
      if (indicator) {
        const name = indicator[1] !== undefined ? indicator[1].replace(/\\(.)/g, '$1') : indicator[2];
        found.add(`${name}/${indicator[3]}`);
      }
    }
  }
  return found;
}

/**
 * The body of every `:- …` directive, with comments stripped.
 *
 * Directives wrap across lines far more often than clauses do — a chapter that
 * declares six dynamic predicates will list them one per line — so this cannot be
 * the line scanner the rest of the file uses. It reads to the terminating full
 * stop instead.
 */
function directives(source) {
  const bodies = [];
  const text = stripComments(source);
  const pattern = /(^|\n)\s*:-\s*/g;
  let m;
  while ((m = pattern.exec(text)) !== null) {
    const start = m.index + m[0].length;
    const end = endOfTerm(text, start);
    if (end === -1) break;
    bodies.push(text.slice(start, end).trim());
    pattern.lastIndex = end;
  }
  return bodies;
}

/** Index of the `.` that ends a term, skipping quotes. -1 if it never ends. */
function endOfTerm(text, from) {
  let quote = null;
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    // A full stop ends a term only when whitespace or the end of input follows,
    // which is exactly SWI's own rule — otherwise `1.5` would end one.
    if (c === '.' && (i + 1 === text.length || /\s/.test(text[i + 1]))) return i;
  }
  return -1;
}

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((line) => line.replace(/(^|\s)%.*$/, '$1'))
    .join('\n');
}

/** Split on commas that are not inside brackets or quotes. */
function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 0) { parts.push(text.slice(start, i)); start = i + 1; }
  }
  parts.push(text.slice(start));
  return parts;
}

/** The predicate indicator an "Unknown procedure" error is complaining about. */
export function unknownProcedure(message) {
  const m = /Unknown procedure:\s*(?:[a-z][a-zA-Z0-9_]*:)?((?:'[^']*'|[^\s/]+)\/\d+)/.exec(message ?? '');
  return m ? m[1] : null;
}
