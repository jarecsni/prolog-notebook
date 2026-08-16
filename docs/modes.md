# Read, Explore, Own — what a reader may change

Status: **v0.1, agreed 2026-08-16.** Tickets [869ejgbxf], [869ejgbzw], [869ejgc1k].

A notebook is read in two very different situations. Someone working through a published
chapter is a *reader*: their changes are experiments, and the chapter is not theirs. Someone
holding the file is an *owner*: their changes are edits, and the file is the truth.

Both must work, and the same `.prolog.md` must serve both.

---

## 1. The mode belongs to the environment, not the document

**A notebook never declares whether it is published.** Same argument as [binding.md](binding.md):
a file that cannot know which book it is in also cannot know whether the person reading it
owns it. Put a flag in the front matter and the same file becomes two files.

What actually decides the mode is one capability: **can this environment write the source?**
That line is already mapped on [869edpd6b] — the browser over HTTP cannot; VS Code, the CLI
and the iPad's `DocumentGroup` can.

| mode | writes | where it happens |
| ---- | ------ | ---------------- |
| **Read** | nothing at all | the GitHub view, a cold page, EPUB/PDF |
| **Explore** | local scratchpad only, always resettable | any published chapter, in a browser or a book app |
| **Own** | the source file | CLI, VS Code, iPad DocumentGroup, browser + File System Access |

## 2. Read

The chapter renders from its saved outputs with no engine present. `; next` replays the stored
solution sequence one at a time ([format §6](format.md)), so the teaching device survives on a
page that never loads 5.9 MB of WebAssembly, and on a printed edition that never could.

Nothing is written. Nothing can be.

## 3. Explore

The default for anything published. The reader may edit any cell, run it, step it, and answer
predictions. All of it lives in a local scratchpad keyed to the notebook ([869ectt5d]), and all
of it is **resettable** — that is the property that makes it safe to offer at all.

Three rules:

1. **Never write to the served file.** Impossible on a static host and undesirable anyway. The
   canonical chapter stays canonical.
2. **The author's answers and the reader's answers are never confused.** The page shows the
   saved output until the reader runs; after that it shows theirs, labelled as theirs, with a
   way back. Silently replacing the author's answers with the reader's — or the reverse —
   makes the page lie about where a result came from.
3. **Reset is always available**, per cell and for the whole notebook. Dropping the scratchpad
   returns the published chapter exactly.

### Explore needs an exit, or it is a trap

A reader who edits and runs but can never *keep* the result has less than a Jupyter user has.
localStorage is invisible, unportable, unshareable and one cache-clear from gone.

The exit is **export** ([869ejgbxf]): download the current model — their edits, their outputs —
as a real `.prolog.md`. They now own a copy, and can commit it, open it in VS Code, or send it
back as a pull request. Cheap, because `serialise()` already emits canonical bytes.

This is fork-by-download rather than save-back, and it is the right shape: the reader leaves
with something real, and the published chapter is untouched.

## 4. Own

The environment holds the file, so edits and outputs are saved to it. No scratchpad, no
reset-to-published, because there is no published version to reset to — the file *is* the
truth. This is the authoring case, and it is what the CLI and the VS Code milestone are for.
In the browser it is available only where the File System Access API exists ([869ejgbzw]), which
is Chromium — an enhancement, never a dependency.

**Which mode a session is in must be visible at a glance.** A reader who believes they are
editing a file they are not, or believes their scratchpad is saved when it is not, has been
misled by us and will lose work.

## 5. Outputs are a golden file, not a session transcript

Jupyter's interactive session mutates the document: run a cell, the kernel answers, the
notebook is dirty. That is where `execution_count` comes from, and why notebooks exist whose
stored outputs no clean run would ever produce.

Here, outputs are written by `run` from a **clean top-to-bottom execution**, committed,
reviewed in the diff, and verified by `--check` in CI. The model is snapshot testing, not a
transcript.

**And there is no incremental execution anywhere — not even in an editor.** "Run" always means
run from clean, so anything written back is by construction what a top-to-bottom run produces.
We can afford the strict version precisely where Jupyter could not: 83 ms to boot, 3.5 ms per
consult, 1.1 ms for every query in the once/1 chapter. Re-running a whole chapter costs less
than a keystroke. The tradeoff that produced out-of-order execution is not ours to make.

The exception is a cell declaring `:- dynamic`, whose assert/retract state lives in no file.
Detected statically; the UI offers *restart engine and run all* ([format §8](format.md)).

## 6. When the chapter moves underneath a reader

A reader has Explore state; we publish a corrected chapter; their edits were made against a
version that no longer exists. Jupyter never has this problem, because there is one file and
the reader owns it. We have it for every published chapter, always.

**The default outcome is the worst one.** Keyed by cell id alone, stale edits are silently
reapplied over a chapter that has moved: cells restored to text the author deliberately
changed, saved outputs contradicting the program above them, and nothing said. The reader then
concludes something false about Prolog rather than about our tool, which is the one failure
this project may not have.

So: key scratchpad state by notebook **and** a hash of the published source it was made
against, and when the source has moved, say so — keep mine / reset to published / show me what
changed, resolved per cell rather than for the whole notebook ([869ejgc1k]). Own mode is
unaffected; there is no published version to diverge from.

## 7. What Jupyter actually has

Worth recording, because it reframes what is at risk. **Jupyter has only Own mode.** You clone
a repo, start a kernel, and hold the file; nbviewer renders but does not execute. A published,
runnable, resettable chapter is not something Jupyter does better — it is something Jupyter
cannot do.

So the risk was never losing ground to Jupyter. It was failing to give Own mode a decent home,
and export plus the VS Code milestone covers it.

## 8. Consequences per shell

- **Static site** — Explore. Export is its escape hatch; File System Access upgrades it to Own
  where the browser allows.
- **CLI** — Own, and the only writer of canonical outputs.
- **VS Code** — Own. Byte-stable round-trip is non-negotiable ([869ectt6g]).
- **iPad** — *both*, and the app must know which. A notebook opened from Files is Own; a
  chapter read inside a bundled book is Explore. Recorded on [869eddrfv] before the document
  browser is built.

[869ejgbxf]: https://app.clickup.com/t/869ejgbxf
[869ejgbzw]: https://app.clickup.com/t/869ejgbzw
[869ejgc1k]: https://app.clickup.com/t/869ejgc1k
[869ectt5d]: https://app.clickup.com/t/869ectt5d
[869edpd6b]: https://app.clickup.com/t/869edpd6b
[869eddrfv]: https://app.clickup.com/t/869eddrfv
[869ectt6g]: https://app.clickup.com/t/869ectt6g
