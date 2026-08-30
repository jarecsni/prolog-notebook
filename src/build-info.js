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
//   Built from commit ccf8e5b on 2026-08-30 14:32:51 UTC
//   Working copy ccf8e5b (modified)
//
// The first is baked in by the release workflow just before publish — git exists
// there and does not exist inside an installed package. The second is read from
// git at run time, and says `(modified)` when the tree has edits, because a bare
// SHA over a dirty tree names a program that nobody has.
//
// ONE DATE, AND IT IS THE BUILD'S. The commit's own date is not printed because
// the hash already identifies it — anyone who wants it can ask git — and two
// dates where one was asked for is noise dressed as rigour. A working copy has no
// build time at all, which is why that state carries no date: there is nothing to
// date yet.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/** Where prepack leaves the facts. Inside `src`, so `files` already ships it. */
const BAKED = new URL('./build-info.json', import.meta.url);

/**
 * The provenance line, or null when nothing is known.
 *
 * Pure, so both states can be tested without a filesystem or a git repository.
 *
 * @param {{commit: string, built?: string, modified?: boolean}|null} info
 * @returns {string|null}
 */
export function buildLine(info) {
  if (!info?.commit) return null;
  if (info.built) return `Built from commit ${info.commit} on ${info.built}`;
  return `Working copy ${info.commit}${info.modified ? ' (modified)' : ''}`;
}

/**
 * What this copy is, from whichever of the two sources exists.
 *
 * Null rather than a guess when neither does — a tarball built before any of
 * this existed, or a source tree with no history. A line that says "unknown"
 * three times is worse than no line.
 *
 * @returns {{commit: string, built?: string, modified?: boolean}|null}
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
    return {
      commit: git('log', '-1', '--format=%h'),
      modified: git('status', '--porcelain') !== '',
    };
  } catch {
    return null;
  }
}

/**
 * The facts, as the release writes them. Exported so the script that runs at
 * publish time and the code that reads the result agree on the shape.
 *
 * UTC, spelled out. A build stamp is read by whoever is holding the package,
 * wherever they are, and a bare local time from someone else's machine says less
 * than nothing.
 *
 * @param {{commit: string}} head
 * @param {Date} [now]
 * @returns {{commit: string, built: string}}
 */
export function bakedFrom(head, now = new Date()) {
  return {
    commit: head.commit,
    built: `${now.toISOString().slice(0, 19).replace('T', ' ')} UTC`,
  };
}
