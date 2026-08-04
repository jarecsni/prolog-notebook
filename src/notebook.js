// Browser wiring: turns marked-up cells in a page into a running notebook.
//
// Deliberately not a framework. A page declares its cells as ordinary elements and
// calls mount(); the DOM is the notebook. A file-backed renderer (reading .ipynb or
// markdown and generating these cells) is the next layer up, and is not written yet.
import { createSession, formatSolution } from './browser.js';

let serial = 0;
let booted = false;

export function mount(root = document) {
  // A page can carry a #boot-warning element saying "this notebook is not running".
  // It is removed only once mount() has actually run, so any failure that prevents
  // this module from loading — opening the page over file://, a bad path, a syntax
  // error — leaves the warning on screen instead of silently inert buttons.
  document.getElementById('boot-warning')?.remove();

  root.querySelectorAll('.cell.program').forEach(mountProgram);
  root.querySelectorAll('.cell.query').forEach(mountQuery);
}

/** Boot the engine, reporting the first (slow, 5.9 MB) load through `status`. */
async function boot(status) {
  if (!booted && status) {
    status.textContent = 'starting SWI-Prolog (5.9 MB, first time only)…';
    status.className = 'status busy';
  }
  const session = await createSession();
  booted = true;
  return session;
}

function mountProgram(cell) {
  const source = cell.querySelector('textarea');
  const button = cell.querySelector('button');
  const status = cell.querySelector('.status');
  const name = `cell${serial++}`;

  autosize(source);

  button.addEventListener('click', async () => {
    const label = button.textContent;
    button.disabled = true;
    button.textContent = 'Working…';
    try {
      const session = await boot(status);
      const r = session.consult(source.value, name);
      // A warning here usually means this cell has just destroyed another
      // cell's clauses, which the reader has no other way of finding out.
      const warning = r.messages && r.messages.find((m) => m.kind === 'warning');
      status.textContent = r.ok ? warning ? warning.text : '✓ consulted' : r.error;
      status.className = `status ${r.ok ? (warning ? 'warn' : 'ok') : 'err'}`;
    } catch (e) {
      status.textContent = e.message;
      status.className = 'status err';
    } finally {
      button.disabled = false;
      button.textContent = label;
    }
  });
}

function mountQuery(cell) {
  const input = cell.querySelector('input');
  const runBtn = cell.querySelector('[data-act="run"]');
  const nextBtn = cell.querySelector('[data-act="next"]');
  const allBtn = cell.querySelector('[data-act="all"]');
  const out = cell.querySelector('.out');

  let query = null;
  let count = 0;

  const write = (text, cls) => {
    const line = document.createElement('div');
    line.className = `line ${cls || ''}`;
    line.textContent = text;
    out.appendChild(line);
    out.scrollTop = out.scrollHeight;
  };

  const finish = () => {
    query = null;
    nextBtn.disabled = true;
    allBtn.disabled = true;
  };

  const step = () => {
    if (!query) return;
    const r = query.next();
    // r.text is rendered by SWI itself, so operators and quoting are right.
    if (r.solution) write(`${++count}.  ${r.text ?? formatSolution(r.solution)}`, 'sol');
    if (r.error) {
      write(r.error, 'err');
      finish();
      return;
    }
    if (r.done) {
      write(count === 0 ? 'false.' : 'no more solutions.', 'done');
      finish();
    }
  };

  runBtn.addEventListener('click', async () => {
    out.innerHTML = '';
    count = 0;
    const goal = input.value.trim().replace(/\.$/, '');
    if (!goal) return;
    write(`?- ${goal}.`, 'echo');
    runBtn.disabled = true;
    try {
      if (!booted) write('starting SWI-Prolog (5.9 MB, first time only)…', 'done');
      const session = await boot();
      query = session.query(goal);
      nextBtn.disabled = false;
      allBtn.disabled = false;
      step();
    } catch (e) {
      write(e.message, 'err');
      finish();
    } finally {
      runBtn.disabled = false;
    }
  });

  nextBtn.addEventListener('click', step);
  allBtn.addEventListener('click', () => {
    let guard = 0;
    while (query && guard++ < 500) step();
    if (guard >= 500) write('stopped after 500 solutions.', 'done');
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
