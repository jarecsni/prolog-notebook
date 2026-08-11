# Platform seams

Status: **decisions recorded 2026-08-10.** No platform is being built. This document exists
so that building one later is a matter of adding code, not undoing decisions.

## The direction

**A now, B later, deliberately.**

- **A — author.** The renderer, CLI and extension are MIT and free. Content is the product:
  notebooks, binders, the workbook tier (exercises and checks, v0.7), and paid offline
  artefacts (PWA bundle, iPad app).
- **B — publishing platform.** Other people publish Prolog-notebook books, with hosting,
  identity, entitlement and payment. This is a company, and it is not being started today.

The one thing that turns B from "a rewrite" into "more code" is keeping the seams below
open. Each costs little now and is expensive to retrofit, which is the same argument that
won [869edpd0z](https://app.clickup.com/t/869edpd0z) (GUI-editable format) before any parser
existed.

This supersedes the "EXPLICITLY NOT BUILDING … that is a company, not a feature" paragraph
in [869edp58c](https://app.clickup.com/t/869edp58c) to this extent: *not building it now*
still holds; *never building it* does not.

## The seams

**1. The binder is the publishable unit.**
Ordering, completeness, editions and metadata live in the spine, not in notebooks. See
[binding.md](binding.md). A hosted catalogue is a catalogue of spines.

**2. Entitlement is applied at build and serve time — never inside a notebook file.**
`build --edition=free|full` emits different sites from the same source. A `.prolog.md` never
carries an access flag. Corollary, accepted openly: **delivered content cannot be
protected.** The platform sells delivery, updates, identity, verification and workflow. It
does not sell secrecy, and any design that pretends otherwise is lying to the customer.

**3. The filesystem is injectable, always.**
[format §4](format.md) already commits to this for `src=`; extend it to spine resolution and
the CLI. A hosted build reads from object storage or a git remote through the same interface
the VS Code *web* extension needs for `vscode.workspace.fs`
([869edptze](https://app.clickup.com/t/869edptze)). Highest-leverage seam on this list —
build it the day `src=` is built.

**4. Reader state goes behind a storage interface.**
Predictions, cell edits and exercise results are localStorage today
([869ectt5d](https://app.clickup.com/t/869ectt5d)). Define the interface, implement it with
localStorage, and an account-backed implementation later is a swap rather than a rewrite.
Roughly an hour, now.

**5. Queries must be abortable, time-limited and memory-capped, in the engine.**
A platform running `--check` over other people's notebooks executes untrusted Prolog on its
own infrastructure. WASM sandboxes memory safety; it does nothing about non-termination.
Partly implied already — `all()` takes a limit, and auto-rerun needs abort
([869eddzgq](https://app.clickup.com/t/869eddzgq)) — but it should be a first-class engine
capability while the engine is still small.

**6. Every visual decision lives in swappable CSS tokens.**
[869edyyvm](https://app.clickup.com/t/869edyyvm) locks the class vocabulary and palette, and
that stays. The requirement here is narrower: the generator emits **semantic classes only**
and never inline styles, so another author's theme is a stylesheet rather than a fork.

**7. The custom element is the distribution primitive.**
`<prolog-notebook src="…">` ([869ectt4u](https://app.clickup.com/t/869ectt4u)) with a `src`
that may be a URL is how a hosted notebook embeds in anyone's page. Design that URL scheme
as versioned and immutable.

**8. Format and renderer stay MIT.**
It is what makes a platform credible rather than predatory, and relicensing later burns the
goodwill that produced the authors. The hosted service is the paid part; the file format is
never the hostage.

## Formats and what runs where

| edition | runs Prolog | notes |
| --- | --- | --- |
| static site (any host) | yes | the default; engine lazy-loads on first Run |
| PWA / offline bundle | yes | full engine offline after first visit |
| iPad app | yes | engine bundled; nothing to download |
| GitHub view of the source | no | saved solution sequences read as prose |
| EPUB / PDF | **no** | see below |

**EPUB cannot run the engine.** EPUB 3 permits scripted content, but Kindle runs no
JavaScript at all, Kobo/Play Books/RMSDK are minimal-to-none, and only Apple Books is a
realistic candidate — where a packaged 5.9 MB `.wasm` still cannot be fetched normally and
workers are commonly blocked. Do not plan around it.

This costs less than it sounds. Because outputs are stored as **solution sequences**
([format §6](format.md)), an EPUB is a genuine book: every query with all of its answers in
SWI's own spelling, and `> [!predict]` reveals working natively as `<details>`. EPUB and PDF
are the *reading* editions. The paid *running* artefact is the PWA or the app.
