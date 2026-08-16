// Node entry point: boots the engine with the swipl-wasm Node build, in this
// process.
//
// Same async interface as the browser (src/session.js), so the CLI, the tests and
// a VS Code controller are all written the same way — but WITHOUT the worker, so
// a non-terminating goal blocks this process. That is a deliberate, stated limit
// rather than an oversight: the browser is where a frozen thread costs a reader
// their tab, and where the worker therefore earns its complexity.
import SWIPL from 'swipl-wasm/dist/swipl-node.js';
import { PrologSession } from './engine.js';
import { InProcessSession } from './session.js';

export * from './engine.js';
export { InProcessSession, ConsultLog } from './session.js';

/** @returns {Promise<InProcessSession>} a session running in this Node process. */
export async function createSession(options = {}) {
  const build = () => PrologSession.create(SWIPL, options);
  return new InProcessSession(await build(), build);
}
