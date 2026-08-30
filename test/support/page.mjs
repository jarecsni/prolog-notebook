// A notebook, rendered and mounted, in a DOM that is not a browser.
//
// src/notebook.js was the one source file with no tests, and it produced both of
// the bugs a reader actually hit this week — a panel that stopped animating and a
// Hide control that jammed once a query had been run (869enpj26). Neither was
// findable from Node, because everything else in this project is DOM-free by
// design and the file that is not was therefore unreachable.
//
// Two seams close that. jsdom supplies the document; `createSession` supplies a
// FAKE ENGINE, so a test can watch what the page does without spawning a worker
// and 36 MB of WebAssembly. The real engine has its own tests in
// session.test.mjs — this file is for the page's behaviour, not Prolog's.
import { JSDOM } from 'jsdom';
import { parse } from '../../src/format.js';
import { renderNotebook } from '../../src/render.js';
import { mount, offerDownload } from '../../src/notebook.js';
import { ConsultLog } from '../../src/session.js';

/**
 * An engine that answers from a script instead of from Prolog.
 *
 * It records what it was asked to do, because most of what these tests care about
 * is whether the page and the engine agree: a cell that says "consulted" when
 * nothing was consulted is the failure this whole project is arranged against.
 *
 * @param {{answers?: Record<string, string[]>, fail?: Record<string, string>}} script
 *   answers by goal, and consults that should fail by cell name
 */
export function fakeEngine({ answers = {}, fail = {} } = {}) {
  const engine = {
    consulted: [],
    unconsulted: [],
    restarts: 0,
    // The REAL log, not a stand-in. It is DOM-free, it is already tested, and the
    // page asks it real questions — `isCurrent` is what makes the second Run of a
    // chapter consult nothing. A fake that answered those differently would be
    // testing a notebook we do not ship.
    log: new ConsultLog(),

    async consult(text, name) {
      engine.consulted.push({ name, text });
      if (fail[name]) return { ok: false, error: fail[name] };
      engine.log.record(name, text);
      return { ok: true, error: null };
    },

    async unconsult(name) {
      engine.unconsulted.push(name);
      engine.log.forget(name);
      return { ok: true, unloaded: true };
    },

    async restart() {
      engine.restarts++;
      return engine;
    },

    async abort() {
      engine.restarts++;
      return engine;
    },

    /**
     * One open sequence, exactly as both real sessions have since 869epzqpc.
     *
     * A fake that let two queries be open at once would let the page pass a test
     * the engine could never pass: SWI keeps open queries on a stack and refuses
     * to step anything but the innermost. The real invariant is proved against a
     * real engine in session.test.mjs; this is here so the PAGE is tested against
     * an engine that behaves like the one it will meet.
     */
    query(goal) {
      const solutions = [...(answers[goal] ?? [])];
      engine.supersede();
      const query = {
        superseded: false,
        onSuperseded: null,
        async next() {
          if (query.superseded) return { done: true, superseded: true };
          if (!solutions.length) {
            engine.release(query);
            return { done: true };
          }
          return { solution: {}, text: solutions.shift() };
        },
        async close() {
          engine.release(query);
        },
      };
      engine.open = query;
      return query;
    },

    /** The query holding the engine's one frame, or null. */
    open: null,

    /** Close whatever is open, and tell it — the sessions' own seam, same name. */
    supersede() {
      const previous = engine.open;
      engine.open = null;
      if (!previous) return;
      previous.superseded = true;
      previous.onSuperseded?.();
    },

    release(query) {
      if (engine.open === query) engine.open = null;
    },
  };
  return engine;
}

/**
 * Render a notebook and wire it up, exactly as page.js does in a browser.
 *
 * The globals are set rather than passed because that is what browser code does:
 * notebook.js reaches for `document`, and pretending otherwise in the test would
 * be testing a different file. Each call replaces them, so tests are independent
 * in the only way that matters — nothing here is module state any more.
 */
export function pageFor(source, { engine = fakeEngine(), download, published } = {}) {
  const notebook = parse(source);
  const dom = new JSDOM(`<!doctype html><html><body><main>${renderNotebook(notebook)}</main></body></html>`, {
    pretendToBeVisual: true,
  });
  const { window } = dom;
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.Node = window.Node;
  globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);

  const root = window.document.querySelector('main');
  // Counted, because "the page never starts an engine the reader did not ask
  // for" is a promise this project makes twice — on load, and for rerun="auto"
  // (869eddzgq) — and the only honest way to assert it is to watch the seam.
  let boots = 0;
  const cells = mount(root, { createSession: async () => { boots++; return engine; } });
  if (download) offerDownload(root, download, published);

  const find = (selector) => window.document.querySelector(selector);
  const cell = (id) => window.document.querySelector(`[data-cell="${id}"]`);

  return {
    notebook, dom, window, root, cells, engine, find, cell,

    /** How many times the page has asked for an engine. */
    boots: () => boots,

    /** A cell's visible output, one line per entry, chrome stripped. */
    out: (id) => [...cell(id).querySelectorAll('.out .line')]
      .map((line) => line.textContent.trim())
      .filter(Boolean),

    /** What a cell's tick says right now. */
    status: (id) => cell(id).querySelector('.status')?.textContent ?? '',

    /** Press something, by cell and action. */
    press: (id, act) => cell(id).querySelector(`[data-act="${act}"]`).click(),

    /** Press something in the page's own controls. */
    pressPage: (act) => find(`.page-controls [data-act="${act}"]`).click(),

    /** Type into a cell, the way a reader does — the event is what the page hears. */
    type: (id, text) => {
      const field = cell(id).querySelector('textarea') ?? cell(id).querySelector('input');
      field.value = text;
      field.dispatchEvent(new window.Event('input', { bubbles: true }));
    },

    /** Write a prediction and leave the box, which is what releases a hold. */
    predict: (text) => {
      const box = find('.predict textarea');
      box.value = text;
      box.dispatchEvent(new window.Event('input', { bubbles: true }));
      box.dispatchEvent(new window.Event('change', { bubbles: true }));
    },

    /** Choose which version the download button will hand over. */
    chooseVersion: (value) => {
      const select = find('.page-controls .picker select');
      select.value = value;
      select.dispatchEvent(new window.Event('change', { bubbles: true }));
    },

    /** The page controls, as a reader reads them. */
    panel: () => ({
      open: find('.page-controls').dataset.open === 'true',
      engine: find('.page-controls .count').textContent,
      answers: find('.answers-state')?.textContent ?? null,
      answersButton: find('[data-act="peek-all"]')?.querySelector('.label').textContent ?? null,
      answersDisabled: find('[data-act="peek-all"]')?.disabled ?? null,
      // Whichever of the two the row is showing: a phrase, or the chosen option.
      notebook: (() => {
        const picker = find('.page-controls .picker');
        if (!picker) return null;
        if (picker.hidden) return find('.page-controls .only').textContent;
        const select = picker.querySelector('select');
        return select.options[select.selectedIndex].textContent;
      })(),
      choices: (() => {
        const picker = find('.page-controls .picker');
        if (!picker || picker.hidden) return null;
        return [...picker.querySelectorAll('option')].map((o) => o.textContent);
      })(),
      about: find('.page-controls .about .running')?.textContent ?? null,
      legal: find('.page-controls .about .legal')?.textContent ?? null,
      engineVersion: find('.page-controls .about .engine-version')?.textContent ?? null,
    }),

    hidden: (id) => cell(id).querySelector('.out').classList.contains('answers-hidden'),

    /**
     * Let the page's promises settle.
     *
     * A press starts a chain of awaits — boot, then consult each program above,
     * then open the query, then take the first solution — and each link is a
     * turn. Nothing here polls or waits on a clock, so a handful of turns is the
     * whole of it.
     */
    settle: async (turns = 8) => {
      for (let i = 0; i < turns; i++) await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}
