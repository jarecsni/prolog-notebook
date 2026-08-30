#!/usr/bin/env node
// The command line. Thin on purpose: argument parsing, files, and words for a
// terminal. Everything it does lives in src/run.js and src/export.js, so a VS
// Code "run all" and a future --check get the same behaviour without going
// through a shell (869ectt38, 869ectt3e).
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { parse, NotebookError } from '../src/format.js';
import { prologVersion } from '../src/engine.js';
import { buildLine, currentBuild } from '../src/build-info.js';
import { exportSource } from '../src/export.js';
import { runNotebook, DEFAULT_LIMIT } from '../src/run.js';

// The engine is imported WHERE IT IS USED, never at the top. src/node.js pulls in
// 5.9 MB of WebAssembly at module scope, so a static import here would mean that
// `--help` on a broken install fails before it can print anything — and the two
// commands most likely to be typed at a broken install are --help and --version.
const engine = () => import('../src/node.js');

// `prolog-notebook run --stdout file | head` closes the pipe while we are still
// writing to it. That is the reader using the shell correctly, not an error, and
// a command that answers it with an unhandled EPIPE and a stack trace is
// complaining about being used properly.
for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', (e) => {
    if (e.code !== 'EPIPE') throw e;
  });
}

const require = createRequire(import.meta.url);
const PACKAGE = require('../package.json');

/**
 * The name a person would say, not the one npm installs. `prolog-notebook` is an
 * identifier; this is a title, and --version is the one place the tool says who
 * it is rather than how to type it.
 */
const NAME = 'Prolog Notebook';

/**
 * The copyright holder and year.
 *
 * Written here rather than read from LICENSE at runtime — a command should not
 * depend on a file it does not need — but a test asserts the two agree, so this
 * cannot quietly drift out of step with the licence it refers to.
 */
const COPYRIGHT = 'Copyright (C) 2026 Johnny Jarecsni';

const USAGE = `prolog-notebook — Jupyter-style notebooks for Prolog

  prolog-notebook run <file.prolog.md>...   run every cell, write the answers back

Options
  --limit <n>   solutions to take from one query before stopping (default ${DEFAULT_LIMIT})
  --stdout      print the result instead of writing the file
  --quiet       report only failures
  --version     version, engine and copyright
  -h, --help    this

A query that stops at the limit is written without a terminator, which is the
format's way of saying the search was never exhausted. Nothing is invented.
`;

/**
 * A runaway goal hangs this process — the engine is in-process here, so there is
 * no thread left to notice (869ejgyax). Stated rather than implied, because the
 * moment this runs a file someone else wrote it stops being an annoyance.
 */
const RUNAWAY_WARNING = 'note: a non-terminating goal will hang this command; it has no timeout yet (869ejgyax)';

/**
 * Who this is, and — the part that is not on anyone's disk — which Prolog it
 * will run your chapters with.
 *
 * THE ENGINE LINE EARNS ITS 59 MILLISECONDS. swipl-wasm's own version says
 * nothing about SWI's: 8.0.4 ships 10.1.10. A notebook's saved answers are only
 * true of the engine that produced them, so this is the one fact here that a
 * reader could not have looked up.
 *
 * An engine that will not load is REPORTED, not fatal. "I cannot start Prolog"
 * is exactly what someone running --version to diagnose a broken install needs
 * to be told, and exiting non-zero would hide it behind a shell error.
 */
async function version() {
  const lines = [`${NAME} v${PACKAGE.version} - ${COPYRIGHT}, ${PACKAGE.license} License.`];
  try {
    const { createSession } = await engine();
    const swipl = await prologVersion(await createSession());
    const wasm = `swipl-wasm ${require('swipl-wasm/package.json').version}`;
    lines.push(swipl ? `Powered by SWI-Prolog ${swipl}, ${wasm}` : `Powered by ${wasm}`);
  } catch (e) {
    // Not "powered by" anything, so it does not say so. Someone running this to
    // find out why nothing works needs the reason, not a formula.
    lines.push(`SWI-Prolog could not be started: ${e.message}`);
  }
  // Omitted rather than guessed at when there is neither a baked file nor a git
  // repository — a line that says "unknown" three times is worse than no line.
  lines.push(buildLine(currentBuild()));
  // The blank line is deliberate: this is a banner, and a banner that runs into
  // the next shell prompt reads as an error message.
  return `${lines.join('\n')}\n\n`;
}

async function main(argv) {
  const args = argv.slice(2);
  if (!args.length || args.includes('-h') || args.includes('--help')) {
    process.stdout.write(USAGE);
    return 0;
  }
  if (args.includes('--version') || args.includes('-V')) {
    process.stdout.write(await version());
    return 0;
  }

  const command = args.shift();
  if (command !== 'run') {
    process.stderr.write(`unknown command "${command}"\n\n${USAGE}`);
    return 2;
  }

  const options = { limit: DEFAULT_LIMIT, stdout: false, quiet: false };
  const files = [];
  while (args.length) {
    const arg = args.shift();
    if (arg === '--limit') {
      const value = Number(args.shift());
      if (!Number.isInteger(value) || value < 1) {
        process.stderr.write('--limit takes a positive whole number\n');
        return 2;
      }
      options.limit = value;
    } else if (arg === '--stdout') options.stdout = true;
    else if (arg === '--quiet') options.quiet = true;
    else if (arg.startsWith('-')) {
      process.stderr.write(`unknown option "${arg}"\n\n${USAGE}`);
      return 2;
    } else files.push(arg);
  }

  if (!files.length) {
    process.stderr.write('run needs at least one file\n');
    return 2;
  }
  if (!options.quiet) process.stderr.write(`${RUNAWAY_WARNING}\n`);

  // One engine for the whole invocation, restarted between files. A notebook is
  // a world of its own — one cell is one virtual file, and two chapters may
  // define the same predicate — so carrying clauses across would let a file pass
  // because of what the file before it happened to load.
  const { createSession } = await engine();
  const session = await createSession();
  let status = 0;

  for (const file of files) {
    await session.restart();
    status = Math.max(status, await runFile(file, session, options));
  }
  return status;
}

async function runFile(file, session, options) {
  const name = basename(file);
  let notebook;
  let source;
  try {
    source = readFileSync(file, 'utf8');
    notebook = parse(source);
  } catch (e) {
    // The parser's line numbers are the file's own, so its message is already
    // the most useful thing anyone could say here.
    process.stderr.write(`${file}: ${e instanceof NotebookError ? e.message : e.message}\n`);
    return 1;
  }

  const { edits, failures, warnings } = await runNotebook(notebook, session, {
    limit: options.limit,
    onCell: (event) => {
      if (options.quiet) return;
      if (event.kind === 'program') {
        process.stderr.write(`  ${event.ok ? '✓' : '✗'} ${event.id}\n`);
        return;
      }
      const answers = event.error
        ? `error: ${event.error}`
        : `${event.solutions.length} solution${event.solutions.length === 1 ? '' : 's'}`
          + (event.truncated ? ` (stopped at ${options.limit}, not exhausted)` : '');
      process.stderr.write(`  ${event.error ? '✗' : '✓'} ${event.id} — ${answers}\n`);
    },
  });

  for (const warning of warnings) process.stderr.write(`  ! ${warning.id}: ${warning.text}\n`);

  if (failures.length) {
    // NOTHING IS WRITTEN when a program cell failed to load. Every answer below
    // it was produced against a chapter that does not exist, and writing those
    // into the file would publish them as though they did.
    for (const failure of failures) {
      process.stderr.write(`${file}: cell ${failure.id} did not load: ${failure.error}\n`);
    }
    process.stderr.write(`${name}: not written\n`);
    return 1;
  }

  const text = exportSource(notebook, edits);
  if (options.stdout) {
    process.stdout.write(text);
    return 0;
  }
  if (text === source) {
    if (!options.quiet) process.stderr.write(`${name}: unchanged\n`);
    return 0;
  }
  writeFileSync(file, text);
  if (!options.quiet) process.stderr.write(`${name}: written\n`);
  return 0;
}

process.exitCode = await main(process.argv);
