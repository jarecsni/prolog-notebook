// Updating itself, which is mostly a question of knowing how it was installed.
//
// A global `npm i -g`, a project dependency, an npx run, a pnpm or bun global,
// a git checkout — each needs a different answer, and running `npm i -g` from
// the wrong one either fails or upgrades something the reader did not mean. So
// this proves the global case and REFUSES THE REST WITH THE RIGHT COMMAND
// rather than guessing: a tool that breaks somebody's project while trying to
// help is worse than one that tells them what to type.
//
// Nothing here happens without being asked. See bin/prolog-notebook.mjs for the
// prompt, which only appears at a terminal — a pipe, a script and CI are all
// places where a question is a hang.
import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** npm is a batch file on Windows, and spawn will not find it otherwise. */
export const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';

/**
 * Which kind of copy is this?
 *
 * @param {{packageRoot: string, globalRoot: string|null}} where
 * @returns {'global'|'local'|'source'}
 */
export function describeInstall({ packageRoot, globalRoot }) {
  if (globalRoot && packageRoot.startsWith(globalRoot)) return 'global';
  // `node_modules` in the path and not the global root: somebody's project
  // depends on this, and upgrading it globally would leave that project on the
  // version it pinned while changing a tool they did not ask about.
  if (packageRoot.includes(`${'node_modules'}`)) return 'local';
  return 'source';
}

/**
 * What to do about it — a command to run, or words to print.
 *
 * @param {'global'|'local'|'source'} kind
 * @param {string} version
 * @returns {{argv: string[]}|{say: string}}
 */
export function upgradePlan(kind, version) {
  if (kind === 'global') return { argv: ['i', '-g', `prolog-notebook@${version}`] };
  if (kind === 'local') {
    return {
      say: 'This copy is a dependency of a project rather than a global install.\n'
        + `Upgrade it there: npm i prolog-notebook@${version}`,
    };
  }
  return {
    say: 'This copy is a source checkout, not an install. Upgrade it with git.',
  };
}

/** Where npm keeps global packages, or null if it will not say. */
export async function globalRoot(exec = run) {
  try {
    const { stdout } = await exec(NPM, ['root', '-g'], { timeout: 5000 });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Ask a yes/no question, defaulting to yes.
 *
 * ON STDERR, always: `execute --stdout` is a notebook going down a pipe, and a
 * question in the middle of it would corrupt the file it is writing.
 *
 * @returns {Promise<boolean>}
 */
export async function confirm(question, { input = process.stdin, output = process.stderr } = {}) {
  const { createInterface } = await import('node:readline/promises');
  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question(`${question} [Y/n] `);
    return !/^n/i.test(answer.trim());
  } catch {
    // Ctrl-C, a closed stream: not an answer, so not a yes.
    return false;
  } finally {
    rl.close();
  }
}

/**
 * Do it, showing npm's own output rather than a spinner of our own.
 *
 * @returns {Promise<boolean>} whether npm was happy
 */
export function install(argv, spawnImpl = spawn) {
  return new Promise((resolve) => {
    const child = spawnImpl(NPM, argv, { stdio: ['ignore', 'inherit', 'inherit'] });
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
  });
}

/**
 * Run this same command again, on the version that has just replaced us.
 *
 * THE PATH DOES NOT CHANGE, which is what makes this work: npm replaces the
 * contents of the package directory, and the bin the reader typed still points
 * at the same file. So the script to run is the one we are already running — its
 * bytes are simply new.
 *
 * A child rather than a true exec, because Node has no execve: stdio is
 * inherited so it looks like one process, and the child's exit code becomes
 * ours. The marker in the environment stops the new process checking for updates
 * again, which is what would otherwise turn a failed upgrade into a loop.
 *
 * @param {string[]} argv the original process.argv
 * @param {Function} [spawnImpl]
 * @returns {Promise<number>} the exit code to leave with
 */
export function relaunch(argv, spawnImpl = spawn) {
  return new Promise((resolve) => {
    const child = spawnImpl(argv[0], argv.slice(1), {
      stdio: 'inherit',
      env: { ...process.env, PROLOG_NOTEBOOK_UPGRADED: '1' },
    });
    child.on('error', () => resolve(1));
    child.on('close', (code) => resolve(code ?? 0));
  });
}
