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
export const VERSION = '0.2.0';

/** Must agree with LICENSE on the year and the holder. Same enforcement. */
export const COPYRIGHT = 'Copyright (C) 2026 Johnny Jarecsni';

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
