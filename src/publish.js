// The site onto a branch a host will serve (869ery8ac).
//
// THE WHOLE THING IS GIT PLUMBING, and deliberately: no new dependency, nothing
// GitHub-specific in the mechanism, and no HTTP client of our own to keep honest.
// GitHub Pages, GitLab Pages, Codeberg and a bare repo with a post-receive hook
// all consume the same thing — a branch with a site on it.
//
// NEVER THROUGH THE AUTHOR'S CHECKOUT. A separate index file and an explicit
// work-tree mean the commit is built beside the working copy rather than out of
// it: no branch switch, no stash, no staged file left behind, and publishing
// mid-edit on a dirty tree changes nothing under the author's feet.
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

/** git, with its output trimmed and its failures returned rather than thrown. */
async function git(args, options = {}) {
  try {
    const { stdout } = await exec('git', args, options);
    return { ok: true, out: stdout.trim() };
  } catch (e) {
    return { ok: false, out: '', why: (e.stderr || e.message || '').trim() };
  }
}

/**
 * The repository this directory belongs to, or null.
 *
 * `--show-toplevel` rather than looking for a `.git` entry: it is right inside a
 * worktree, a submodule and a subdirectory, where the entry is a file or is
 * somewhere else entirely.
 */
export async function repository(cwd) {
  const top = await git(['rev-parse', '--show-toplevel'], { cwd });
  if (!top.ok) return null;
  const dir = await git(['rev-parse', '--absolute-git-dir'], { cwd });
  return dir.ok ? { root: top.out, gitDir: dir.out } : null;
}

/**
 * The URL a repository's Pages site will answer on, when the remote is GitHub.
 *
 * Best-effort and clearly labelled as such where it is printed: the answer also
 * depends on a setting only a human can see. A custom domain, a user site, or a
 * source pointing at another branch all make this wrong, and none of them are
 * visible from here — so it is offered as where to look, never as a promise.
 */
export function pagesUrl(remoteUrl) {
  const match = /github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/.exec(remoteUrl ?? '');
  if (!match) return null;
  const [, owner, repo] = match;
  return repo.toLowerCase() === `${owner.toLowerCase()}.github.io`
    ? `https://${owner.toLowerCase()}.github.io/`
    : `https://${owner.toLowerCase()}.github.io/${repo}/`;
}

/**
 * Put a directory on a branch, as one commit, and push it.
 *
 * PARENTED ON WHAT IS ALREADY THERE. The remote branch is fetched first so the
 * new commit descends from it: a publish is then an ordinary fast-forward rather
 * than a force-push, the branch keeps a real history, and a push that would
 * clobber somebody else's work is refused by git rather than by us remembering
 * to ask. Nothing to fetch — the first publish — means no parent, which is what
 * a new branch is.
 *
 * @param {{site: string, gitDir: string, root: string, remote: string, branch: string,
 *          dryRun?: boolean}} where
 * @returns {Promise<{ok: boolean, commit?: string, files?: number, why?: string}>}
 */
export async function pushSite({ site, gitDir, root, remote, branch, dryRun = false }) {
  const index = mkdtempSync(join(tmpdir(), 'prolog-notebook-publish-'));
  const env = { ...process.env, GIT_INDEX_FILE: join(index, 'index'), GIT_DIR: gitDir };
  const run = (args) => git(args, { cwd: root, env });
  try {
    // -f IS LOAD-BEARING. `build` tells authors they may want the site in
    // .gitignore, and `add -A` honours .gitignore — without this the publish is
    // an empty tree reported as a success.
    const added = await run(['--work-tree', site, 'add', '-A', '-f', '.']);
    if (!added.ok) return { ok: false, why: added.why };

    const listed = await run(['ls-files']);
    const files = listed.out ? listed.out.split('\n').length : 0;
    if (!files) return { ok: false, why: `${site} is empty` };

    const tree = await run(['write-tree']);
    if (!tree.ok) return { ok: false, why: tree.why };

    // A branch that does not exist yet is not an error, it is the first publish.
    const fetched = await run(['fetch', '--quiet', remote, branch]);
    const parent = fetched.ok ? (await run(['rev-parse', 'FETCH_HEAD'])).out : null;

    if (dryRun) return { ok: true, files, commit: null, parent };

    const commit = await run([
      'commit-tree', tree.out,
      ...(parent ? ['-p', parent] : []),
      '-m', `Publish ${files} file${files === 1 ? '' : 's'} from prolog-notebook-site`,
    ]);
    if (!commit.ok) return { ok: false, why: commit.why };

    const pushed = await run(['push', remote, `${commit.out}:refs/heads/${branch}`]);
    if (!pushed.ok) return { ok: false, why: pushed.why };
    return { ok: true, commit: commit.out, files };
  } finally {
    rmSync(index, { recursive: true, force: true });
  }
}

/** Where the pushed branch would be served from, as far as we can tell. */
export async function remoteUrl(root, remote) {
  const found = await git(['remote', 'get-url', remote], { cwd: root });
  return found.ok ? found.out : null;
}
