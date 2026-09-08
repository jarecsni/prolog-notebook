// Does this chapter still say what SWI says? (869ectt3n)
//
// Technical books rot because their code stops working and nobody notices for
// two years. A chapter carries its answers in the file, which is what makes it
// readable before the engine arrives — and is also what lets it be WRONG in a way
// nothing catches: the library moves, SWI's spelling changes, the author edits a
// clause above an answer and never reruns it.
//
// So `execute --check` runs everything and writes nothing, and this is the part
// that decides what the verdict is. NO FILESYSTEM AND NO PROCESS IN HERE, for the
// same reason run.js has none: the comparison is worth testing on its own, and CI
// is not the only thing that will ever want to ask this question.
import { hashFor } from './format.js';

/**
 * WHAT COUNTS AS DRIFT, and what only counts as news.
 *
 * The rule comes from tally()'s, because a tool may not hold two opinions about
 * the same file: "a chapter with no answers may be an author who forgot execute
 * or an author who meant it, and nothing here can tell which. It reports; it does
 * not advise." The Captain settled that when `build` wanted to warn about it, and
 * a workbook edition — prolog-studies publishes one — would fail every build if
 * this decided differently.
 *
 * So an empty cell is REPORTED and does not fail. What fails is a chapter that
 * makes a claim which is no longer true:
 *
 *   changed  the saved answers are not the answers SWI gives now
 *   stale    the answers still match, but the program above them has moved, so
 *            the file certifies them against code that is no longer in it
 *
 * Staleness matters even when the text is identical. `withEdits` rehashes what it
 * rewrites, so a run would silently correct the hash; without this, a chapter
 * could go on claiming an answer follows from a program it has never seen.
 *
 * @param {{cells: object[]}} notebook as parsed, with the answers it shipped with
 * @param {Map<string, {output?: object|null}>} edits what a run has just produced
 * @returns {{queries: number, answered: number, changed: object[], stale: object[],
 *   missing: object[]}}
 */
export function drift(notebook, edits) {
  const changed = [];
  const stale = [];
  const missing = [];
  let queries = 0;

  for (const cell of notebook.cells) {
    if (cell.kind !== 'query') continue;
    queries += 1;
    const saved = cell.output;
    // An output block emptied by `clear` is not an answer; it is the shape of
    // one, left behind so the cell keeps its place in a diff. Same test as
    // tally()'s, and for the same reason.
    if (!saved?.solutions?.length && !saved?.terminator) {
      missing.push({ id: cell.id, goal: cell.goal });
      continue;
    }
    const now = edits.get(cell.id)?.output ?? null;
    const difference = firstDifference(saved, now);
    if (difference) changed.push({ id: cell.id, goal: cell.goal, ...difference });
    else if (saved.inputHash && hashFor(notebook, cell) !== saved.inputHash) {
      stale.push({ id: cell.id, goal: cell.goal });
    }
  }

  return { queries, answered: queries - missing.length, changed, stale, missing };
}

/**
 * The first line on which two solution sequences disagree.
 *
 * NAMED, NOT COUNTED. "3 answers differ" sends somebody to a diff to find out
 * what actually happened; one line of each says it here. The pair is a sequence
 * plus its terminator (format §6), and the terminator carries the fact that
 * matters most — `false.` against an answer, or nothing at all, which is the
 * format's way of saying the search was never exhausted.
 *
 * @returns {{line: number, saved: string, now: string}|null} null when they agree
 */
export function firstDifference(saved, now) {
  const was = lines(saved);
  const is = lines(now);
  for (let i = 0; i < Math.max(was.length, is.length); i += 1) {
    if (was[i] !== is[i]) {
      return { line: i + 1, saved: was[i] ?? '(nothing)', now: is[i] ?? '(nothing)' };
    }
  }
  return null;
}

/** A sequence as the lines it is written on, terminator included. */
const lines = (output) => (output
  ? [...(output.solutions ?? []), ...(output.terminator ? [output.terminator] : [])]
  : []);
