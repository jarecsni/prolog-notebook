// Is there a newer one? Asked at most once a day, answered quietly, and never in
// the way (869erkqpc).
//
// THE RULES, because an update notifier is the easiest thing in a CLI to make
// annoying:
//
// - It says NOTHING when you are up to date. A tool that congratulates you on
//   every command is one you learn to read past, and then it is not there when
//   it has something to say. `--check-update` is the exception: you asked, so it
//   answers either way.
// - It never runs for `--help` or `--version`. Those are what someone types at a
//   broken install, and they must stay instant and offline.
// - It never runs in CI, and honours NO_UPDATE_NOTIFIER. `--check` will run this
//   command on every push one day; a build that fails because a registry was slow
//   is worse than no notice at all.
// - Everything that can go wrong is silent: no network, no cache directory, a
//   registry that answers with nonsense. None of it is the reader's problem.
//
// The clock, the cache and "what is the latest version" are all arguments, so
// everything above is tested without touching the wire; the fetch itself is the
// only part that ever does.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const DAY = 24 * 60 * 60 * 1000;

/** The npm registry's smallest useful answer: one document, one field. */
export const REGISTRY = 'https://registry.npmjs.org';

/**
 * Where the last answer is remembered.
 *
 * XDG when it is set, `~/.cache` otherwise. Not beside the package: a global
 * install is often read-only, and a check that needs write access to node_modules
 * is a check that quietly stops happening.
 */
export function cachePath(env = process.env, home = homedir()) {
  const base = env.XDG_CACHE_HOME || join(home, '.cache');
  return join(base, 'prolog-notebook', 'update-check.json');
}

/** Reading and writing that file, and shrugging when it cannot. */
export function fileStore(path = cachePath()) {
  return {
    read() {
      try {
        return JSON.parse(readFileSync(path, 'utf8'));
      } catch {
        return null;
      }
    },
    write(state) {
      try {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, JSON.stringify(state));
      } catch {
        // A read-only or missing home directory means the check happens every
        // time instead of once a day. That is a slower notifier, not a failure.
      }
    },
  };
}

/**
 * Ask the registry which version is `latest`.
 *
 * The abbreviated document rather than the full packument: the full one carries
 * every version ever published and can be megabytes, for a question with a
 * one-line answer.
 *
 * @returns {Promise<string|null>} null for anything that goes wrong
 */
export async function latestFromRegistry({
  // A private registry is a fact about the machine, not about this package, so
  // npm's own setting is honoured before the default — and an explicit override
  // exists because a test needs somewhere to point that is not the internet.
  registry = process.env.PROLOG_NOTEBOOK_REGISTRY || process.env.npm_config_registry || REGISTRY,
  name = 'prolog-notebook',
  timeout = 2000,
  fetchImpl = fetch,
} = {}) {
  try {
    const base = String(registry).replace(/\/+$/, '');
    const response = await fetchImpl(`${base}/${name}/latest`, {
      headers: { accept: 'application/vnd.npm.install-v1+json' },
      signal: AbortSignal.timeout(timeout),
    });
    if (!response.ok) return null;
    const body = await response.json();
    return typeof body?.version === 'string' ? body.version : null;
  } catch {
    return null;
  }
}

/**
 * Newer, older, or the same — by the numbers only.
 *
 * A prerelease is never newer than the release it precedes, and comparing them
 * properly is a semver library's job. This one is deciding whether to print a
 * sentence, so `0.4.0-rc.1` is simply not an upgrade from `0.3.1`.
 */
export function isNewer(latest, current) {
  if (/-/.test(String(latest))) return false;
  const parts = (v) => String(v).split('.').map((n) => Number.parseInt(n, 10));
  const [a, b] = [parts(latest), parts(current)];
  if (a.some(Number.isNaN) || b.some(Number.isNaN)) return false;
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

/**
 * The line to print, or null for silence.
 *
 * @param {object} options
 * @param {string} options.version what this copy is
 * @param {boolean} [options.force] the reader asked, so answer either way
 * @param {number} [options.now]
 * @param {number} [options.ttl]
 * @param {{read: Function, write: Function}} [options.store]
 * @param {() => Promise<string|null>} [options.latest]
 * @param {object} [options.env]
 * @returns {Promise<string|null>}
 */
export async function updateNotice({
  version,
  force = false,
  now = Date.now(),
  ttl = DAY,
  store = fileStore(),
  latest = latestFromRegistry,
  env = process.env,
} = {}) {
  if (!force && (env.CI || env.NO_UPDATE_NOTIFIER)) return null;

  const remembered = store.read();
  const fresh = !force && remembered && now - remembered.checked < ttl;
  const newest = fresh ? remembered.latest : await latest();
  if (!fresh && newest) store.write({ checked: now, latest: newest });

  if (!newest) return force ? 'Could not reach the npm registry.' : null;
  if (isNewer(newest, version)) {
    return `A newer Prolog Notebook is available: ${version} → ${newest}\n`
      + 'Update with: npm i -g prolog-notebook';
  }
  return force ? `Prolog Notebook ${version} is the latest.` : null;
}
