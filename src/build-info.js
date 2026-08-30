// Which copy of this you are actually running.
//
// A version number answers "which release"; it does not answer "which of the
// four things on this machine claiming to be 0.2.0". A published install, a
// checkout with the branch still on it, and an npm-linked working copy with
// uncommitted edits are three different programs, and a bug report against the
// wrong one costs an afternoon.
//
// TWO STATES, NAMED, because they are not the same claim:
//
//   Build ccf8e5b, committed 2026-08-30, packaged 2026-08-30
//   Working copy ccf8e5b (modified), committed 2026-08-30
//
// The first is baked in by the release workflow just before publish — git exists
// there and does not exist inside an installed package. The second is read from
// git at run time, and says `(modified)` when the tree has edits, because a bare
// SHA over a dirty tree names a program that nobody has.
//
// NOTHING IS BUILT HERE. The package is plain ES modules, published as written,
// so "packaged" is the honest word for the third date — there is no compiler and
// no output to date-stamp. A working copy has no packaging time at all, which is
// why the second state has two fields rather than three.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/** Where prepack leaves the facts. Inside `src`, so `files` already ships it. */
const BAKED = new URL('./build-info.json', import.meta.url);

/**
 * The provenance line, or null when nothing is known.
 *
 * Pure, so both states can be tested without a filesystem or a git repository.
 *
 * @param {{commit: string, committed: string, packaged?: string, modified?: boolean}|null} info
 * @returns {string|null}
 */
export function buildLine(info) {
  if (!info?.commit) return null;
  if (info.packaged) {
    return `Build ${info.commit}, committed ${info.committed}, packaged ${info.packaged}`;
  }
  return `Working copy ${info.commit}${info.modified ? ' (modified)' : ''}, committed ${info.committed}`;
}

/**
 * What this copy is, from whichever of the two sources exists.
 *
 * Null rather than a guess when neither does — a tarball built before any of
 * this existed, or a source tree with no history. A line that says "unknown"
 * three times is worse than no line.
 *
 * @returns {{commit: string, committed: string, packaged?: string, modified?: boolean}|null}
 */
export function currentBuild() {
  try {
    const baked = JSON.parse(readFileSync(BAKED, 'utf8'));
    if (baked?.commit) return baked;
  } catch {
    // No file, or a damaged one. Either way git is the better authority here.
  }
  return fromGit();
}

/**
 * Ask git, which is only there in a working copy.
 *
 * `execFileSync` with fixed arguments and no shell. It costs about ten
 * milliseconds and only ever runs in development, where the alternative is a
 * command that cannot tell you which of your own commits it is.
 */
function fromGit() {
  const root = new URL('..', import.meta.url);
  const git = (...args) => execFileSync('git', ['-C', root.pathname, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
  try {
    const [commit, committed] = git('log', '-1', '--format=%h %cs').split(' ');
    return { commit, committed, modified: git('status', '--porcelain') !== '' };
  } catch {
    return null;
  }
}

/**
 * The facts, as prepack writes them. Exported so the script that runs at pack
 * time and the code that reads the result agree on the shape.
 *
 * @param {{commit: string, committed: string}} head
 * @param {Date} [now]
 */
export function bakedFrom(head, now = new Date()) {
  return { ...head, packaged: now.toISOString().slice(0, 10) };
}
