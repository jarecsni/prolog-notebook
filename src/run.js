// Execute a notebook with no browser: consult every program cell, run every
// query, and hand back the answers in the format's own spelling.
//
// This is the other half of "a chapter is readable before the engine arrives"
// (869ectt0y). That property is worth nothing unless something fills the answers
// in, and doing it by hand is both tedious and dishonest — a hand-written output
// block is the author's guess at what SWI prints, published as though it ran
// (869ectt38, 869ectt3e).
//
// NO FILESYSTEM AND NO PROCESS IN HERE. It takes a parsed notebook and a session
// and returns edits, which is what makes it testable without a CLI, reusable by
// `--check` (869ectt3n), and portable to a VS Code "run all" that has neither a
// terminal nor a working directory.
import { solutionSequence } from './format.js';

/**
 * How many solutions to take from one query before stopping.
 *
 * A limit is not optional: `length(L, N)` has infinitely many solutions and a
 * lists chapter will contain something like it on purpose. Stopping is recorded
 * honestly — a sequence with no terminator says the search was never exhausted
 * (format §6) — so a truncated cell tells the truth rather than claiming to be
 * complete.
 *
 * 100 rather than 500: this number ends up IN THE FILE, and a chapter whose
 * saved answers run to hundreds of lines is a chapter nobody reads. The browser's
 * `all` guard is a different question with a different answer.
 */
export const DEFAULT_LIMIT = 100;

/**
 * Run every cell in document order.
 *
 * Document order is execution order, which is the same rule the page follows: a
 * query runs against the program cells ABOVE it. So there is no dependency graph
 * here either — Prolog has no load-time name binding, and at a few milliseconds
 * a cell there would be nothing to gain from one.
 *
 * @param {{frontMatter: Map<string, string>, cells: object[]}} notebook
 * @param {{consult: Function, query: Function}} session
 * @param {{limit?: number, onCell?: (event: object) => void}} [options]
 *   `onCell` hears each cell begin and finish, so a CLI can report progress
 *   without this module knowing what a terminal is — and so something watching
 *   for a runaway goal can name the cell that stopped answering.
 * @returns {Promise<{edits: Map<string, object>, failures: object[], warnings: object[]}>}
 */
export async function runNotebook(notebook, session, options = {}) {
  const { limit = DEFAULT_LIMIT, onCell = () => {} } = options;
  const edits = new Map();
  const failures = [];
  const warnings = [];

  for (const cell of notebook.cells) {
    if (cell.kind !== 'program' && cell.kind !== 'query') continue;
    // ANNOUNCED BEFORE IT RUNS, not only after (869ejgyax). A cell that never
    // finishes is exactly the one worth naming, and it can only be named by
    // something that heard it start.
    onCell({ kind: 'begin', id: cell.id, of: cell.kind, goal: cell.goal ?? null });
    if (cell.kind === 'program') {
      const result = await session.consult(cell.source, cell.id);
      for (const message of result.messages ?? []) {
        // Usually one cell has just destroyed another cell's clauses, which is
        // invisible in a file and expensive to discover in a published chapter.
        if (message.kind === 'warning') warnings.push({ id: cell.id, text: message.text });
      }
      if (!result.ok) {
        // A query below a cell that did not load answers a question nobody asked,
        // so this is reported rather than run past. The caller decides whether to
        // stop; nothing is written by this module either way.
        failures.push({ id: cell.id, error: result.error });
      }
      onCell({ kind: 'program', id: cell.id, ok: result.ok, error: result.error ?? null });
      continue;
    }

    const run = await runQuery(session, cell.goal, limit);
    edits.set(cell.id, { output: solutionSequence(run) });
    onCell({ kind: 'query', id: cell.id, goal: cell.goal, ...run });
  }

  return { edits, failures, warnings };
}

/**
 * Take up to `limit` solutions from one goal.
 *
 * Solutions are kept as SWI RENDERED THEM — `next().text` comes from the engine's
 * own writer, so operators, quoting and partial lists are right. Reconstructing
 * them from the bindings would produce a file whose answers are subtly not the
 * ones a reader gets when they press Run.
 *
 * @returns {Promise<{solutions: string[], exhausted: boolean, error: string|null, truncated: boolean}>}
 */
async function runQuery(session, goal, limit) {
  const query = session.query(goal);
  const solutions = [];
  let exhausted = false;
  let error = null;

  try {
    while (solutions.length < limit) {
      const result = await query.next();
      // The engine can deliver the last solution TOGETHER with done, so the
      // binding is taken before the ending is acted on.
      if (result.solution) solutions.push(result.text ?? formatBindings(result.solution));
      if (result.error) {
        error = result.error;
        break;
      }
      if (result.done) {
        exhausted = true;
        break;
      }
    }
  } catch (e) {
    error = e.message;
  }

  // Not tidiness: SWI keeps open queries on a stack, and a query abandoned at the
  // limit would leave a frame that every later cell nests inside (869epzqpc). The
  // session enforces one open query, so this is belt and braces — but the belt is
  // what lets a chapter of fifty cells run at all.
  if (!exhausted && !error) await query.close();

  return { solutions, exhausted, error, truncated: !exhausted && !error };
}

/** Last resort when a session renders nothing itself. Never used in-process. */
function formatBindings(solution) {
  const pairs = Object.entries(solution);
  if (!pairs.length) return 'true';
  return pairs.map(([name, value]) => `${name} = ${String(value)}`).join(',  ');
}
