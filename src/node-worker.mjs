// The engine, in a thread the CLI can kill (869ejgyax).
//
// `loop :- loop.` has the thread and will not give it back. In the browser that
// costs a reader one click on Stop, because the engine has always run in a
// Worker there; in Node it blocked the only thread there was, so a deadline
// timer could not fire and the process had to be killed by hand. Measured: a 3 s
// timer never fired.
//
// This is the same shape as the browser's answer — the engine somewhere that can
// be terminated — with none of its protocol, because the CLI does not step
// queries. One message in, a stream of progress out, one message at the end.
//
// Everything here is plumbing. The Prolog is in run.js and does not know it is in
// a thread.
import { parentPort } from 'node:worker_threads';
import { parse } from './format.js';
import { runNotebook } from './run.js';

let session = null;

parentPort.on('message', async ({ source, limit }) => {
  try {
    // BOOTED ON FIRST USE AND KEPT, so a book of twenty chapters pays for the
    // engine once. The parent throws this whole thread away when a goal runs
    // away, which is also what gives the next chapter a clean store.
    if (!session) {
      const { createSession } = await import('./node.js');
      session = await createSession();
    } else {
      await session.reset();
    }
    const notebook = parse(source);
    const { edits, failures, warnings } = await runNotebook(notebook, session, {
      limit,
      onCell: (event) => parentPort.postMessage({ kind: 'cell', event }),
    });
    parentPort.postMessage({
      kind: 'done', edits: [...edits], failures, warnings,
    });
  } catch (e) {
    parentPort.postMessage({ kind: 'failed', message: e?.message ?? String(e) });
  }
});
