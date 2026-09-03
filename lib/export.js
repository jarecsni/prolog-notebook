// The reader leaves with a real file.
//
// Explore mode lets a reader edit a published chapter and run it, and until now
// gave them no way to keep the result. That is a trap rather than a feature: work
// that lives only in a page is one navigation from gone, and telling someone to
// experiment while quietly discarding what they produce teaches them not to.
//
// The answer is FORK BY DOWNLOAD, never save-back (docs/modes.md §3). The
// published chapter stays canonical; the reader gets their own `.prolog.md`,
// which they can commit, open in VS Code, or send back as a pull request. That
// last one is free: the format is markdown in git, so the contribution path
// already exists.
//
// Cheap by construction — serialise() already emits canonical bytes — so all the
// work here is in being honest about WHOSE ANSWERS ARE WHOSE.
import { hashFor, serialise } from './format.js';

/**
 * The notebook as it now stands on screen.
 *
 * @param {{frontMatter: Map<string, string>, cells: object[]}} notebook the published model
 * @param {Map<string, {source?: string, goal?: string, output?: object|null}>} edits by cell id
 * @returns {{frontMatter: Map<string, string>, cells: object[]}}
 */
export function withEdits(notebook, edits) {
  const cells = notebook.cells.map((cell) => {
    const edit = edits.get(cell.id);
    if (!edit) return cell;
    if (cell.kind === 'program' && edit.source !== undefined) {
      return { ...cell, source: edit.source };
    }
    if (cell.kind === 'query') {
      const next = { ...cell };
      if (edit.goal !== undefined) next.goal = edit.goal;
      // `output: null` is a deliberate erasure, not a missing key: it is how a
      // query the reader has half-run says "I have no answers to give you".
      //
      // An output is more than its answers — it carries the fence's language and
      // whatever attributes the author wrote on it, and the serialiser needs
      // every one of them. So the reader's answers are laid OVER the author's
      // output rather than replacing the object, and a cell that never had one
      // gets the defaults the parser would have produced.
      if ('output' in edit) {
        next.output = edit.output && { ...blankOutput(), ...cell.output, ...edit.output };
      }
      return next;
    }
    return cell;
  });

  const updated = { ...notebook, cells };

  // THE HASHES ARE THE WHOLE ARGUMENT. A downloaded file has to say, of every
  // output in it, whether it follows from the program above it — and the format
  // already has the spelling for that (format §6).
  //
  // - An answer the READER produced is hashed against the READER's program,
  //   because that is what produced it. It opens as current, which it is.
  // - An answer from the CHAPTER keeps the AUTHOR's hash, untouched. If the
  //   reader edited a program above it, the hash no longer matches and the file
  //   opens with that output marked stale — which is exactly the truth, and
  //   exactly what the page they downloaded it from was showing.
  //
  // Rehashing everything would be the tempting one-liner and it would be a
  // forgery: it would certify the author's answers as following from the
  // reader's program. That is the one failure this project may not have.
  for (const cell of cells) {
    if (cell.kind !== 'query' || !cell.output) continue;
    if (edits.get(cell.id)?.output) {
      cell.output = { ...cell.output, inputHash: hashFor(updated, cell) };
    }
  }

  return updated;
}

/**
 * What the parser would have produced for an output that has none of its own.
 *
 * A query the chapter never ran has no fence for its answers, so there is
 * nothing to inherit language or attributes from, and the serialiser reads both
 * unconditionally — `attrs` in particular is iterated, so a missing one is a
 * TypeError rather than a silently absent attribute.
 */
function blankOutput() {
  return { solutions: [], terminator: '', inputHash: null, language: 'text', attrs: new Map() };
}

/**
 * Serialise the notebook as it now stands.
 * @returns {string} canonical `.prolog.md` bytes
 */
export function exportSource(notebook, edits) {
  return serialise(withEdits(notebook, edits));
}

/**
 * The chapter with its answers taken back out.
 *
 * A query cell with no output block is valid — the result is a chapter that
 * simply has not been executed yet, and `execute` will fill it in again. Nothing
 * else moves: prose, program cells, goals and attributes are the author's, and
 * this is not an excuse to reformat them.
 *
 * It goes through the SAME ERASURE PATH the reader's download already uses:
 * `output: null` has always meant "there are no answers to write down here"
 * (869ejgbxf), so nothing new decides what an emptied cell means.
 *
 * @param {{frontMatter: Map<string, string>, cells: object[]}} notebook
 * @returns {{text: string, cleared: number}} the bytes, and how many were emptied
 */
export function clearedSource(notebook) {
  const edits = new Map();
  for (const cell of notebook.cells) {
    if (cell.kind === 'query' && cell.output) edits.set(cell.id, { output: null });
  }
  return { text: exportSource(notebook, edits), cleared: edits.size };
}

/**
 * A filename for the reader's copy.
 *
 * From the SOURCE, never the title: a title can contain anything, including
 * slashes, and the reader recognises the file they came from. The name is not
 * decorated with "my-copy" either — this is their file now, and their filesystem
 * is where the distinction between copies belongs.
 */
export function filenameFor(url) {
  const path = String(url ?? '').split(/[?#]/)[0];
  const base = path.slice(path.lastIndexOf('/') + 1);
  return base || 'notebook.prolog.md';
}

/**
 * Hand a file to the reader.
 *
 * An object URL and a synthetic click, revoked on the next turn of the event
 * loop. No network, no server, nothing to own.
 */
export function download(filename, text, document_ = document) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
  const anchor = document_.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document_.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
