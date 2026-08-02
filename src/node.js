// Node entry point: boots the engine with the swipl-wasm Node build.
import SWIPL from 'swipl-wasm/dist/swipl-node.js';
import { PrologSession } from './engine.js';

export * from './engine.js';

/** @returns {Promise<PrologSession>} a session running in this Node process. */
export function createSession(options = {}) {
  return PrologSession.create(SWIPL, options);
}
