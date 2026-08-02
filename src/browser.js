// Browser entry point. The swipl-wasm bundle is loaded by a <script> tag and
// exposes a global SWIPL factory; keeping the load out of this module means the
// 5.9 MB bundle is fetched by the page, not by a bundler.
import { PrologSession } from './engine.js';

export * from './engine.js';

let session = null;

/**
 * Boot (once) and return the shared session for this page.
 * @returns {Promise<PrologSession>}
 */
export function createSession(options = {}) {
  if (!session) {
    if (typeof globalThis.SWIPL !== 'function') {
      throw new Error(
        'swipl-wasm not found. Load it first, e.g.\n' +
          '<script src="node_modules/swipl-wasm/dist/swipl/swipl-bundle.js"></script>'
      );
    }
    session = PrologSession.create(globalThis.SWIPL, options);
  }
  return session;
}
