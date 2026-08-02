// Browser wiring: turns marked-up cells in a page into a running notebook.
//
// Deliberately not a framework. A page declares its cells as ordinary elements and
// calls mount(); the DOM is the notebook. A file-backed renderer (reading .ipynb or
// markdown and generating these cells) is the next layer up, and is not written yet.
import { createSession, formatSolution } from './browser.js';

let serial = 0;

export function mount(root = document) {
  root.querySelectorAll('.cell.program').forEach(mountProgram);
  root.querySelectorAll('.cell.query').forEach(mountQuery);
}

function mountProgram(cell) {
  const source = cell.querySelector('textarea');
  const button = cell.querySelector('button');
  const status = cell.querySelector('.status');
  const name = `cell${serial++}`;

  autosize(source);

  button.addEventListener('click', async () => {
    status.textContent = 'loading Prolog…';
    status.className = 'status busy';
    const session = await createSession();
    const r = session.consult(source.value, name);
    status.textContent = r.ok ? 'consulted' : r.error;
    status.className = `status ${r.ok ? 'ok' : 'err'}`;
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
    if (r.solution) write(`${++count}.  ${formatSolution(r.solution)}`, 'sol');
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
    const session = await createSession();
    write(`?- ${goal}.`, 'echo');
    query = session.query(goal);
    nextBtn.disabled = false;
    allBtn.disabled = false;
    step();
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
