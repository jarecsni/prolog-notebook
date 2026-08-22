// Browser wiring: turns marked-up cells in a page into a running notebook.
//
// Deliberately not a framework. A page declares its cells as ordinary elements and
// calls mount(); the DOM is the notebook. A file-backed renderer (reading markdown
// and generating these cells) is the next layer up.
//
// The engine runs in a worker (src/browser.js), so every call here is awaited and
// a goal that never terminates leaves the page usable. That is not a nicety: a
// Prolog chapter has to be able to demonstrate non-termination.
//
// WHY THERE IS SO MUCH STATE IN HERE. A reader is looking at three things that can
// disagree: the text on screen, what the engine is holding, and the answers below.
// Any two of them come apart in a single click. So every cell answers the same two
// questions at all times — is this still what the chapter published, and does the
// engine agree with what I can see — through a tick that names its state and a
// reset that undoes it. A blank tick beside a greyed button is indistinguishable
// from a broken page, which is how an earlier version of this file read.
import { createSession, formatSolution } from './browser.js';
import { definedPredicates, unknownProcedure } from './clauses.js';

let serial = 0;
let panels = 0;
let booted = false;

/** Absolute, never relative: "3 minutes ago" is wrong the moment it is written. */
function clock(date = new Date()) {
  return date.toLocaleTimeString(undefined, { hour12: false });
}

/**
 * One notebook's internal notifications.
 *
 * Cells have to hear about each other: answers stop being current when a program
 * cell ABOVE them changes, and no query can notice that by itself. Created per
 * mount() rather than per module, because a page may hold more than one notebook
 * (an embedded chapter, v0.4) and one notebook's edits are not another's.
 */
function createBus() {
  const watchers = new Set();
  return {
    on: (watcher) => watchers.add(watcher),
    emit: (event) => { for (const watcher of watchers) watcher(event); },
  };
}

export function mount(root = document, options = {}) {
  // A page can carry a #boot-warning element saying "this notebook is not running".
  // It is removed only once mount() has actually run, so any failure that prevents
  // this module from loading — opening the page over file://, a bad path, a syntax
  // error — leaves the warning on screen instead of silently inert buttons.
  document.getElementById('boot-warning')?.remove();

  const bus = createBus();

  // Document order matters, and it is the only thing that does. A query is run
  // against the program cells ABOVE it, and a predicate it cannot find may be
  // defined in one BELOW it — which is worth saying rather than leaving as
  // "Unknown procedure".
  const cells = [...root.querySelectorAll('.cell')];
  const programs = [];
  cells.forEach((cell, index) => {
    if (cell.classList.contains('program')) programs.push({ index, ...mountProgram(cell, options, bus) });
  });
  const queries = [];
  cells.forEach((cell, index) => {
    if (!cell.classList.contains('query')) return;
    queries.push(mountQuery(cell, options, bus, {
      above: programs.filter((p) => p.index < index),
      below: programs.filter((p) => p.index > index),
    }));
  });

  if (programs.length) mountPageBar(root, options, bus, programs, queries);
}

/**
 * The controls that belong to the page rather than to any one cell: what the
 * engine is holding, whether the chapter is showing its answers, and the one
 * button that acts on all of the first.
 *
 * CHROME, NOT CONTENT: built here at runtime rather than emitted into the
 * document, so a built page, an EPUB or the GitHub view never carries a button
 * that cannot work.
 *
 * Sticky, which is a fix rather than a flourish: this is where the answer to
 * "what is the engine holding now" lives, and a reader who has to scroll to the
 * end of the chapter to see it will read every cell above as unexplained.
 *
 * But a chapter is for reading, and a full-width bar pinned across the foot of
 * every page is a tool insisting on itself. So it is a lozenge in the corner
 * carrying the state at a glance — a dot and a word — and clicking it WIDENS THAT
 * SAME LOZENGE leftward until its controls fit. The thing the reader clicked is
 * the thing that opens.
 *
 * On a click, not on hover: hover opens a panel nobody asked for, does not exist
 * on a touch screen, and cannot be reached from a keyboard, so one gesture that
 * works everywhere beats three that do not.
 *
 * It opens itself for a few seconds when the engine's state actually changes,
 * which is the moment its words are worth reading, and closes on Escape, on a
 * click elsewhere, or on a second click of the lozenge.
 */
/**
 * The small line icons the page controls use.
 *
 * THE RULE, because "should this icon show the state or the action?" has a
 * different obvious answer every time it is asked, and answering it per control
 * is how a vocabulary rots:
 *
 *   A LIGHT SAYS WHAT IS TRUE.  AN ICON SAYS WHAT WILL HAPPEN.
 *
 * So every glyph in a button depicts that button's verb — the eye with a stroke
 * through it means "hide these", not "these are hidden" — and the one piece of
 * pure status, the engine's dot, is deliberately not an icon at all. It is a
 * light: grey for no engine, amber while one is arriving, green once it is
 * running. Nothing has to be read to see it.
 *
 * The chevron is the lozenge's own verb (it opens the panel), which is why the
 * lozenge can carry a status word without becoming a button that lies: the light
 * and the word are the state, the chevron is the action, and they are visibly
 * different things.
 *
 * Inline SVG rather than a font or a file: this is chrome built at runtime, and a
 * control that depends on a network fetch to say what it does is a control that
 * sometimes does not. They inherit currentColor, so dark mode needs nothing.
 */
const ICONS = {
  chevron: '<path d="M15 5.5 8.5 12l6.5 6.5"/>',
  power: '<path d="M12 3.2v8.2"/><path d="M6.6 6.7a7.6 7.6 0 1 0 10.8 0"/>',
  restart: '<path d="M20.4 12a8.4 8.4 0 1 1-2.9-6.4"/><path d="M20.4 4.2v5.4h-5.2"/>',
  hide: '<path d="M2.5 12S6 6 12 6s9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.7"/><path d="M4 4l16 16"/>',
  show: '<path d="M2.5 12S6 6 12 6s9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.7"/>',
};

function icon(name) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor"`
    + ` stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
}

/** Set a button's icon and words without disturbing the other. */
function label(button, name, text) {
  button.querySelector('.icon').innerHTML = icon(name);
  button.querySelector('.label').textContent = text;
}

function mountPageBar(root, options, bus, programs, queries) {
  const host = root === document ? document.querySelector('main') ?? document.body : root;
  const bar = document.createElement('div');
  bar.className = 'engine-bar';
  // Its own counter, not the cell one: a page-control id is not a cell name, and
  // sharing the counter would leave gaps in cell ids for no reason.
  const panelId = `page-controls-${++panels}`;
  // The handle comes FIRST in the markup and last in the layout (the pill is
  // row-reverse), which is the order both want: the button that opens the panel
  // is reached before it in the tab order, and sits at the pill's fixed right
  // edge on screen.
  bar.innerHTML = `<button class="handle" data-act="handle" aria-expanded="false" aria-controls="${panelId}">`
    + `<span class="dot"></span><span class="count"></span><span class="chev">${icon('chevron')}</span></button>`
    + `<div class="controls" id="${panelId}">`
    + '<div class="unit answers"><span class="state answers-state"></span></div>'
    + '<div class="unit"><span class="state engine-state"></span>'
    + `<button data-act="restart"><span class="icon">${icon('power')}</span>`
    + '<span class="label">Start engine</span></button></div></div>';
  const state = bar.querySelector('.engine-state');
  // One button, whose label is always the thing it will do. "restart engine" over
  // an engine that has never started names a state the reader cannot act on and
  // leaves them asking how to switch it on — which is a fair question to ask of a
  // control that says "off".
  const restart = bar.querySelector('[data-act="restart"]');
  let live = false;
  const handle = bar.querySelector('.handle');
  const controls = bar.querySelector('.controls');
  const count = bar.querySelector('.count');

  // Open because the reader asked, or open because something just happened. Kept
  // apart so a flash cannot close a pill the reader deliberately pinned.
  let pinned = false;
  let flash = null;

  /**
   * How wide the pill wants to be, open.
   *
   * Measured rather than declared, because CSS cannot transition to `auto` and
   * the contents change length as the engine's state does. Measuring means one
   * forced reflow per toggle, which is the price of the animation.
   */
  const widthFor = (open) => {
    const previousWidth = bar.style.width;
    const previousDisplay = controls.style.display;
    bar.style.transition = 'none';
    // Taken out of the flex line entirely rather than merely hidden, since a
    // hidden-but-laid-out panel still contributes its width to `auto`.
    if (!open) controls.style.display = 'none';
    bar.style.width = 'auto';
    // getBoundingClientRect, not offsetWidth: offsetWidth rounds DOWN to a whole
    // pixel, and the pill was landing a third of a pixel short of its own
    // contents — enough for text-overflow to decide the sentence did not fit and
    // eat a whole word to make room for an ellipsis. The extra pixel is the same
    // fraction, rounded the honest way.
    //
    // Measuring BOTH states this way means the pill's own padding is counted
    // without anyone having to remember it exists.
    const width = Math.ceil(bar.getBoundingClientRect().width) + 1;
    bar.style.width = previousWidth;
    controls.style.display = previousDisplay;
    bar.offsetWidth; // flush, or the browser coalesces this into no transition
    bar.style.transition = '';
    return width;
  };

  const render = () => {
    const open = pinned || flash !== null;
    bar.dataset.open = String(open);
    handle.setAttribute('aria-expanded', String(open));
    bar.style.width = `${widthFor(open)}px`;
  };
  const show = (ms) => {
    clearTimeout(flash);
    // Long enough to read a clock time, short enough not to become furniture.
    flash = setTimeout(() => { flash = null; render(); }, ms);
    render();
  };

  const close = () => {
    pinned = false;
    clearTimeout(flash);
    flash = null;
    render();
  };

  handle.addEventListener('click', () => {
    if (pinned || flash !== null) return close();
    pinned = true;
    render();
  });

  // The two ways out of any panel a reader expects to work. Both check that it is
  // open first, so this adds no listener behaviour to a page that is only reading.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && bar.dataset.open === 'true') {
      close();
      handle.focus();
    }
  });
  document.addEventListener('click', (e) => {
    if (bar.dataset.open === 'true' && !bar.contains(e.target)) close();
  });

  const say = (text, title) => {
    state.textContent = text;
    if (title) state.title = title;
    else state.removeAttribute('title');
    // The pill's own label, for when the words are tucked away: the state at a
    // glance, which is all a reader wants until they want the buttons.
    handle.title = text;
    // These words are inside the pill, so changing them changes how wide it wants
    // to be. Re-measured here rather than left to drift.
    if (bar.isConnected) render();
  };

  // Counted in cells rather than bytes, because cells are what the reader can act
  // on — and because "0 of 2 loaded" is the fact that makes a per-cell reset
  // visibly do something.
  const loaded = () => {
    const n = programs.filter((p) => p.isLoaded()).length;
    return `${n} of ${programs.length} program cell${programs.length === 1 ? '' : 's'} loaded`;
  };

  // Visible proof of the property the chapter is built on: nothing has been
  // downloaded, and the answers above are still there to read.
  //
  // Says how it starts rather than only that it has not: pressing the button is
  // the second way and the slower question to answer, so the sentence names the
  // first. It does not repeat "engine off" either — the light two inches to its
  // right already says that, and a panel that restates its own summary is one
  // nobody finishes reading.
  say('starts on your first Run',
    'the chapter is showing its saved answers; 5.9 MB of WebAssembly arrives when you press Run');
  // "off" on its own says nothing about what is off. The word anchors what the
  // pill is for, which is most of what makes a two-inch control discoverable.
  count.textContent = 'Engine off';
  render();

  // How long this engine has been the engine. Kept rather than announced once,
  // because "restarted 13:53:10" stops being visible the moment anything else
  // happens — and it is precisely then that the reader wants it.
  let age = null;

  bus.on((event) => {
    // A cell's own hide control moved something this panel is reporting on.
    if (event.kind === 'answers') return refreshAnswers();
    if (event.kind === 'booting') {
      // Lit from wherever the engine was asked for — a Run halfway up the chapter
      // starts it just as this button does, and the light should not care which.
      bar.classList.add('busy');
      count.textContent = 'Starting…';
      return;
    }
    bar.classList.remove('busy');
    if (event.kind === 'started') {
      live = true;
      label(restart, 'restart', 'Restart engine');
      restart.title = 'throw this engine away and load your cells into a fresh one';
      age = `started ${event.at}`;
    } else if (event.kind === 'restarted') {
      age = `restarted ${event.at}`;
    }
    if (!age) return;
    say(`${loaded()} · ${age}`, event.kind === 'restarted'
      ? 'assert/retract state is gone; the clauses in your cells were loaded again'
      : 'SWI-Prolog is running in a Web Worker');
    bar.classList.add('live');
    // On or off, not a count. A count is only readable with the pill open, and by
    // then the words beside it say the same thing at greater length.
    count.textContent = 'Engine on';
    // Starting and restarting are the two moments the words are worth reading,
    // and both are things the reader just caused. Consulting one more cell is not.
    if (event.kind === 'started' || event.kind === 'restarted') show(6000);
  });

  // Work the whole chapter cold. Per-cell hiding is right there in each cell, but a
  // reader who wants to do the exercises should not have to click every one of them
  // first — and pressing Run on any cell brings that cell's answers back anyway.
  //
  // A STATE AND A VERB, like the engine beside it. A button labelled with its
  // action always implies the opposite of what is true — "Hide saved answers" can
  // only appear while they are visible — so a control with no state phrase leaves
  // its own label as the only clue, and that clue has to be read backwards. That
  // was the asymmetry: the engine had both, this had only the verb.
  const spoilers = queries.filter((q) => q.hasSaved);
  const answersUnit = bar.querySelector('.unit.answers');
  const answersState = bar.querySelector('.answers-state');
  let refreshAnswers = () => {};
  if (!spoilers.length) {
    answersUnit.remove();
  } else {
    const peek = document.createElement('button');
    peek.dataset.act = 'peek-all';
    peek.innerHTML = '<span class="icon"></span><span class="label"></span>';
    peek.title = 'put every saved answer in this chapter out of sight, to work through it cold';
    answersUnit.appendChild(peek);

    refreshAnswers = () => {
      // Counted rather than remembered, so hiding one output by hand leaves this
      // telling the truth instead of contradicting the page.
      const hidden = spoilers.filter((q) => q.isHidden()).length;
      const all = hidden === spoilers.length;
      answersState.textContent = hidden === 0 ? 'Answers shown'
        : all ? 'Answers hidden'
        : `${hidden} of ${spoilers.length} hidden`;
      label(peek, all ? 'show' : 'hide', all ? 'Show saved answers' : 'Hide saved answers');
      render();
    };

    peek.addEventListener('click', () => {
      // Anything still showing means the useful move is to hide the rest.
      const away = spoilers.some((q) => !q.isHidden());
      for (const q of spoilers) q.setHidden(away);
      refreshAnswers();
    });
    refreshAnswers();
  }

  restart.title = 'download SWI-Prolog and have it ready, so your first Run is not the slow one';

  restart.addEventListener('click', async () => {
    const starting = !live;
    restart.disabled = true;
    bar.classList.add('busy');
    count.textContent = starting ? 'Starting…' : 'Restarting…';
    say(starting ? 'starting SWI-Prolog (5.9 MB, first time only)…' : 'restarting…');
    show(20000);
    try {
      if (starting) {
        // Started empty, deliberately: consulting the chapter here would load
        // cells the reader has not asked for, and Run loads what it needs anyway.
        await boot(options, bus);
      } else {
        const session = await createSession(options);
        await session.restart();
        bus.emit({ kind: 'restarted', at: clock(), cells: [...session.log].length });
      }
    } catch (e) {
      bar.classList.remove('busy');
      count.textContent = live ? 'Engine on' : 'Engine off';
      say(`${starting ? 'start' : 'restart'} failed: ${e.message}`);
      show(10000);
    } finally {
      restart.disabled = false;
    }
  });

  host.appendChild(bar);
  // Only measurable once it is in the document, and again once the web font it is
  // set in has actually arrived.
  render();
  document.fonts?.ready.then(render);
  window.addEventListener('resize', render);
}

/** Boot the engine, reporting the first (slow, 5.9 MB) load through `status`. */
async function boot(options, bus, status) {
  if (!booted && status) {
    status.textContent = 'starting SWI-Prolog (5.9 MB, first time only)…';
    status.className = 'status busy';
  }
  const wasBooted = booted;
  if (!wasBooted) bus.emit({ kind: 'booting', at: clock() });
  const session = await createSession(options);
  booted = true;
  if (!wasBooted) bus.emit({ kind: 'started', at: clock() });
  return session;
}

function mountProgram(cell, options, bus) {
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
  let failure = null;

  autosize(source);

  const say = (text, cls, title) => {
    status.textContent = text;
    status.className = `status ${cls}`;
    if (title) status.title = title;
    else status.removeAttribute('title');
  };

  /**
   * Say what is true, which is not always what the reader last pressed.
   *
   * A tick that still says "consulted" over text the reader has since edited is
   * reassuring and wrong — and it became easy to hit the moment Run started
   * consulting cells by itself (869ejgyaa).
   *
   * Every state is named, including the ones that used to be blank: a cell that
   * says nothing looks like a cell whose buttons do nothing.
   */
  const refresh = () => {
    if (resetBtn) {
      // Enabled whenever this cell is not as the chapter published it — which
      // includes being LOADED, because a published chapter has no engine at all.
      // Reset staying grey after a consult is what made this read as broken: the
      // reader had just changed the world and was offered no way back.
      const mine = source.value !== published || loaded !== null;
      resetBtn.disabled = !mine;
      resetBtn.title = mine
        ? 'undo this cell: the chapter’s program back, and out of the engine'
        : 'this cell is exactly as the chapter published it';
    }
    if (failure) return say(failure, 'err');
    if (!loaded) {
      return say('not consulted', '',
        'the engine does not have this cell; Run on a query below loads it');
    }
    if (source.value !== loaded.text) {
      return say('edited since consulted', 'warn',
        `consulted ${loaded.at}; press Consult to load your changes`);
    }
    if (loaded.warning) return say(loaded.warning, 'warn', `consulted ${loaded.at}`);
    return say(`✓ consulted ${loaded.at}`, 'ok', 'the engine is holding exactly this text');
  };

  const consult = async (session) => {
    const text = source.value;
    const r = await session.consult(text, name);
    // A warning here usually means this cell has just destroyed another
    // cell's clauses, which the reader has no other way of finding out.
    const warning = r.messages && r.messages.find((m) => m.kind === 'warning');
    failure = r.ok ? null : r.error;
    loaded = r.ok ? { text, at: clock(), warning: warning ? warning.text : null } : null;
    refresh();
    // Any answer below this cell was produced against whatever it held before.
    bus.emit({ kind: 'consulted', name, at: clock() });
    return r;
  };

  source.addEventListener('input', () => {
    refresh();
    bus.emit({ kind: 'edited', name });
  });

  /** Any button that talks to the engine: busy while it does, honest afterwards. */
  const working = async (btn, job) => {
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Working…';
    try {
      await job();
    } catch (e) {
      failure = e.message;
    } finally {
      btn.textContent = label;
      // refresh() re-decides `disabled` from the state, so a button never comes
      // back enabled just because it was the one that was pressed.
      btn.disabled = false;
      refresh();
    }
  };

  button.addEventListener('click', () =>
    working(button, async () => consult(await boot(options, bus, status))));

  /**
   * Undo this cell entirely: the chapter's program back, and out of the engine.
   *
   * Taking it out matters as much as putting the text back. A reader who presses
   * reset has said "pretend I never touched this", and a page that restores the
   * text while quietly leaving the clauses loaded has agreed with them in words
   * and disagreed in fact.
   *
   * The cell is deliberately NOT re-consulted here, and nothing cascades to the
   * cells that used it: Run on any query below consults the cells above it
   * (869ejgyaa), so the chapter heals itself on the next click, and until then the
   * tick says "not consulted" because that is what is true.
   */
  resetBtn?.addEventListener('click', () => working(resetBtn, async () => {
    source.value = published;
    autosizeNow(source);
    if (loaded) {
      const session = await boot(options, bus, status);
      await session.unconsult(name);
      loaded = null;
      failure = null;
      bus.emit({ kind: 'unconsulted', name, at: clock() });
    }
    bus.emit({ kind: 'edited', name });
  }));

  // A rebuilt engine consulted this cell again, at a new time. Saying the old one
  // is a small lie that costs nothing to avoid and is invisible right up until the
  // reader is trying to work out what the engine is holding — the one thing this
  // tick exists to tell them.
  bus.on((event) => {
    if (event.kind === 'restarted' && loaded) {
      loaded = { ...loaded, at: event.at };
      refresh();
    }
  });

  refresh();

  return {
    name,
    /** The exact text the engine would be given, for a query deciding if it is stale. */
    text: () => source.value,
    isLoaded: () => loaded !== null,
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

function mountQuery(cell, options, bus, { above = [], below = [] } = {}) {
  const input = cell.querySelector('input');
  const runBtn = cell.querySelector('[data-act="run"]');
  const nextBtn = cell.querySelector('[data-act="next"]');
  const allBtn = cell.querySelector('[data-act="all"]');
  const stopBtn = cell.querySelector('[data-act="stop"]');
  const resetBtn = cell.querySelector('[data-act="reset"]');
  const status = cell.querySelector('.status');
  const out = cell.querySelector('.out');

  // The chapter's own query and the chapter's own answers, kept together because
  // they only mean anything together (docs/modes.md §3). Same caveat as a program
  // cell: correct until a scratchpad restores the reader's version before mount.
  const published = { goal: input.value, out: out.innerHTML };

  let query = null;
  let session = null;
  let count = 0;
  let running = false;
  let aborting = false;
  // The reader's own run: when, against what — and what has happened since.
  let ran = null;
  // Whose answers are on screen. A flag rather than a diff of out.innerHTML: the
  // reader's own controls live in there too, and chrome must never read as a change
  // to the chapter.
  let mine = false;
  let hidden = false;
  // Latched, unlike everything else here, because it is the one change that
  // leaves no trace in the text: a rebuilt engine looks exactly like the old one.
  let engineChanged = false;

  /**
   * Everything these answers depended on.
   *
   * Only the cells ABOVE, because those are the only ones Run loads. Compared as
   * text rather than as a hash because the strings are already in hand and there
   * are five of them, not five thousand.
   */
  const context = () => above.map((p) => `${p.name} ${p.text()}`).join('\n');

  /**
   * Why the answers on screen are no longer the answers this page would produce,
   * or null.
   *
   * The question a reader cannot answer by looking, and the one that quietly makes
   * a notebook untrustworthy when nobody answers it: they edit a program cell, the
   * answers below sit there unchanged, and nothing says those answers came from a
   * program that no longer exists. This is the live twin of the input-hash check
   * the renderer does for SAVED answers (render.js) — the same question, asked of
   * a run that happened a minute ago rather than at publish time.
   *
   * DERIVED, not remembered. A reader who edits a program cell and then undoes the
   * edit is back where they started, and a warning that stays put through that
   * teaches them to ignore warnings — which is worse than never having shown one.
   */
  const staleReason = () => {
    if (!ran) return null;
    // A restart replays the same clauses, so answers only really change for a
    // query that depended on assert/retract state — but that is exactly the case
    // format §8 says restart exists for, and the reader is owed the flag.
    if (engineChanged) return 'engine restarted since this ran';
    // Comparing the whole context ignores cells BELOW without this having to know
    // which cell is which: they were never part of it.
    if (ran.context !== context()) return 'program changed since this ran';
    if (input.value.trim().replace(/\.$/, '') !== ran.goal) return 'query edited since this ran';
    return null;
  };

  const refresh = () => {
    if (resetBtn) {
      const changed = mine || input.value !== published.goal;
      resetBtn.disabled = !changed;
      resetBtn.title = changed
        ? 'put the chapter’s query and its saved answers back'
        : 'this query and these answers are exactly as the chapter published them';
    }
    if (!status) return;
    if (!ran) {
      // Deliberately silent: the output's own first line already says whose
      // answers those are, and a second label saying it again is noise.
      status.textContent = '';
      status.className = 'status';
      status.removeAttribute('title');
      return;
    }
    const stale = staleReason();
    status.textContent = stale ?? `✓ ran ${ran.at}`;
    status.className = `status ${stale ? 'warn' : 'ok'}`;
    status.title = stale
      ? `ran ${ran.at}; press Run to see what the program does now`
      : 'these answers came from the cells above, exactly as they are now';
  };

  bus.on((event) => {
    if (event.kind === 'restarted' && ran) engineChanged = true;
    refresh();
  });

  /**
   * Put the chapter's answers away, so the reader can work the question cold.
   *
   * A chapter shows its answers, always — that is the property the whole project
   * is for (docs/modes.md §2), and it is why this is opt-in rather than the
   * default. But prose that says "press Run for the first answer, then ; next to
   * walk through the rest" is arguing with a page that has already printed all
   * six, and the reader loses either the exercise or the trust.
   *
   * The answers are hidden, never discarded: they are the chapter's, and one click
   * brings them back. That is also why this is not what reset does — there is
   * nothing here to undo.
   *
   * Author-declared hiding — a cell marked as a spoiler in the file itself — is a
   * format question and still open (869enkdd2). This needs no format change at
   * all, which is a good reason for it to come first.
   */
  const setHidden = (value) => {
    const was = hidden;
    hidden = value && !mine;
    // The page's own control reports on every cell, so it has to hear about one.
    if (hidden !== was) bus.emit({ kind: 'answers' });
    out.classList.toggle('answers-hidden', hidden);
    const toggle = out.querySelector('[data-act="peek"]');
    // Same word and same icon as the whole-chapter control in the page pill: one
    // vocabulary, learned once.
    if (toggle) label(toggle, hidden ? 'show' : 'hide', hidden ? 'show' : 'hide');
    const note = out.querySelector('.peek-note');
    if (note) note.textContent = hidden ? ' · hidden' : '';
  };

  /**
   * CHROME, NOT CONTENT, and injected rather than rendered for the usual reason: a
   * built page, an EPUB or the GitHub view must not carry a hide button that
   * cannot work — and a printed chapter has no way to unhide.
   */
  const decorateSaved = () => {
    const from = out.querySelector('.line.from');
    if (mine || !from || from.querySelector('[data-act="peek"]')) return;
    const note = document.createElement('span');
    note.className = 'peek-note';
    const toggle = document.createElement('button');
    toggle.className = 'peek';
    toggle.dataset.act = 'peek';
    toggle.innerHTML = '<span class="icon"></span><span class="label"></span>';
    toggle.title = 'the chapter’s answers stay here either way; this only puts them out of sight';
    toggle.addEventListener('click', () => setHidden(!hidden));
    from.append(note, toggle);
    setHidden(hidden);
  };

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
    refresh();
  };

  /** While a goal is in flight the only useful button is Stop. */
  const setRunning = (state) => {
    running = state;
    runBtn.disabled = state;
    nextBtn.disabled = state || !query;
    allBtn.disabled = state || !query;
    if (stopBtn) stopBtn.disabled = !state;
    refresh();
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
    // labelled and the way back is stated (docs/modes.md §3) — and the way back is
    // now a button on this cell rather than a page reload.
    const hadSaved = !mine && out.querySelector('.line.from') !== null;
    out.innerHTML = '';
    mine = true;
    setHidden(false);
    count = 0;
    const goal = input.value.trim().replace(/\.$/, '');
    if (!goal) return;
    const at = clock();
    write(hadSaved
      ? `your run · ${at} · press reset for the chapter’s saved answers`
      : `your run · ${at}`, 'from');
    write(`?- ${goal}.`, 'echo');
    setRunning(true);
    try {
      if (!booted) write('starting SWI-Prolog (5.9 MB, first time only)…', 'done');
      session = await boot(options, bus);
      const ok = await loadPrograms(session);
      // Recorded whatever happened, and recorded AFTER the consults: these answers
      // are the reader's either way, and the context is the one the goal actually
      // ran against rather than the one it was about to.
      ran = { at, goal, context: context() };
      engineChanged = false;
      if (!ok.ok) {
        write(`cell ${ok.name} did not load: ${ok.error}`, 'err');
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
    // Announced as a restart, because that is what it was: every other query that
    // had run is now showing answers from an engine that no longer exists.
    bus.emit({ kind: 'restarted', at: clock(), cells: [...session.log].length });
  });

  /**
   * Put the chapter's query and its answers back.
   *
   * No engine work, and none needed: the chapter's saved answers make no claim
   * about what the engine is holding. They say whose they are, which is the only
   * claim they have ever made (docs/modes.md §3).
   */
  resetBtn?.addEventListener('click', () => {
    input.value = published.goal;
    out.innerHTML = published.out;
    mine = false;
    ran = null;
    engineChanged = false;
    decorateSaved();
    finish();
  });

  input.addEventListener('input', refresh);

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') runBtn.click();
    if (e.key === ';') {
      e.preventDefault();
      if (!nextBtn.disabled) step();
    }
  });

  decorateSaved();
  refresh();

  return { hasSaved: published.out !== '', setHidden, isHidden: () => hidden };
}

function autosizeNow(ta) {
  ta.style.height = 'auto';
  ta.style.height = `${ta.scrollHeight}px`;
}

function autosize(ta) {
  ta.addEventListener('input', () => autosizeNow(ta));
  requestAnimationFrame(() => autosizeNow(ta));
}
