// The other half of a keystroke (869edp5c8).
//
// `view` already answers every request by reading the file, so a reload always
// shows what is on disk — there is no window in which the page and the file
// disagree. What it cannot do is notice. This is the noticing: the author saves
// in their editor and the page they are looking at comes with them.
//
// DIRECTORIES ARE WATCHED, NOT FILES, and that is not an implementation detail.
// Editors do not write files; they write a temporary one and rename it over the
// target, so a watch on the file itself follows the inode that was replaced and
// goes quiet after the first save — working once is the worst failure mode
// available here. A directory watch sees the rename.
import { watch as fsWatch } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * Call back when any of these files changes, and keep up as the set changes.
 *
 * DEBOUNCED, because one save is several events: truncate then write, or write
 * then rename, and on macOS a rename arrives as two. Rebuilding three times for
 * one Cmd-S would be invisible in the page and expensive in a big book.
 *
 * @param {string[]} files to watch, by path
 * @param {() => void} onChange after the dust settles
 * @param {{wait?: number}} [options] milliseconds of quiet before it fires
 * @returns {{arm: (files: string[]) => void, close: () => void}} `arm` replaces
 *   the set — a book gains chapters while it is being served, and the spine that
 *   named them is itself one of the watched files.
 */
export function watchFiles(files, onChange, { wait = 60 } = {}) {
  const watchers = new Map();
  let names = new Set();
  let timer = null;

  const fire = () => {
    clearTimeout(timer);
    timer = setTimeout(onChange, wait);
    // A timer is the only thing this module holds, and holding the process open
    // for a rebuild that is 60 ms away is not worth a hung `close`.
    timer.unref?.();
  };

  const arm = (list) => {
    names = new Set(list.map((file) => resolve(file)));
    const dirs = new Set([...names].map((file) => dirname(file)));
    for (const [dir, watcher] of watchers) {
      if (dirs.has(dir)) continue;
      watcher.close();
      watchers.delete(dir);
    }
    for (const dir of dirs) {
      if (watchers.has(dir)) continue;
      try {
        // `filename` is documented as possibly null, and is on some platforms.
        // A change we cannot attribute is still a change: rebuilding is cheap and
        // missing the author's save is not.
        watchers.set(dir, fsWatch(dir, (event, filename) => {
          if (!filename || names.has(join(dir, filename))) fire();
        }));
      } catch {
        // A directory that does not exist, or one the platform will not watch.
        // The page still rebuilds on reload; only the noticing is lost.
      }
    }
  };

  arm(files);
  return {
    arm,
    close() {
      clearTimeout(timer);
      for (const watcher of watchers.values()) watcher.close();
      watchers.clear();
    },
  };
}
