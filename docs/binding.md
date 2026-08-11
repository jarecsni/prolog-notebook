# Books, notebooks and binding

Status: **v0.1 spec, agreed 2026-08-10.** Nothing here is implemented yet. It is written
before the code because [docs/format.md](format.md) was, and that worked.

A **notebook** is the unit of authorship, execution, publication and sale. A **book** is a
*binder*: an ordered set of references to notebooks, plus the matter that only exists
because they are bound together — a table of contents, a cross-reference appendix, an index.

The book is a ring binder, not a container. Nothing is *inside* it. This one sentence decides
everything below.

---

## 1. Why a binder and not a container

The alternative — a book that owns its chapters as sub-documents — fails on four counts:

- A notebook would stop being independently publishable, and the single-file, drop-it-in-a-
  page property is the whole reason the format looks the way it does.
- A notebook could belong to exactly one book. A C&M chapter notebook wants to appear in a
  study binder *and* in a "cut and control" collection, unchanged.
- The custom element (`<prolog-notebook src="…">`) embeds a notebook, not a chapter-of-a-book.
  A container model makes embedding a special case of extraction.
- It invites the chapter to depend on the chapter before it. Under a binder, that
  dependency is unrepresentable, so it cannot be written by accident.

## 2. The rules

1. **A notebook never knows which book it is in.** No book id, no chapter number, no
   position in its front matter. Anything that answers "where does this sit" is a binding
   fact and lives in the spine.
2. **A notebook is independently valid.** It parses, runs, renders and deploys alone.
   `prolog-notebook build chapter-04.prolog.md` produces a working page with no spine.
3. **One notebook, one engine session.** Every notebook executes top to bottom from clean
   ([format §8](format.md)). A notebook may not rely on another notebook having been run.
   The binder does not create a shared clause store, and never will.
4. **Sharing is by `src=`, not by ordering.** Facts used across chapters live in a real
   `.pl` file with real `.plt` tests, cited by each notebook that needs them
   ([format §4](format.md)). This is the case `src=` was reserved for; the binder makes it
   a requirement rather than a nicety.
5. **Generated matter is build output.** Title pages, contents, chapter covers and the
   predicate cross-reference are emitted by `build` and are never files an author edits
   (§4). If it can be derived, it is not source.

## 3. The spine file

The spine is a **markdown file**, for the same reason the notebook is: it reads on GitHub
with no build step, and it needs no parser we do not already have.

```markdown
---
format: prolog-notebook-book/1
kicker: Programming in Prolog · a study binder
matter: title, toc, covers, xref
---

# Working through Clocksin & Mellish

Notebooks written while reading C&M. Each one runs in the browser.

- [Chapter 1 · Tutorial introduction](ch01-tutorial.prolog.md)
- [Chapter 2 · A closer look](ch02-closer-look.prolog.md)
- [Chapter 4 · Cut and control](ch04-cut.prolog.md)
```

- **Entry rule**: every markdown link whose target ends in `.prolog.md`, **in document
  order**, is a spine entry. Prose may link to anything else freely. A duplicate target is
  an error; a target that does not resolve is an error.
- **The link text is the entry's title in the TOC and navigation.** The notebook's own `# H1`
  remains the title of the page itself. They may differ — a binder is allowed to rename a
  chapter for its own table of contents.
- **Everything that is not an entry link is preface**, kept verbatim and rendered above the
  contents on the book's front page.
- Front matter is the same restricted subset as a notebook ([format §2](format.md)): flat
  `key: value`, no YAML dependency. `format: prolog-notebook-book/1` is required and is what
  identifies the file; the name `book.md` is convention only.
- **There is no `title` key.** The first `# H1` is the title, as in a notebook.
- `matter` lists the generated sections this binder wants, in the order they are produced
  (§4). Omit it for the default `title, toc, covers, xref`; `matter: none` for a bare
  binder that is only its chapters.

Entries may be a URL rather than a relative path, once notebooks are hosted. Resolution goes
through the injectable filesystem, never Node's `fs` — see [platform-seams.md](platform-seams.md).

## 4. What the binder emits — a sequence of sections

**The binder does not reach into a chapter. It emits its own pages around it.**

`build book.md` produces an ordered list of **sections**, each of exactly one kind:

- **referenced** — a notebook, rendered exactly as it renders standalone
- **generated** — a page the binder derives: title, contents, a chapter cover, back matter

```
book.md                              build output
──────────────                       ──────────────────────────────────
matter: title, toc, covers, xref     1   title page          generated
# Working through C&M                2   contents            generated
preface prose…                       3   preface             prose from the spine
                                     4   Chapter 1 cover     generated
## Chapters                          5   ch01-tutorial       rendered as-is
- [Tutorial intro](ch01-tutorial…)   6   Chapter 2 cover     generated
- [Cut and control](ch04-cut…)       7   ch04-cut            rendered as-is
## Appendices                        8   Appendix A cover    generated
- [Operator table](appx-ops…)        9   appx-ops            rendered as-is
                                     10  predicate xref      generated
```

Look at section 6: `ch04-cut.prolog.md` is **Chapter 2 of this binder**. Numbering is
position in the binder and nothing else — which is what makes arbitrary reordering possible,
and why a file cannot carry a number even when the book it was written alongside gave it one.

### `matter` — the generated sections

| name | what it is |
| ---- | ---------- |
| `title` | title page: the spine's `# H1`, its `kicker`, and its preface prose |
| `toc` | contents, from the entry labels (§5) |
| `covers` | a cover page before **every** entry |
| `xref` | predicate cross-reference: every predicate defined in the binder, the chapter that defines it, and the chapters that call it |
| `none` | nothing generated — the binder is exactly its chapters, in order |

Covers are **implicit**. Writing one spine line per cover would be the pile-of-files problem
in a new place, and a binder with thirty chapters would be sixty entries of which half say
nothing. A cover may be *overridden* by an authored file when a chapter earns an epigraph or
a "before you start" — but it is never something you have to write.

`xref` rather than a conventional term index, deliberately. A term index needs author-marked
terms: real work, and a book's worth of it. A predicate cross-reference is derivable with no
author effort at all, because the build is already parsing the Prolog — and for a Prolog book
it is the more useful back matter anyway.

**Generated sections are never files.** They are not in the source tree, not committed, and
not checked by `--check`. They are a pure function of the spine and the chapters, recomputed
on every build, exactly like a TOC in any other static site generator.

## 5. Labels, numbering, and how the kicker gets there

### Numbering

Derived from the spine's own structure, which is ordinary markdown and reads correctly on
GitHub either way:

```markdown
Anything up here is preface, and links in it are **not** entries.

- [About this binder](preface.prolog.md)     → "About this binder"      (no number)

## Chapters
- [Tutorial introduction](ch01.prolog.md)    → "Chapter 1 · Tutorial introduction"
- [Cut and control](ch04-cut.prolog.md)      → "Chapter 4 · Cut and control"

## Appendices
- [Operator table](appx-ops.prolog.md)       → "Appendix A · Operator table"
```

- Entries under a heading whose text begins **Chapter** or **Chapters** are numbered `1..n`.
- Entries under **Appendix** or **Appendices** are lettered `A..Z`.
- Entries under any other heading, or under none, are unnumbered — their label is the link
  text alone.
- A spine with no headings at all numbers every entry as a chapter. The common case needs no
  ceremony.

`numbering: none` in the spine's front matter disables all of it. The link text is then the
whole label, and an author who wants "Chapter 4" types it.

The label produced here is used in exactly three places — the entry's cover page, the
contents, and the navigation — so those three cannot drift apart.

### The kicker is how a cover renders on the web

A chapter has **two names**, and the existing example page shows both:

```
CHAPTER 4 · CUT AND CONTROL     ← the label: the formal name, what a TOC lists
Where does the fence go?        ← the H1: the editorial name, what the page is called
```

In print, `covers` is a real page and the label sits on it. On the web a cover page of its
own would be a click in the way, so **the HTML emitter merges the cover into the head of the
chapter page** — and that slot is precisely the `.kicker` line the stylesheet already has.

Same model, two emitters:

| emitter | a cover section becomes |
| ------- | ----------------------- |
| HTML | the `.kicker` line above the chapter's `# H1`, plus any authored cover content |
| PDF / EPUB | a page of its own, as in a printed book |

So the kicker is a *rendering of a generated section*, not a property of the notebook and not
a value injected into it. The notebook's own model is untouched either way.

### Standalone

Built alone, a notebook has no binder, therefore no cover, therefore no label. It uses its
own front-matter `kicker` and shows **no number**. That key is the notebook's opinion about
itself, which is legitimate; a position is not. `--check` warns — does not fail — when it
looks like a chapter number has been written into one.

Reordering the spine renumbers the book and touches no notebook file. That is the whole point.

## 6. Cross-notebook references

Reserved now, unimplemented, so the grammar is settled once — the same treatment `src=` got.

A reference is `<notebook>#<cell-id>`, where `<notebook>` is a spine entry's file name
without `.prolog.md`:

```
ch04-cut#q-is-son
```

- Cell ids are unique **within a file** ([format §3](format.md)) and that does not change.
  Qualification is what makes them addressable across a binder.
- Resolvable only within a book. A lone notebook has no way to resolve a foreign reference
  and must report that plainly rather than rendering a dead link.
- This is what a cross-reference appendix is built from, and it is the reason to reserve it
  before anyone writes a chapter that wants one.

## 7. Editions

A book is where entitlement lives, because a book is where *ordering and completeness* live,
and those are what a reader buys.

```
prolog-notebook build book.md --edition=free
```

The edition selects which entries are emitted. **No notebook file ever carries an access
flag.** A `.prolog.md` is static text served to the reader; a gate inside it would be
theatre, and it would break the property that the file reads on GitHub. Gating happens at
build and serve time, never in the source. See [platform-seams.md](platform-seams.md).

## 8. What this is not

- **Not a monorepo convention.** A book does not require its notebooks to be in one
  directory, one repo, or one owner's hands.
- **Not a nested cell tree.** Cells belong to notebooks. Notebooks belong to no one.
- **Not a shared execution context.** Bound notebooks are as independent as unbound ones.
  If a chapter needs chapter 3's database, it cites the `.pl` file chapter 3 also cites.
