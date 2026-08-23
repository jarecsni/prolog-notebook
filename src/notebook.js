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
import { createSession, formatSolution, readableInCell } from './browser.js';
import { declaredDynamic, definedPredicates, unknownProcedure } from './clauses.js';
import { download } from './export.js';

let serial = 0;
let panels = 0;

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
    // Whether THIS notebook's engine has started. Per mount rather than per
    // module: "5.9 MB, first time only" is a claim about a particular notebook's
    // first Run, and a second chapter embedded in the same page (v0.4) is a
    // second notebook, not a continuation of this one.
    booted: false,
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
  // A cell held until a prediction is answered names that prediction by POSITION:
  // the nearest one above it. That is not the position-inferred spoiler rule the
  // format refuses — the AUTHOR opted in, per cell, in the file (format §5). This
  // is only how the cell finds the box it was told to wait for.
  const predictions = [...root.querySelectorAll('.predict textarea')];
  const predictionAbove = (el) => predictions
    .filter((box) => box.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)
    .pop() ?? null;

  const queries = [];
  cells.forEach((cell, index) => {
    if (!cell.classList.contains('query')) return;
    queries.push(mountQuery(cell, options, bus, {
      above: programs.filter((p) => p.index < index),
      below: programs.filter((p) => p.index > index),
      prediction: predictionAbove(cell),
    }));
  });

  if (programs.length) mountPageBar(root, options, bus, programs, queries);

  // Returned so a shell that HAS the parsed model — page.js, today — can ask the
  // cells what they now say and hand the reader a file (869ejgbxf). notebook.js
  // still knows nothing about markdown, and does not gain a parser to do it.
  return { programs, queries };
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
 * carrying the state at a glance — a dot and a word — and clicking it RAISES A
 * CARD directly above it, right edges aligned, one row per thing the page
 * controls. The thing the reader pressed is visibly the thing that opened.
 *
 * It rises rather than widening, and that is a correctness decision as much as a
 * visual one: a widening pill has to be measured from the DOM every time its
 * words change, and a measured animation is cancelled by anything that re-renders
 * while it runs (869enmuy9). A row also costs vertical space, which nobody is
 * short of — the widening pill had reached the edge of the viewport with three
 * units in it, and there are more coming.
 *
 * On a click, not on hover: hover opens a panel nobody asked for, does not exist
 * on a touch screen, and cannot be reached from a keyboard, so one gesture that
 * works everywhere beats three that do not.
 *
 * IT OPENS ITSELF ONLY TO REPORT A FAILURE. An earlier version also opened when
 * the engine started, on the grounds that its words were worth reading at that
 * moment — but the reader had pressed Run in a cell, their attention was on that
 * cell's output, and a second thing moving in the corner competed with the
 * answers they had actually asked for. It was also redundant: the light says the
 * engine came on, which is the whole reason a light is there. The panel is the
 * detail, and detail is fetched, not pushed.
 *
 * A failure is the exception, because a message nobody sees is not a message.
 *
 * Otherwise it opens on a click and closes on Escape, on a click elsewhere, or on
 * a second click of the lozenge.
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
  download: '<path d="M12 3.6v10.6"/><path d="m7.6 10.2 4.4 4.4 4.4-4.4"/><path d="M4.6 19.4h14.8"/>',
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
  bar.className = 'page-controls';
  bar.dataset.open = 'false';
  // Its own counter, not the cell one: a page-control id is not a cell name, and
  // sharing the counter would leave gaps in cell ids for no reason.
  const panelId = `page-controls-${++panels}`;
  // The handle comes FIRST in the markup and sits below the panel on screen, which
  // is the order both want: the button that opens the panel is reached before it
  // in the tab order, and the card rises from the thing that was pressed.
  bar.innerHTML = `<button class="handle" data-act="handle" aria-expanded="false" aria-controls="${panelId}">`
    + `<span class="dot"></span><span class="count"></span><span class="chev">${icon('chevron')}</span></button>`
    + `<div class="panel" id="${panelId}">`
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
  const count = bar.querySelector('.count');

  // Open because the reader asked, or open because something went wrong. Kept
  // apart so a flash cannot close a pill the reader deliberately pinned.
  let pinned = false;
  let flash = null;

  /**
   * Open or shut, and that is the whole of it.
   *
   * NOTHING IS MEASURED HERE, which is the point. The first version of this
   * control was one pill that widened, so its open width had to be measured from
   * the DOM on every state change — CSS cannot transition to `auto`. That made
   * the animation cancellable by anything that re-rendered while it ran, and
   * export's "has anything changed?" listener re-rendered on the frame after
   * every click, including the click that opened it. The pill stopped animating
   * and nobody could see why from the CSS, because the CSS was fine.
   *
   * A card that rises needs one attribute and a transform. It cannot be cancelled
   * by a re-render, it costs no reflow, and a unit added tomorrow costs a row.
   */
  const render = () => {
    const open = pinned || flash !== null;
    bar.dataset.open = String(open);
    handle.setAttribute('aria-expanded', String(open));
  };
  const show = (ms) => {
    clearTimeout(flash);
    // Long enough to read the message, short enough not to become furniture.
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
  // Cells that HAVE saved answers in the file — but what this unit reports on is
  // the ones SHOWING them. A cell displaying the reader's own run is not a spoiler:
  // its saved answers are behind reset, and it refuses to hide precisely because
  // they are no longer what is on screen.
  //
  // Counting the file rather than the screen is what jammed this control. The run
  // cell could never be hidden, so "is anything still showing?" was permanently
  // true, the set never reached all-hidden, the label never flipped to Show, and
  // every click after the first re-hid the same cells and did nothing visible.
  const spoilers = queries.filter((q) => q.hasSaved);
  const showing = () => spoilers.filter((q) => q.showsChapter());
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
      const on = showing();
      const hidden = on.filter((q) => q.isHidden()).length;
      const all = on.length > 0 && hidden === on.length;
      // Every cell is showing the reader's own answers: there is nothing here of
      // the chapter's to put away. Saying so and going quiet beats offering a
      // button that cannot do anything — a control that does nothing reads as a
      // broken page, which is how this one was reported.
      peek.disabled = on.length === 0;
      answersState.textContent = on.length === 0 ? 'No saved answers on screen'
        : hidden === 0 ? 'Answers shown'
        : all ? 'Answers hidden'
        : `${hidden} of ${on.length} hidden`;
      label(peek, all ? 'show' : 'hide', all ? 'Show saved answers' : 'Hide saved answers');
      render();
    };

    peek.addEventListener('click', () => {
      // Anything still showing means the useful move is to hide the rest.
      const on = showing();
      const away = on.some((q) => !q.isHidden());
      for (const q of on) q.setHidden(away);
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
    try {
      if (starting) {
        // Started empty, deliberately: consulting the chapter here would load
        // cells the reader has not asked for, and Run loads what it needs anyway.
        await boot(options, bus);
      } else {
        const session = await sessionFactory(options)(options);
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
  render();
}

/**
 * Add "download this notebook" to the page's controls.
 *
 * Called by whoever HAS the parsed model — page.js, because a markdown cell has
 * been rendered to HTML by the time it reaches this file and cannot be read back
 * out of the DOM. So notebook.js offers the affordance and someone else supplies
 * the bytes; this module still knows nothing about markdown.
 *
 * A state and a verb, like everything else in that pill: whether the notebook on
 * screen is still the chapter's, and the button that hands you a copy of it.
 *
 * @param {Element|Document} root
 * @param {() => {filename: string, text: string}} produce
 */
export function offerDownload(root, produce) {
  const scope = root && root.querySelector ? root : document;
  const bar = scope.querySelector('.page-controls') ?? document.querySelector('.page-controls');
  if (!bar) return;

  const unit = document.createElement('div');
  unit.className = 'unit notebook';
  unit.innerHTML = '<span class="state notebook-state"></span>'
    + `<button data-act="download"><span class="icon">${icon('download')}</span>`
    + '<span class="label">Download .prolog.md</span></button>';
  bar.querySelector('.panel').prepend(unit);

  const state = unit.querySelector('.notebook-state');
  const say = () => {
    const edited = [...scope.querySelectorAll('.cell')].some((cell) => cell.dataset.edited === 'true');
    state.textContent = edited ? 'Your version' : 'As published';
    state.title = edited
      ? 'this notebook has your edits or your answers in it; the download carries them'
      : 'nothing here differs from the chapter yet; the download is the chapter itself';
  };

  unit.querySelector('button').addEventListener('click', () => {
    const { filename, text } = produce();
    download(filename, text);
  });

  // Anything a reader does that could change the answer is a click or a
  // keystroke, and both bubble. Cheaper than a subscription, and it cannot go
  // stale by forgetting to fire.
  scope.addEventListener('input', say);
  scope.addEventListener('click', () => requestAnimationFrame(say));
  say();
}

/** Boot the engine, reporting the first (slow, 5.9 MB) load through `status`. */
/**
 * Where the engine comes from.
 *
 * A SEAM, and the reason it exists is testability: mount() otherwise reaches
 * straight for the browser's worker-backed session, so nothing on this page can
 * be exercised without spawning a Worker and 36 MB of WebAssembly. A fake session
 * — consults that record, queries that answer from a script — is what lets the
 * page's own behaviour be tested at all (869enpj26).
 *
 * Same shape as the injectable filesystem in platform-seams.md §3, one level up:
 * a hosted build and the VS Code web extension will each want to say where the
 * engine lives, and it costs one option to let them.
 */
function sessionFactory(options) {
  return options.createSession ?? createSession;
}

async function boot(options, bus, status) {
  if (!bus.booted && status) {
    status.textContent = 'starting SWI-Prolog (5.9 MB, first time only)…';
    status.className = 'status busy';
  }
  const wasBooted = bus.booted;
  if (!wasBooted) bus.emit({ kind: 'booting', at: clock() });
  const session = await sessionFactory(options)(options);
  bus.booted = true;
  if (!wasBooted) bus.emit({ kind: 'started', at: clock() });
  return session;
}

function mountProgram(cell, options, bus) {
  const source = cell.querySelector('textarea');
  const button = cell.querySelector('[data-act="consult"]') ?? cell.querySelector('button');
  const resetBtn = cell.querySelector('[data-act="reset"]');
  const status = cell.querySelector('.status');

  /**
   * The one cell whose state a re-consult does not undo (format §8).
   *
   * Chrome, not content: whether a cell is stateful is a fact about what happens
   * when you run it, and a printed page has no engine for it to be true of. It is
   * also derived from the text on every keystroke rather than at mount, so typing
   * `:- dynamic` makes the badge appear — which is the moment the reader most
   * wants to be told, rather than after they have asserted something and found it
   * survived an edit.
   */
  const stateful = document.createElement('span');
  stateful.className = 'badge stateful';
  stateful.textContent = 'stateful';
  stateful.hidden = true;
  status.parentNode.insertBefore(stateful, status);

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
    const dynamic = declaredDynamic(source.value);
    stateful.hidden = dynamic.size === 0;
    if (!stateful.hidden) {
      stateful.title = `this cell declares :- dynamic ${[...dynamic].join(', ')}.`
        + ' Whatever a goal asserts into it lives in no file, so re-consulting the cell will'
        + ' not undo it and neither will reset — restart the engine to clear it.';
    }
    if (resetBtn) {
      // Enabled whenever this cell is not as the chapter published it — which
      // includes being LOADED, because a published chapter has no engine at all.
      // Reset staying grey after a consult is what made this read as broken: the
      // reader had just changed the world and was offered no way back.
      const mine = source.value !== published || loaded !== null;
      // On the element, so the page-level control can read "is any of this the
      // reader's?" without holding a reference to every cell.
      cell.dataset.edited = String(source.value !== published);
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
    // Said the way this cell would say it: one cell is one virtual file, so SWI's
    // line numbers are already the cell's own, and the path in front of them is a
    // filename the reader never chose and cannot open.
    failure = r.ok ? null : readableInCell(r.error, name);
    loaded = r.ok
      ? { text, at: clock(), warning: warning ? readableInCell(warning.text, name) : null }
      : null;
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
    isEdited: () => source.value !== published,
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

function mountQuery(cell, options, bus, { above = [], below = [], prediction = null } = {}) {
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
  // Kept as SWI rendered each solution, so an export carries the answers the
  // reader actually saw rather than a reconstruction of them from the screen.
  let produced = [];
  let failed = null;
  // Whether the SEARCH ended, which is not the same as whether the RUN ended. A
  // reader who takes three of six and stops leaves a query that was never
  // exhausted, and only the engine saying `done` can tell us otherwise — the
  // buttons look identical either way (format §6).
  let exhausted = false;
  // Whose answers are on screen. A flag rather than a diff of out.innerHTML: the
  // reader's own controls live in there too, and chrome must never read as a change
  // to the chapter.
  let mine = false;
  let hidden = false;
  // The author's own spoiler mark (format §5). It is a starting state rather than
  // a lock: the reader can always press show, because withholding the answer from
  // someone who has decided they want it is theatre, not teaching.
  const hold = cell.dataset.hold ?? null;
  let held = hold !== null && published.out !== '';
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
      cell.dataset.edited = String(changed);
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
   * The author can declare the same thing in the file — `hold="until-run"` on a
   * query cell (format §5) — and it arrives here as the same mechanism, because a
   * held answer and a hidden one differ only in who asked for it and what ends the
   * wait. The reader's half needed no format change, which is why it came first.
   */
  /** What a held cell is waiting for, in the words of the thing that ends it. */
  const heldNote = () => (hold === 'until-answered'
    ? ' · held until you write your prediction above'
    : ' · held until you run it');

  const setHidden = (value) => {
    const was = hidden;
    hidden = value && !mine;
    // Showing an answer ENDS THE AUTHOR'S WAIT for it, by whatever route it was
    // shown — this cell's control, the page's, a prediction answered, a run, a
    // reset afterwards. The reader has seen it, and a cell that goes back to
    // saying "held until you run it" is arguing with them. Withholding it twice
    // is theatre; the first time is the teaching.
    if (!hidden) held = false;
    // The page's own control reports on every cell, so it has to hear about one.
    if (hidden !== was) bus.emit({ kind: 'answers' });
    out.classList.toggle('answers-hidden', hidden);
    const toggle = out.querySelector('[data-act="peek"]');
    // Same word and same icon as the whole-chapter control in the page pill: one
    // vocabulary, learned once.
    if (toggle) label(toggle, hidden ? 'show' : 'hide', hidden ? 'show' : 'hide');
    const note = out.querySelector('.peek-note');
    // A held cell says WHY it is empty and what ends the wait. "hidden" alone
    // reads as something the reader did and forgot doing.
    if (note) note.textContent = hidden ? (held ? heldNote() : ' · hidden') : '';
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
      if (r.solution) {
        const text = r.text ?? formatSolution(r.solution);
        produced.push(text);
        write(`${++count}.  ${text}`, 'sol');
      }
      if (r.error) {
        failed = r.error;
        write(r.error, 'err');
        const hint = locate(r.error);
        if (hint) write(hint, 'done');
        finish();
        return false;
      }
      if (r.done) {
        exhausted = true;
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
    // This cell has just stopped showing the chapter's answers, which changes what
    // the page's control is counting. setHidden only speaks up when the hidden
    // flag itself moves, so a cell that was already visible would leave the count
    // reporting on a spoiler that is no longer on screen.
    bus.emit({ kind: 'answers' });
    produced = [];
    failed = null;
    exhausted = false;
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
      if (!bus.booted) write('starting SWI-Prolog (5.9 MB, first time only)…', 'done');
      session = await boot(options, bus);
      const ok = await loadPrograms(session);
      // Recorded whatever happened, and recorded AFTER the consults: these answers
      // are the reader's either way, and the context is the one the goal actually
      // ran against rather than the one it was about to.
      ran = { at, goal, context: context() };
      engineChanged = false;
      if (!ok.ok) {
        failed = `cell ${ok.name} did not load: ${ok.error}`;
        write(failed, 'err');
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
    // Back in the set the page's control acts on, for the same reason.
    bus.emit({ kind: 'answers' });
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

  if (held) {
    hidden = true;
    // `change` rather than `input`: it fires when they leave the box, so the
    // answers do not appear under a reader who is still mid-sentence. An empty
    // box is not a prediction, so it does not end the wait.
    prediction?.addEventListener('change', () => {
      if (held && prediction.value.trim() !== '') setHidden(false);
    });
  }

  decorateSaved();
  refresh();

  return {
    id: cell.dataset.cell,
    hasSaved: published.out !== '',
    /**
     * Is the chapter's own output what this cell is showing right now?
     *
     * Not the same question as `hasSaved`, which is about the FILE. The page's
     * control acts on what is on screen, and after a run the chapter's answers
     * are behind reset rather than in front of the reader.
     */
    showsChapter: () => !mine && published.out !== '',
    setHidden,
    isHidden: () => hidden,
    isEdited: () => mine || input.value !== published.goal,
    goal: () => input.value,
    /**
     * This cell's answers for an export, in the format's own spelling (§6).
     *
     * Three answers, and the distinctions are the point:
     *   undefined  the chapter's answers are on screen — leave the file's own
     *              output, and its own hash, exactly where they are
     *   null       the reader ran this and produced nothing at all — no answers,
     *              no failure, no exhausted search. There is nothing to write
     *              down, and a query with no output block is already valid.
     *   an object  a run of theirs. Its terminator is empty when they stopped
     *              part-way: the answers they took are theirs to keep, and an
     *              unterminated sequence is the format's own way of saying the
     *              search was never exhausted (§6). Writing `false.` there would
     *              forge an exhaustion, which is the one thing we may not do.
     */
    output: () => {
      if (!mine) return undefined;
      if (failed) return { solutions: produced, terminator: `ERROR: ${failed}` };
      // Stopping and finishing look the same from outside — both leave no open
      // query — so this asks the only thing that distinguishes them.
      if (!exhausted) return produced.length ? { solutions: produced, terminator: '' } : null;
      if (!produced.length) return { solutions: [], terminator: 'false.' };
      // The last solution IS the terminator when a query ran deterministically,
      // and `false.` after the others when it exhausted. replaySolutions() reads
      // it back the same way, which is what keeps a downloaded file rendering
      // identically to the page it came from.
      return { solutions: produced.slice(0, -1), terminator: `${produced[produced.length - 1]}.` };
    },
  };
}

function autosizeNow(ta) {
  ta.style.height = 'auto';
  ta.style.height = `${ta.scrollHeight}px`;
}

function autosize(ta) {
  ta.addEventListener('input', () => autosizeNow(ta));
  requestAnimationFrame(() => autosizeNow(ta));
}
