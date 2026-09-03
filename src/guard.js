// A goal that will not stop, stopped (869ejgyax).
//
// `loop :- loop.` has the thread and will not give it back. The browser has
// always been safe — the engine runs in a Worker and Stop terminates it — and
// Node was not: the engine ran in the only thread there was, so a deadline timer
// could not fire and the process had to be killed by hand. Measured when the
// ticket was written: a 3 s timer never fired.
//
// So the CLI gets the same answer in the same shape: the engine somewhere that
// can be terminated. None of the browser's protocol comes with it, because the
// CLI does not step queries — one message in, progress out, one message at the
// end.
//
// THE DEADLINE IS ON PROGRESS, NOT ON TOTAL TIME. A chapter of fifty quick cells
// must never trip it however long it takes in total, and a single cell that has
// said nothing for half a minute is a runaway whatever else is true. That also
// makes the timer self-arming: every cell announces itself before it runs, so
// silence is the only thing being measured.
import { Worker } from 'node:worker_threads';
import { solutionSequence } from './format.js';

/** No progress for this long and the goal is not coming back. */
export const DEFAULT_TIMEOUT = 30;

export class Guarded {
  /**
   * @param {{limit: number, seconds?: number}} options
   *   `seconds` of 0 waits forever, for somebody who means it.
   */
  constructor({ limit, seconds = DEFAULT_TIMEOUT }) {
    this.limit = limit;
    this.seconds = seconds;
    this.worker = null;
  }

  /**
   * Run one chapter, and come back whatever happens.
   *
   * @param {string} source
   * @param {(event: object) => void} onCell
   * @returns {Promise<{edits: Map, failures: object[], warnings: object[], hung: object|null}>}
   */
  run(source, onCell = () => {}) {
    return new Promise((resolve, reject) => {
      // A FRESH ENGINE PER CHAPTER is the worker's own business (it resets
      // between messages); a fresh WORKER is only needed after a kill.
      if (!this.worker) this.worker = new Worker(new URL('./node-worker.mjs', import.meta.url));
      const worker = this.worker;

      const edits = new Map();
      let running = null;
      let timer = null;
      let settled = false;

      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        worker.off('message', hear);
        worker.off('error', fail);
        worker.off('exit', gone);
        resolve(value);
      };
      const fail = (e) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(e);
      };
      const gone = (code) => fail(new Error(`the engine stopped unexpectedly (exit ${code})`));

      const arm = () => {
        if (!this.seconds) return;
        clearTimeout(timer);
        timer = setTimeout(() => {
          // TERMINATED, NOT ASKED. There is nothing to ask: the thread is inside
          // the goal and will not read a message until it returns, which is the
          // thing it is not going to do.
          //
          // SETTLED BEFORE IT IS KILLED, because terminate() ends in an `exit`
          // that this would otherwise hear as a crash — and the crash would win
          // the race and throw away the answers already collected.
          this.worker = null;
          finish({ edits, failures: [], warnings: [], hung: running });
          worker.terminate();
        }, this.seconds * 1000);
      };

      const hear = (message) => {
        arm();
        if (message.kind === 'cell') {
          const { event } = message;
          if (event.kind === 'begin') running = { id: event.id, goal: event.goal };
          else if (event.kind === 'query') {
            edits.set(event.id, { output: solutionSequence(event) });
          }
          onCell(event);
          return;
        }
        if (message.kind === 'done') {
          finish({
            edits: new Map(message.edits),
            failures: message.failures,
            warnings: message.warnings,
            hung: null,
          });
          return;
        }
        if (message.kind === 'failed') fail(new Error(message.message));
      };

      worker.on('message', hear);
      worker.on('error', fail);
      worker.on('exit', gone);
      arm();
      worker.postMessage({ source, limit: this.limit });
    });
  }

  async close() {
    const worker = this.worker;
    this.worker = null;
    if (worker) await worker.terminate();
  }
}
