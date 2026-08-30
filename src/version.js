// Who this is, in one place, for everything that has to say so.
//
// The command reads package.json at run time; a page cannot — there is no
// filesystem behind a `<script type="module">` and no build step to inline
// anything. So the facts live here, as constants both can import, and tests
// assert that they still agree with package.json and with LICENSE. Two files to
// touch at release, and a suite that fails loudly when only one of them is.

/** The name a person would say. `prolog-notebook` is what npm installs. */
export const NAME = 'Prolog Notebook';

/** Must equal package.json's `version` — test/run.test.mjs enforces it. */
export const VERSION = '0.6.1';

/** The two facts a licence notice is actually made of. */
export const YEAR = '2026';
export const HOLDER = 'Johnny Jarecsni';

/** Must agree with LICENSE on the year and the holder. Same enforcement. */
export const COPYRIGHT = `Copyright (C) ${YEAR} ${HOLDER}`;

export const LICENSE = 'MIT';

/**
 * The line a command prints and a page shows in its panel, so the two cannot
 * describe the same release differently.
 *
 * @returns {string} e.g. "Prolog Notebook v0.2.0 - Copyright (C) 2026 … , MIT License."
 */
export function banner() {
  return `${NAME} v${VERSION} - ${COPYRIGHT}, ${LICENSE} License.`;
}

/**
 * The same facts for a page, which has a card to fit them in rather than a
 * terminal to fill.
 *
 * TWO SHORT LINES BY CONSTRUCTION, not by shrinking the type: what is running,
 * then who owns it. The engine's version joins the first line once it is known,
 * because that line is the identity of the thing doing the work — and `©` rather
 * than `Copyright (C)` because that is how a page writes it, while the words in
 * both come from the same constants.
 *
 * @returns {{running: string, legal: string}}
 */
export function colophon() {
  return {
    running: `${NAME} v${VERSION}`,
    legal: `© ${YEAR} ${HOLDER} · ${LICENSE} License`,
  };
}
