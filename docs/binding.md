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
5. **Generated matter is build output.** TOC, index and cross-reference appendices are
   emitted by `build` and are never files an author edits. If it can be derived, it is not
   source.

## 3. The spine file

The spine is a **markdown file**, for the same reason the notebook is: it reads on GitHub
with no build step, and it needs no parser we do not already have.

```markdown
---
format: prolog-notebook-book/1
kicker: Programming in Prolog · a study binder
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

Entries may be a URL rather than a relative path, once notebooks are hosted. Resolution goes
through the injectable filesystem, never Node's `fs` — see [platform-seams.md](platform-seams.md).

## 4. Kicker, and where chapter numbers live

A chapter has **two names**, and the existing example page shows both:

```
CHAPTER 4 · CUT AND CONTROL     ← the kicker: the formal name, what a TOC lists
Where does the fence go?        ← the H1: the editorial name, what the page is called
```

The formal name is already in the spine — it is the entry's link text. So:

> **The kicker of a bound notebook is the spine's label for that entry.**

One string, used for the kicker, the table of contents and the navigation, so the three
cannot drift apart. The notebook keeps its `# H1` and is not touched.

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

### Standalone

Built alone, a notebook uses its own front-matter `kicker` and shows **no number**. That key
is the notebook's opinion about itself, which is legitimate; a position is not. `--check`
warns — does not fail — when it looks like a chapter number has been written into one.

Reordering the spine renumbers the book and touches no notebook file. That is the whole point.

## 5. Cross-notebook references

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

## 6. Editions

A book is where entitlement lives, because a book is where *ordering and completeness* live,
and those are what a reader buys.

```
prolog-notebook build book.md --edition=free
```

The edition selects which entries are emitted. **No notebook file ever carries an access
flag.** A `.prolog.md` is static text served to the reader; a gate inside it would be
theatre, and it would break the property that the file reads on GitHub. Gating happens at
build and serve time, never in the source. See [platform-seams.md](platform-seams.md).

## 7. What this is not

- **Not a monorepo convention.** A book does not require its notebooks to be in one
  directory, one repo, or one owner's hands.
- **Not a nested cell tree.** Cells belong to notebooks. Notebooks belong to no one.
- **Not a shared execution context.** Bound notebooks are as independent as unbound ones.
  If a chapter needs chapter 3's database, it cites the `.pl` file chapter 3 also cites.
