// The notebook source format: markdown in, cell model out, and back again.
//
// No DOM and no filesystem in this module — it is the boundary the renderer, the
// CLI runner and a future VS Code serializer all sit behind, so it must run
// unchanged in a browser, in Node and in a Web Worker.
//
// The grammar is spelled out in docs/format.md. Two properties of it drive every
// decision here: cells begin at column 0, which is what lets this be a line
// scanner rather than a markdown AST walk; and prose is passed through byte for
// byte, because the CLI writes outputs back into the author's own file on every
// run and a lossy serialiser would quietly mangle their text.

/** Cell kinds this version understands. Anything else is preserved, not refused. */
const CELL_KINDS = new Set(['program', 'query', 'output']);

/** Containers with a visual meaning. Unknown ones stay ordinary blockquotes. */
const CONTAINERS = new Set(['predict', 'aside', 'margin', 'bullets']);

/** Attribute order in canonical form: id first, then the kind's own, then the rest. */
const ATTR_ORDER = {
  program: ['id', 'src'],
  query: ['id', 'rerun', 'hold'],
  output: ['for', 'input-hash'],
};

const ID_RE = /^[a-z0-9][a-z0-9-]*$/;

export class NotebookError extends Error {
  /**
   * @param {string} message
   * @param {number} [line] 1-based line number in the source
   */
  constructor(message, line) {
    super(line ? `line ${line}: ${message}` : message);
    this.name = 'NotebookError';
    this.line = line;
  }
}

// ---------------------------------------------------------------- parsing

/**
 * Parse notebook source into `{frontMatter, cells}`.
 *
 * Ids are minted for any program or query cell lacking one, so a hand-written
 * chapter parses; the moment anything serialises the model back, those ids are
 * written into the file and it self-heals to canonical form.
 *
 * @param {string} text
 * @returns {{frontMatter: Map<string, string>, cells: object[]}}
 */
export function parse(text) {
  if (text.includes('\u0000')) throw new NotebookError('NUL is not permitted in a notebook');

  // CRLF is tolerated on read and never written back; the format is LF.
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const state = { lines, i: 0 };

  const frontMatter = parseFrontMatter(state);
  const format = frontMatter.get('format');
  if (format !== undefined) {
    const major = /^prolog-notebook\/(\d+)$/.exec(format);
    if (!major) throw new NotebookError(`unrecognised format "${format}"`, 2);
    // A newer major is refused rather than guessed at.
    if (Number(major[1]) > 1) throw new NotebookError(`format ${format} is newer than this parser understands`, 2);
  }
  // The notebook-wide default for query cells (§2). Checked here rather than
  // where it is applied, because the renderer is not the only thing that applies
  // it and an unrecognised value must not depend on who read it first.
  const rerun = frontMatter.get('rerun');
  if (rerun !== undefined && rerun !== 'manual' && rerun !== 'auto') {
    throw new NotebookError(`rerun: ${rerun} is not manual or auto`, 2);
  }

  const cells = [];
  const ids = new Set();
  let prose = [];

  const flushProse = () => {
    const source = trimBlankEdges(prose).join('\n');
    if (source !== '') cells.push({ kind: 'markdown', source });
    prose = [];
  };

  while (state.i < lines.length) {
    const line = lines[state.i];
    const lineNo = state.i + 1;

    const fence = /^(`{3,})(.*)$/.exec(line);
    if (fence) {
      const block = readFence(state);
      const info = parseInfoString(block.info, lineNo);

      if (info === null || !CELL_KINDS.has(info.kind)) {
        // Either an ordinary code block, or a cell kind from a future version.
        // Both are kept verbatim so a v0.2 parser degrades instead of refusing.
        if (info !== null && info.kind !== null) {
          flushProse();
          cells.push({ kind: 'unknown', source: block.raw });
        } else {
          prose.push(...block.raw.split('\n'));
        }
        continue;
      }

      flushProse();

      if (info.kind === 'output') {
        attachOutput(cells, info, block, lineNo);
        continue;
      }

      const cell = info.kind === 'program'
        ? buildProgram(info, block, lineNo)
        : buildQuery(info, block, lineNo);

      if (cell.id !== null) {
        if (!ID_RE.test(cell.id) || cell.id.length > 64) {
          throw new NotebookError(`id "${cell.id}" is not [a-z0-9][a-z0-9-]* within 64 chars`, lineNo);
        }
        if (ids.has(cell.id)) throw new NotebookError(`duplicate cell id "${cell.id}"`, lineNo);
        ids.add(cell.id);
      }
      // A cell held until a prediction is answered has to have one to wait for.
      // The author declared the wait; only its SUBJECT is positional, and an
      // author who moved the prediction away learns here rather than shipping a
      // chapter whose answers never appear.
      if (cell.hold === 'until-answered' && !cells.some((c) => c.variant === 'predict')) {
        throw new NotebookError('hold="until-answered" has no prediction above it', lineNo);
      }
      cells.push(cell);
      continue;
    }

    const container = parseContainerHead(line, lineNo);
    if (container && CONTAINERS.has(container.variant)) {
      flushProse();
      cells.push(readContainer(state, container));
      continue;
    }

    prose.push(line);
    state.i++;
  }
  flushProse();

  mintIds(cells, ids);
  return { frontMatter, cells };
}

/**
 * Front matter is a deliberately restricted subset of YAML — flat `key: value`,
 * no nesting, no lists, no anchors — so that this stays ~20 lines and the package
 * carries no YAML dependency into the browser.
 */
function parseFrontMatter(state) {
  const map = new Map();
  if (state.lines[0] !== '---') return map;

  for (let i = 1; i < state.lines.length; i++) {
    if (state.lines[i] === '---') {
      state.i = i + 1;
      // The blank line separating front matter from the body is structural.
      if (state.lines[state.i] === '') state.i++;
      return map;
    }
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(state.lines[i]);
    if (!kv) throw new NotebookError(`front matter must be flat key: value pairs`, i + 1);
    map.set(kv[1], kv[2]);
  }
  throw new NotebookError('front matter is not closed', 1);
}

/** Read a fenced block starting at state.i. Leaves state.i after the closing fence. */
function readFence(state) {
  const open = /^(`{3,})(.*)$/.exec(state.lines[state.i]);
  const ticks = open[1];
  const info = open[2].trim();
  const body = [];
  let i = state.i + 1;
  for (; i < state.lines.length; i++) {
    if (state.lines[i].startsWith(ticks) && state.lines[i].trim() === ticks) break;
    body.push(state.lines[i]);
  }
  const raw = state.lines.slice(state.i, Math.min(i + 1, state.lines.length)).join('\n');
  state.i = i + 1;
  return { ticks, info, body, raw };
}

/**
 * `<language> <kind> [key="value"]...`
 *
 * Token 1 is the highlight language and exists for GitHub, which uses the first
 * word and ignores the rest — that single fact is what makes the format degrade
 * well. Returns null for a bare language (an ordinary code block).
 */
function parseInfoString(info, lineNo) {
  if (info === '') return null;
  const head = /^(\S+)(\s+)(\S+)/.exec(info);
  if (!head) return null;
  const [, language, gap, kind] = head;
  if (/^[a-z][a-z0-9-]*$/.test(kind) === false) return null;

  const attrs = new Map();
  // Slice by position rather than searching for the kind: a language that happens
  // to contain the kind as a substring would otherwise cut in the wrong place.
  const attrText = info.slice(language.length + gap.length + kind.length);
  const re = /([a-z][a-z0-9-]*)="((?:[^"\\]|\\.)*)"/g;
  let consumed = 0;
  let m;
  while ((m = re.exec(attrText)) !== null) {
    attrs.set(m[1], m[2].replace(/\\(["\\])/g, '$1'));
    consumed = m.index + m[0].length;
  }
  if (attrText.slice(consumed).trim() !== '') {
    throw new NotebookError(`attributes must be key="value": ${attrText.trim()}`, lineNo);
  }
  return { language, kind, attrs };
}

function buildProgram(info, block, lineNo) {
  const source = trimBlankEdges(block.body).join('\n');
  const src = info.attrs.get('src') ?? null;
  if (src !== null) {
    // Recognised and refused rather than ignored, so a future notebook fails
    // loudly here instead of silently consulting nothing.
    if (source !== '') throw new NotebookError('a program cell has either src= or a body, never both', lineNo);
    throw new NotebookError('src= is specified but not implemented in this version', lineNo);
  }
  return {
    kind: 'program',
    id: info.attrs.get('id') ?? null,
    source,
    src,
    language: info.language,
    attrs: otherAttrs(info.attrs, 'program'),
  };
}

function buildQuery(info, block, lineNo) {
  // A goal may span lines; the lines are joined with a space.
  const joined = trimBlankEdges(block.body).join(' ').trim();
  const goal = stripTerminator(joined, lineNo);
  if (goal === '') throw new NotebookError('a query cell needs a goal', lineNo);
  return {
    kind: 'query',
    id: info.attrs.get('id') ?? null,
    goal,
    rerun: readRerun(info.attrs.get('rerun'), lineNo),
    hold: readHold(info.attrs.get('hold'), lineNo),
    language: info.language,
    attrs: otherAttrs(info.attrs, 'query'),
    output: null,
  };
}

/**
 * `rerun` says who decides when this cell's answers are refreshed (§5).
 *
 * Validated for the same reason `hold` is, and with more at stake: a
 * `rerun="atuo"` that quietly fell back to manual would leave the author's
 * demonstration cell showing answers from a program the reader has since edited
 * — which is the exact failure the attribute was written to prevent, wearing the
 * face of the fix.
 */
function readRerun(value, lineNo) {
  if (value === undefined) return null;
  if (value !== 'manual' && value !== 'auto') {
    throw new NotebookError(`rerun="${value}" is not manual or auto`, lineNo);
  }
  return value;
}

/**
 * `hold` withholds this cell's saved answers from a reader who has not earned
 * them yet (§5). Two values, and a typo is an error rather than a silent no-op:
 * `hold="untill-run"` that quietly did nothing would spoil the prediction it was
 * written to protect, and the author would never find out.
 */
function readHold(value, lineNo) {
  if (value === undefined) return null;
  if (value !== 'until-run' && value !== 'until-answered') {
    throw new NotebookError(`hold="${value}" is not until-run or until-answered`, lineNo);
  }
  return value;
}

/**
 * One goal per cell, because the output block keys one solution sequence to one
 * cell. The trailing full stop is optional and canonical form omits it, matching
 * what a reader types at a toplevel prompt.
 */
function stripTerminator(text, lineNo) {
  const end = findClauseEnd(text);
  if (end === -1) return text;
  if (text.slice(end + 1).trim() !== '') {
    throw new NotebookError('a query cell holds exactly one goal', lineNo);
  }
  return text.slice(0, end).trim();
}

/** Index of the first `.` that ends a term: not quoted, not a decimal point. */
function findClauseEnd(text) {
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if (c === '.') {
      const before = text[i - 1];
      const after = text[i + 1];
      if (/\d/.test(before ?? '') && /\d/.test(after ?? '')) continue;
      if (after === undefined || /\s/.test(after)) return i;
    }
  }
  return -1;
}

/**
 * Attachment is structural: an output block belongs to the cell it immediately
 * follows, and in the model it is not a cell at all but a property of the query.
 * That makes an orphaned output — a stale answer attached to nothing — impossible
 * to construct rather than merely discouraged.
 */
function attachOutput(cells, info, block, lineNo) {
  const previous = cells[cells.length - 1];
  if (!previous || previous.kind !== 'query') {
    throw new NotebookError('an output block must follow a query cell', lineNo);
  }
  if (previous.output !== null) {
    throw new NotebookError(`query "${previous.id}" already has an output block`, lineNo);
  }
  const declared = info.attrs.get('for');
  // `for` is redundant with position, and stays: redundancy is the check that
  // catches a GUI bug, and it makes the block self-describing on GitHub.
  if (declared !== undefined && previous.id !== null && declared !== previous.id) {
    throw new NotebookError(`output for="${declared}" follows query "${previous.id}"`, lineNo);
  }
  const body = trimBlankEdges(block.body);
  // An output block with nothing in it claims a query has answers and then shows
  // none. There is no reading of that which is true: a query with no answers to
  // show simply has no output block, and that is already valid (§6).
  if (body.length === 0) {
    throw new NotebookError(`output for="${previous.id ?? ''}" is empty`, lineNo);
  }
  previous.output = {
    ...parseSolutions(body),
    inputHash: info.attrs.get('input-hash') ?? null,
    language: info.language,
    attrs: otherAttrs(info.attrs, 'output'),
  };
}

/**
 * The body is SWI's own toplevel spelling. We store the SEQUENCE rather than a
 * blob because `; next` must replay saved solutions one at a time with no engine
 * present — the stepping has to survive on a cold page.
 *
 * Bindings can wrap across lines, so a solution is every line up to and including
 * the one ending in ` ;`.
 *
 * A sequence whose LAST line ends in ` ;` has no terminator, and that is the
 * format's spelling for NOT EXHAUSTED (§6): the reader took three of six and
 * stopped, or the author is showing the first four of infinitely many. It falls
 * out of the loop below rather than being detected — the last ` ;` closes a
 * solution and leaves `current` empty, so `terminator` stays `''`, which is the
 * one value no finished sequence can have.
 */
function parseSolutions(bodyLines) {
  const solutions = [];
  let current = [];
  let terminator = '';
  for (let i = 0; i < bodyLines.length; i++) {
    const line = bodyLines[i];
    if (line.endsWith(' ;')) {
      current.push(line.slice(0, -2));
      solutions.push(current.join('\n'));
      current = [];
    } else if (i === bodyLines.length - 1) {
      current.push(line);
      terminator = current.join('\n');
    } else {
      current.push(line);
    }
  }
  return { solutions, terminator };
}

function parseContainerHead(line, lineNo) {
  const m = /^> \[!([a-z][a-z0-9-]*)([^\]]*)\](.*)$/.exec(line);
  if (!m) return null;
  const attrs = new Map();
  if (m[2].trim() !== '') {
    const re = /([a-z][a-z0-9-]*)="((?:[^"\\]|\\.)*)"/g;
    let hit;
    while ((hit = re.exec(m[2])) !== null) attrs.set(hit[1], hit[2].replace(/\\(["\\])/g, '$1'));
    if (attrs.size === 0) throw new NotebookError(`unparsable container attributes: ${m[2]}`, lineNo);
  }
  return { variant: m[1], attrs, title: m[3].trim() };
}

function readContainer(state, head) {
  const body = [];
  state.i++;
  while (state.i < state.lines.length) {
    const line = state.lines[state.i];
    if (line === '>') { body.push(''); state.i++; continue; }
    if (line.startsWith('> ')) { body.push(line.slice(2)); state.i++; continue; }
    break;
  }
  return {
    kind: 'container',
    variant: head.variant,
    title: head.title,
    body: trimBlankEdges(body).join('\n'),
    attrs: head.attrs,
  };
}

/** Attributes we did not interpret, kept in read order so nothing is lost on write-back. */
function otherAttrs(attrs, kind) {
  const known = new Set(ATTR_ORDER[kind]);
  if (kind === 'output') known.add('for').add('input-hash');
  const rest = new Map();
  for (const [k, v] of attrs) if (!known.has(k)) rest.set(k, v);
  return rest;
}

/**
 * `id` is optional in hand-written source and required in canonical form. Minted
 * ids are held in memory until something writes the file back, at which point the
 * chapter self-heals — hand-write it, run it once, the ids are there.
 */
function mintIds(cells, taken) {
  const counters = { program: 0, query: 0 };
  for (const cell of cells) {
    if (cell.kind !== 'program' && cell.kind !== 'query') continue;
    if (cell.id !== null) continue;
    const prefix = cell.kind === 'program' ? 'p' : 'q';
    let id;
    do { id = `${prefix}-${++counters[cell.kind]}`; } while (taken.has(id));
    taken.add(id);
    cell.id = id;
  }
}

function trimBlankEdges(lines) {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim() === '') start++;
  while (end > start && lines[end - 1].trim() === '') end--;
  return lines.slice(start, end);
}

// ------------------------------------------------------------ serialising

/**
 * Model back to markdown, canonically.
 *
 * Stronger than round-trip: round-trip says do not corrupt what is there, this
 * says agree on what to write, so a cell inserted by a GUI and one typed by a
 * human produce the same bytes and commits stop alternating between two
 * spellings of the same file.
 *
 * @param {{frontMatter: Map<string, string>, cells: object[]}} notebook
 * @returns {string}
 */
export function serialise(notebook) {
  const parts = [];

  if (notebook.frontMatter.size > 0) {
    const fm = ['---'];
    for (const [k, v] of notebook.frontMatter) fm.push(`${k}: ${v}`);
    fm.push('---');
    parts.push(fm.join('\n'));
  }

  for (const cell of notebook.cells) {
    switch (cell.kind) {
      case 'markdown':
      case 'unknown':
        parts.push(cell.source);
        break;
      case 'program':
        parts.push(fenced(cell.language ?? 'prolog', 'program', orderedAttrs(cell, 'program'), cell.source));
        break;
      case 'query': {
        parts.push(fenced(cell.language ?? 'prolog', 'query', orderedAttrs(cell, 'query'), cell.goal));
        if (cell.output) {
          // No terminator means the sequence was never exhausted, and the file
          // says so by ending on a ` ;` — writing a blank line in its place
          // would not round-trip, since the parser trims blank edges.
          const solutions = cell.output.solutions.map((s) => `${s} ;`);
          const body = cell.output.terminator
            ? [...solutions, cell.output.terminator]
            : solutions;
          parts.push(fenced(
            cell.output.language ?? 'text',
            'output',
            orderedAttrs(cell, 'output'),
            body.join('\n')
          ));
        }
        break;
      }
      case 'container': {
        const head = `> [!${cell.variant}${containerAttrs(cell.attrs)}]${cell.title ? ` ${cell.title}` : ''}`;
        const body = cell.body === '' ? [] : cell.body.split('\n').map((l) => (l === '' ? '>' : `> ${l}`));
        parts.push([head, ...body].join('\n'));
        break;
      }
      default:
        throw new NotebookError(`cannot serialise cell kind "${cell.kind}"`);
    }
  }

  // Exactly one blank line between blocks. Runs of blank lines *within* prose are
  // the author's and are interior to a markdown cell, so they survive untouched.
  return `${parts.join('\n\n')}\n`;
}

function orderedAttrs(cell, kind) {
  const out = new Map();
  if (kind === 'program') {
    out.set('id', cell.id);
    if (cell.src) out.set('src', cell.src);
    for (const [k, v] of cell.attrs) out.set(k, v);
  } else if (kind === 'query') {
    out.set('id', cell.id);
    if (cell.rerun) out.set('rerun', cell.rerun);
    if (cell.hold) out.set('hold', cell.hold);
    for (const [k, v] of cell.attrs) out.set(k, v);
  } else {
    out.set('for', cell.id);
    if (cell.output.inputHash) out.set('input-hash', cell.output.inputHash);
    for (const [k, v] of cell.output.attrs) out.set(k, v);
  }
  return out;
}

function containerAttrs(attrs) {
  if (!attrs || attrs.size === 0) return '';
  return ` ${[...attrs].map(([k, v]) => `${k}="${escapeAttr(v)}"`).join(' ')}`;
}

function fenced(language, kind, attrs, body) {
  const pairs = [...attrs].map(([k, v]) => `${k}="${escapeAttr(v)}"`);
  const info = [language, kind, ...pairs].join(' ');
  // Three backticks always, lengthened only if the content itself forces it.
  let ticks = '```';
  const longest = body.split('\n').reduce((n, line) => {
    const m = /^(`{3,})/.exec(line);
    return m ? Math.max(n, m[1].length) : n;
  }, 0);
  if (longest >= 3) ticks = '`'.repeat(longest + 1);
  return body === '' ? `${ticks}${info}\n${ticks}` : `${ticks}${info}\n${body}\n${ticks}`;
}

function escapeAttr(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// ------------------------------------------------------------ input hash

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK = 0xffffffffffffffffn;

/**
 * FNV-1a, 64-bit, over the UTF-8 bytes of the digest string:
 *
 *     <goal>\0 ( <cell-id>\0 <resolved-source>\0 )*
 *
 * for every program cell preceding the query in document order. Pinned exactly,
 * because it is a file-format constant.
 *
 * Not a security boundary and not trying to be — a notebook that lies about its
 * outputs can lie about the hash too. It is a change detector, and a fast
 * dependency-free sync hash beats SHA-256 via WebCrypto, which is async in the
 * browser and would push staleness past first paint for no benefit.
 *
 * @param {string} goal canonical goal text
 * @param {{id: string, source: string}[]} programCells preceding program cells, in order
 * @returns {string} 16 lowercase hex digits
 */
export function inputHash(goal, programCells) {
  let digest = `${goal}\u0000`;
  for (const cell of programCells) digest += `${cell.id}\u0000${cell.source}\u0000`;

  const bytes = new TextEncoder().encode(digest);
  let hash = FNV_OFFSET;
  for (const byte of bytes) {
    hash = (hash ^ BigInt(byte)) * FNV_PRIME & MASK;
  }
  return hash.toString(16).padStart(16, '0');
}

/**
 * v0.2 hashes against ALL preceding program cells rather than the dependency
 * closure. It over-approximates — editing an unrelated earlier cell marks a query
 * stale — which is the cheap, correct-by-construction side to be wrong on.
 *
 * @param {{cells: object[]}} notebook
 * @param {object} queryCell
 * @returns {string}
 */
export function hashFor(notebook, queryCell) {
  const preceding = [];
  for (const cell of notebook.cells) {
    if (cell === queryCell) break;
    if (cell.kind === 'program') preceding.push({ id: cell.id, source: cell.source });
  }
  return inputHash(queryCell.goal, preceding);
}
