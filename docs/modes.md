# Read, Explore, Own — what a reader may change

Status: **v0.2, amended 2026-08-16** with the output-attribution rule (§3) and what Run means
in a browser (§5). Tickets [869ejgbxf], [869ejgbzw], [869ejgc1k], [869ectt5d], [869ejgyaa].

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

The chapter renders from its saved outputs with no engine present ([869ectt0y]), so it is
readable the instant it loads and stays readable if the 5.9 MB of WebAssembly never arrives at
all — on a phone with bad signal, behind a corporate proxy, in ten years. It degrades to a book
rather than to a blank page.

**The whole sequence is shown, not stepped.** The format stores the solution sequence rather
than a blob ([format §6](format.md)) precisely so that stepping *could* be replayed without an
engine, and an earlier draft of this section said it would be. Building it settled the question
the other way, for two reasons:

- **A book shows its answers.** Print and EPUB have no buttons; if the page withholds what the
  printed edition prints, the two editions teach differently and the HTML one is worse.
- **One button, one meaning.** If `; next` sometimes replays a saved answer and sometimes runs
  a goal, the reader has to know which — and the difference is invisible until it matters.
  Run recomputes; what is on screen is what the chapter says.

The sequence is still stored rather than flattened, and it still earns its keep: the answers
are numbered as a live run numbers them, so the layout does not move when the reader presses
Run, and `false.` under six answers is rendered as *no more solutions* rather than as a denial
of them.

**But the reader can put them away.** A chapter whose prose says *press Run for the first
answer, then `; next` to walk through the rest* is arguing with a page that has already printed
all six: the reader loses either the exercise or their trust in the instructions. So every
saved output carries a **hide**, and the page's own pill carries one that hides them all at
once, for working through a chapter cold ([869enke58]).

Hidden, never discarded — they are the chapter's answers and one click brings them back, which
is also why this is not what reset does: there is nothing here to undo. The attribution line
stays visible while they are away, so the reader can always see that they exist. And it is
opt-in, because a chapter that shows its answers is the property this whole document is about.

That is the reader's half of the question. The author's half is `hold` on a query cell
(format §5, [869enkdd2]): the chapter itself says these answers are withheld until the reader
runs the cell, or until they have written the prediction the answers would spoil. The
first-time reader is then not the one who has to think of hiding them — which they cannot do,
since by the time they know to hide an answer they have read it.

Both halves are the same mechanism on screen, and neither is a lock. A held output says what
it is waiting for and carries the same *show* control, because withholding an answer from a
reader who has decided they want it is theatre rather than teaching. And it is the runtime
that holds, never the renderer: print, EPUB and the GitHub view show every answer, since a
book cannot withhold and a reader on the repo page has no Run button to press.

Nothing is written. Nothing can be.

## 3. Explore

The default for anything published. The reader may edit any cell, run it, step it, and answer
predictions. All of it lives in a local scratchpad keyed to the notebook ([869ectt5d]), and all
of it is **resettable** — that is the property that makes it safe to offer at all.

Three rules:

1. **Never write to the served file.** Impossible on a static host and undesirable anyway. The
   canonical chapter stays canonical.
2. **The author's answers and the reader's answers are never confused.** See the rule below;
   it is the one that does the work.
3. **Reset is always available**, per cell and for the whole notebook. Dropping the scratchpad
   returns the published chapter exactly. Per-cell reset exists now, on both runnable cell
   kinds ([869enke58]), and it means one thing in both: *put this back the way the chapter
   published it*.

   - On a **program** cell that is the chapter's text **and** out of the engine — reset
     un-consults it, because a published chapter has no engine at all. Restoring the text
     while quietly leaving the clauses loaded would agree with the reader in words and
     disagree in fact. Nothing cascades to the cells that used it, and nothing needs to:
     Prolog has no load-time name binding, so the consequence surfaces as an ordinary
     "Unknown procedure" when a goal actually calls it — and Run on any query below consults
     the cells above it, so the chapter heals itself on the next click ([869ejgyaa]).
   - On a **query** cell it is the chapter's goal and the chapter's saved answers, together,
     because they only mean anything together. No engine work is involved: saved answers make
     no claim about what the engine is holding.

   Whole-notebook reset arrives with the scratchpad it undoes ([869ectt5d]); until then a
   reload is a true reset, and the page says so.

### Every output is attributable

Persisting the reader's *edits* without their *outputs* produces a page that lies. On the next
load the cell would show their program above the author's answers, as though one had produced
the other. So the scratchpad holds both or neither ([869ectt5d]).

Which means every output on screen is in exactly one of three states, and the page always says
which:

| state | what it is | when it shows |
| ----- | ---------- | ------------- |
| **authored** | the saved output from the file, from a clean run at publish time | the default; what a cold page shows, engine or no engine |
| **yours** | produced by this reader, from the program currently on screen | after they press Run — labelled, with a way back to authored |
| **stale** | either kind, whose `input-hash` no longer matches the program above it | marked, never silently discarded and never silently trusted ([869eddzgq]) |

**Staleness is derived, not remembered.** A displayed answer records what it was produced
against — the goal, and the text of every program cell above it — and the cell re-derives on
every change whether that is still true, saying *program changed since this ran*, *query edited
since this ran*, or *engine restarted since this ran*. This is the live twin of the `input-hash`
check the renderer does for saved answers ([format §6](format.md)): the same question, asked of
a run that happened a minute ago rather than at publish time. Derived rather than latched for a
reason — a reader who makes an edit and then undoes it is back where they started, and a
warning that survives that teaches them to ignore warnings, which is worse than never showing
one.

**The invariant: an output is never shown without being attributable.** Everything else in
Explore mode follows from it — why reset exists, why edits and outputs persist together, why
scratchpad state is keyed by the published source it was made against (§6).

The failure it prevents is specific. A reader who sees their own program above someone else's
answers does not conclude that our tool is confused; they conclude something false about
**Prolog**. That is the one failure this project may not have.

### Explore needs an exit, or it is a trap

A reader who edits and runs but can never *keep* the result has less than a Jupyter user has.
localStorage is invisible, unportable, unshareable and one cache-clear from gone.

The exit is **export** ([869ejgbxf]): download the current model — their edits, their outputs —
as a real `.prolog.md`. They now own a copy, and can commit it, open it in VS Code, or send it
back as a pull request. Cheap, because `serialise()` already emits canonical bytes.

This is fork-by-download rather than save-back, and it is the right shape: the reader leaves
with something real, and the published chapter is untouched.

Every output in the downloaded file says whose it is and whether it still follows from the
program above it. Answers the reader produced are hashed against the reader's program;
answers still belonging to the chapter keep the author's hash untouched, so a reader who
edited a program and did not re-run opens their copy with those answers marked stale —
exactly what the page they downloaded it from was showing. And a query they stopped part-way
keeps the answers they took, written as a sequence that was never exhausted ([869enmq2y]);
the file never claims a search finished that nobody finished.

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
The page carries a **restart engine** control for exactly this ([format §8](format.md)), in a
lozenge fixed to the corner of the viewport that says what the engine is holding — a dot and a
word, and clicking it raises a card directly above it, one row per thing the page controls,
because a chapter is for reading and a bar pinned across every page is a tool insisting on
itself. It **rises rather than widening** ([869enmuy9]), which is a correctness decision as much
as a visual one: a control that widens has to be measured from the DOM every time its words
change, and a measured animation is cancelled by anything that re-renders while it runs. A row
costs vertical space, which nobody is short of. On a click and not on hover: hover
opens a panel nobody asked for, does not exist on a touch screen, and cannot be reached from a
keyboard. Its button's label is always the thing it will do — **start engine** when there is
none, **restart engine** when there is. It
throws the worker away and replays the consult log, so the clauses come back and the
assert/retract state does not. Verified in a browser — a counter mutated to 41 is 0 again
afterwards.

**A cell that declares one says so before anything is asserted** ([869eddzfp]). The declaration
is read out of the text with no engine involved, on every keystroke, and the cell carries a
*stateful* badge naming the predicates and what will not undo them. Saying it afterwards would
be saying it too late: the reader has already edited the cell, re-consulted, watched their
asserted fact survive, and drawn a conclusion about Prolog.

**In the browser the same rule means Run brings its own context.** Pressing Run on a query
consults every program cell above it first ([869ejgyaa]), so a reader who lands halfway down a
chapter and runs one query gets the right answer without knowing which cells to press first.
Affordable for the same reason the strict version is: 3.5 ms per consult, and consulting a
program cell is side-effect-free. There is no dependency graph, because **Prolog has no
load-time name binding** — `q(X) :- p(X)` merely mentions `p/1`, which is looked up when it is
called, so consult order cannot affect correctness. Dependency information is only ever needed
for the cosmetic question of which displayed outputs went stale.

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
[869ectt0y]: https://app.clickup.com/t/869ectt0y
[869eddzgq]: https://app.clickup.com/t/869eddzgq
[869ejgyaa]: https://app.clickup.com/t/869ejgyaa
[869enke58]: https://app.clickup.com/t/869enke58
[869eddzfp]: https://app.clickup.com/t/869eddzfp
[869enkdd2]: https://app.clickup.com/t/869enkdd2
[869enmuy9]: https://app.clickup.com/t/869enmuy9
