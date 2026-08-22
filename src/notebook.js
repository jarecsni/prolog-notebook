// Browser wiring: turns marked-up cells in a page into a running notebook.
//
// Deliberately not a framework. A page declares its cells as ordinary elements and
// calls mount(); the DOM is the notebook. A file-backed renderer (reading markdown
// and generating these cells) is the next layer up.
//
// The engine runs in a worker (src/browser.js), so every call here is awaited and
// a goal that never terminates leaves the page usable. That is not a nicety: a
// Prolog chapter has to be able to demonstrate non-termination.
import { createSession, formatSolution } from './browser.js';
import { definedPredicates, unknownProcedure } from './clauses.js';

let serial = 0;
let booted = false;

// Whoever is showing the engine's state. A set rather than a variable because
// mount() can be called on more than one root in a page (an embedded notebook,
// v0.4), and each of them gets its own bar.
const engineWatchers = new Set();

function announce(state) {
  for (const watcher of engineWatchers) watcher(state);
}

/** Absolute, never relative: "3 minutes ago" is wrong the moment it is written. */
function clock(date = new Date()) {
  return date.toLocaleTimeString(undefined, { hour12: false });
}

export function mount(root = document, options = {}) {
  // A page can carry a #boot-warning element saying "this notebook is not running".
  // It is removed only once mount() has actually run, so any failure that prevents
  // this module from loading — opening the page over file://, a bad path, a syntax
  // error — leaves the warning on screen instead of silently inert buttons.
  document.getElementById('boot-warning')?.remove();

  // Document order matters, and it is the only thing that does. A query is run
  // against the program cells ABOVE it, and a predicate it cannot find may be
  // defined in one BELOW it — which is worth saying rather than leaving as
  // "Unknown procedure".
  const cells = [...root.querySelectorAll('.cell')];
  const programs = [];
  cells.forEach((cell, index) => {
    if (cell.classList.contains('program')) programs.push({ index, ...mountProgram(cell, options) });
  });
  cells.forEach((cell, index) => {
    if (!cell.classList.contains('query')) return;
    mountQuery(cell, options, {
      above: programs.filter((p) => p.index < index),
      below: programs.filter((p) => p.index > index),
    });
  });

  if (programs.length) mountEngineBar(root, options, programs);
}

/**
 * The engine's own state, and the one control that acts on all of it.
 *
 * CHROME, NOT CONTENT: built here at runtime rather than emitted into the
 * document, so a built page, an EPUB or the GitHub view never carries a button
 * that cannot work.
 *
 * Restart is page-level and deliberately not per-cell. Un-consulting one cell
 * immediately raises "what happens to the cells that depended on it", which is a
 * dependency story we do not have and do not need (869eddzfp); throwing the whole
 * engine away and replaying the consult log has no such question, and costs about
 * 3.5 ms a cell.
 */
function mountEngineBar(root, options, programs) {
  const host = root === document ? document.querySelector('main') ?? document.body : root;
  const bar = document.createElement('div');
  bar.className = 'engine-bar';
  bar.innerHTML = '<span class="engine-state"></span>'
    + '<button data-act="restart" disabled>restart engine</button>';
  const state = bar.querySelector('.engine-state');
  const restart = bar.querySelector('[data-act="restart"]');

  const say = (text, title) => {
    state.textContent = text;
    if (title) state.title = title;
    else state.removeAttribute('title');
  };

  // Visible proof of the property the chapter is built on: nothing has been
  // downloaded, and the answers above are still there to read.
  say('engine not started', 'the chapter is showing its saved answers; 5.9 MB of WebAssembly arrives when you press Run');

  engineWatchers.add((event) => {
    if (event.kind === 'started') {
      restart.disabled = false;
      say(`engine started at ${event.at}`, 'SWI-Prolog is running in a Web Worker');
    }
    if (event.kind === 'restarted') {
      say(`engine restarted at ${event.at} \u00b7 ${event.cells} cell(s) re-consulted`,
        'assert/retract state is gone; the clauses in your cells were loaded again');
    }
  });

  restart.addEventListener('click', async () => {
    restart.disabled = true;
    say('restarting\u2026');
    try {
      const session = await createSession(options);
      await session.restart();
      announce({ kind: 'restarted', at: clock(), cells: [...session.log].length });
    } catch (e) {
      say(`restart failed: ${e.message}`);
    } finally {
      restart.disabled = false;
    }
  });

  host.appendChild(bar);
}

/** Boot the engine, reporting the first (slow, 5.9 MB) load through `status`. */
async function boot(options, status) {
  if (!booted && status) {
    status.textContent = 'starting SWI-Prolog (5.9 MB, first time only)…';
    status.className = 'status busy';
  }
  const wasBooted = booted;
  const session = await createSession(options);
  booted = true;
  if (!wasBooted) announce({ kind: 'started', at: clock() });
  return session;
}

function mountProgram(cell, options) {
  const source = cell.querySelector('textarea');
  const button = cell.querySelector('[data-act="consult"]') ?? cell.querySelector('button');
  const resetBtn = cell.querySelector('[data-act="reset"]');
  const status = cell.querySelector('.status');
  // One cell, one virtual file. A generated cell carries its notebook id, so SWI
  // says "/p-family.pl" when this cell redefines another's clauses — a warning
  // that names a cell the reader can actually find in the source.
  const name = cell.dataset.cell || `cell-${serial++}`;

  // The chapter's own version of this cell, for the way back. Correct today,
  // because mount() runs against markup generated straight from the file. It
  // becomes WRONG the moment a scratchpad restores the reader's edits before
  // mount (869ectt5d) — at that point this must come from the parsed model.
  const published = source.value;

  // What the engine is actually holding for this cell, and when it took it.
  let loaded = null;

  autosize(source);

  /**
   * Say what is true, which is not always what the reader last pressed.
   *
   * A tick that still says "consulted" over text the reader has since edited is
   * reassuring and wrong — and it became easy to hit the moment Run started
   * consulting cells by itself (869ejgyaa).
   */
  const refresh = () => {
    if (resetBtn) resetBtn.disabled = source.value === published;
    if (!loaded) return;
    const at = `consulted at ${loaded.at}`;
    if (source.value !== loaded.text) {
      status.textContent = 'edited since consulted';
      status.className = 'status warn';
      status.title = `${at}; press Consult to load your changes`;
      return;
    }
    status.textContent = loaded.warning ?? '✓ consulted';
    status.className = `status ${loaded.warning ? 'warn' : 'ok'}`;
    status.title = at;
  };

  const consult = async (session) => {
    const text = source.value;
    const r = await session.consult(text, name);
    // A warning here usually means this cell has just destroyed another
    // cell's clauses, which the reader has no other way of finding out.
    const warning = r.messages && r.messages.find((m) => m.kind === 'warning');
    if (r.ok) {
      loaded = { text, at: clock(), warning: warning ? warning.text : null };
      refresh();
    } else {
      loaded = null;
      status.textContent = r.error;
      status.className = 'status err';
      status.removeAttribute('title');
    }
    return r;
  };

  source.addEventListener('input', refresh);

  button.addEventListener('click', async () => {
    const label = button.textContent;
    button.disabled = true;
    button.textContent = 'Working…';
    try {
      await consult(await boot(options, status));
    } catch (e) {
      status.textContent = e.message;
      status.className = 'status err';
    } finally {
      button.disabled = false;
      button.textContent = label;
    }
  });

  resetBtn?.addEventListener('click', async () => {
    source.value = published;
    source.dispatchEvent(new Event('input'));
    // Put the engine back too, or the page and the engine disagree — which is
    // the whole thing this ticket exists to stop.
    if (loaded) await consult(await boot(options, status));
  });

  return {
    name,
    /**
     * Load this cell unless it is already loaded at exactly this text.
     *
     * Cheap enough to do on every Run: the second Run of a chapter consults
     * nothing at all, and an edited cell invalidates itself and nothing else.
     */
    ensure: async (session) =>
      (session.log.isCurrent(name, source.value) ? { ok: true } : consult(session)),
    /** What this cell defines, used only to explain an error, never to run one. */
    defines: () => definedPredicates(source.value),
  };
}

function mountQuery(cell, options, { above = [], below = [] } = {}) {
  const input = cell.querySelector('input');
  const runBtn = cell.querySelector('[data-act="run"]');
  const nextBtn = cell.querySelector('[data-act="next"]');
  const allBtn = cell.querySelector('[data-act="all"]');
  const stopBtn = cell.querySelector('[data-act="stop"]');
  const out = cell.querySelector('.out');

  let query = null;
  let session = null;
  let count = 0;
  let running = false;
  let aborting = false;

  const write = (text, cls) => {
    const line = document.createElement('div');
    line.className = `line ${cls || ''}`;
    line.textContent = text;
    out.appendChild(line);
    out.scrollTop = out.scrollHeight;
  };

  const finish = () => {
    query = null;
    running = false;
    // Run must come back, whatever ended the query. Leaving it disabled after a
    // Stop turns a rescued page into a dead one, which is worse than the freeze
    // this whole mechanism exists to prevent.
    runBtn.disabled = false;
    nextBtn.disabled = true;
    allBtn.disabled = true;
    if (stopBtn) stopBtn.disabled = true;
  };

  /** While a goal is in flight the only useful button is Stop. */
  const setRunning = (state) => {
    running = state;
    runBtn.disabled = state;
    nextBtn.disabled = state || !query;
    allBtn.disabled = state || !query;
    if (stopBtn) stopBtn.disabled = !state;
  };

  /**
   * Load every program cell above this query, in document order.
   *
   * Consult order cannot affect correctness — Prolog has no load-time name
   * binding, so `q(X) :- p(X)` merely mentions p/1 and the lookup happens when
   * it is called. So there is no dependency graph to compute, and at ~3.5 ms a
   * cell there is nothing to gain by computing one.
   */
  const loadPrograms = async (session) => {
    for (const program of above) {
      const r = await program.ensure(session);
      // Running a query against a chapter that failed to load would answer a
      // question the reader did not ask.
      if (!r.ok) return { ok: false, name: program.name, error: r.error };
    }
    return { ok: true };
  };

  /**
   * "Unknown procedure: son_a/1" is true and unhelpful when the cell defining
   * son_a/1 is two inches further down the page.
   */
  const locate = (message) => {
    const indicator = unknownProcedure(message);
    if (!indicator) return null;
    const cell = below.find((program) => program.defines().has(indicator));
    return cell
      ? `${indicator} is defined below this query, in cell ${cell.name}. Press Consult there, or move that cell above the query.`
      : null;
  };

  const step = async () => {
    if (!query || running) return false;
    setRunning(true);
    try {
      const r = await query.next();
      // r.text is rendered by SWI itself, so operators and quoting are right.
      if (r.solution) write(`${++count}.  ${r.text ?? formatSolution(r.solution)}`, 'sol');
      if (r.error) {
        write(r.error, 'err');
        const hint = locate(r.error);
        if (hint) write(hint, 'done');
        finish();
        return false;
      }
      if (r.done) {
        write(count === 0 ? 'false.' : 'no more solutions.', 'done');
        finish();
        return false;
      }
      setRunning(false);
      return true;
    } catch (e) {
      // An abort rejects whatever was in flight. When the reader asked for that,
      // it is not an error and saying "aborted" in red suggests something broke.
      if (!aborting) write(e.message, 'err');
      finish();
      return false;
    }
  };

  runBtn.addEventListener('click', async () => {
    // The chapter's saved answers are on screen until this moment. Replacing them
    // with the reader's own is fine; replacing them SILENTLY is not, so the run is
    // labelled and the way back is stated (docs/modes.md §3). Reload is that way
    // back until a scratchpad exists (869ectt5d).
    const hadSaved = out.querySelector('.line.from') !== null;
    out.innerHTML = '';
    count = 0;
    const goal = input.value.trim().replace(/\.$/, '');
    if (!goal) return;
    write(hadSaved
      ? `your run \u00b7 ${clock()} \u00b7 reload for the chapter\u2019s saved answers`
      : `your run \u00b7 ${clock()}`, 'from');
    write(`?- ${goal}.`, 'echo');
    setRunning(true);
    try {
      if (!booted) write('starting SWI-Prolog (5.9 MB, first time only)…', 'done');
      session = await boot(options);
      const loaded = await loadPrograms(session);
      if (!loaded.ok) {
        write(`cell ${loaded.name} did not load: ${loaded.error}`, 'err');
        finish();
        return;
      }
      query = session.query(goal);
      setRunning(false);
      await step();
    } catch (e) {
      write(e.message, 'err');
      finish();
    }
  });

  nextBtn.addEventListener('click', step);

  allBtn.addEventListener('click', async () => {
    let guard = 0;
    while (query && guard++ < 500) {
      if (!(await step())) break;
    }
    if (guard >= 500) write('stopped after 500 solutions.', 'done');
  });

  stopBtn?.addEventListener('click', async () => {
    if (!session) return;
    aborting = true;
    stopBtn.disabled = true;
    write('stopping…', 'done');
    // Terminating the worker is the only thing that reaches a goal already
    // spinning inside WASM. The consults are replayed into the new engine, so the
    // clause store is back exactly as it was; only assert/retract state is lost,
    // which format §8 already says needs a restart anyway.
    await session.abort();
    write('stopped. the engine was restarted and every cell re-consulted.', 'done');
    finish();
    aborting = false;
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') runBtn.click();
    if (e.key === ';') {
      e.preventDefault();
      if (!nextBtn.disabled) step();
    }
  });
}

function autosize(ta) {
  const fit = () => {
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight}px`;
  };
  ta.addEventListener('input', fit);
  requestAnimationFrame(fit);
}
