// The engine's home. A CLASSIC worker, deliberately.
//
// swipl-wasm ships only UMD/global scripts — `var SWIPL = …` at top level, with no
// ESM export — so a module worker's `import()` would hand back an empty namespace.
// importScripts is the only thing that puts SWIPL where we can reach it. Our own
// engine is an ES module, and dynamic import() works fine inside a classic worker,
// so nothing has to be bundled or duplicated to get both here.
//
// Everything in this file is protocol plumbing. The Prolog lives in engine.js and
// is not aware it is in a worker.

/* global importScripts */

let session = null;
const queries = new Map();
let nextQueryId = 1;

self.onmessage = async ({ data }) => {
  const { id, op } = data;
  try {
    self.postMessage({ id, ok: true, value: await handle(op, data) });
  } catch (error) {
    self.postMessage({ id, ok: false, error: error?.message ?? String(error) });
  }
};

async function handle(op, args) {
  switch (op) {
    case 'boot': {
      importScripts(args.swiplUrl);
      const { PrologSession } = await import(args.engineUrl);
      if (typeof self.SWIPL !== 'function') {
        throw new Error(`swipl-wasm did not define SWIPL after loading ${args.swiplUrl}`);
      }
      session = await PrologSession.create(self.SWIPL, args.options ?? {});
      return true;
    }

    case 'consult':
      return session.consult(args.text, args.name);

    case 'open': {
      const qid = nextQueryId++;
      queries.set(qid, session.query(args.goal));
      return qid;
    }

    case 'next': {
      const query = queries.get(args.qid);
      if (!query) throw new Error(`no open query ${args.qid}`);
      const result = query.next();
      if (result.done) queries.delete(args.qid);
      return result;
    }

    case 'all': {
      const query = queries.get(args.qid);
      if (!query) throw new Error(`no open query ${args.qid}`);
      queries.delete(args.qid);
      return query.all(args.limit);
    }

    case 'close': {
      // CLOSING MUST REACH THE ENGINE. Forgetting the id here — which is all this
      // did until 869epzqpc — leaves the query open inside SWI for the life of
      // the session, and every later query then nests inside a frame nobody can
      // ever step or release.
      const query = queries.get(args.qid);
      queries.delete(args.qid);
      query?.close();
      return true;
    }

    default:
      throw new Error(`unknown worker op "${op}"`);
  }
}
