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
import { banner, VERSION } from '../src/version.js';
import { updateNotice } from '../src/update.js';
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

// Only for swipl-wasm's own version: everything about THIS package is in
// src/version.js, where a page can import it too.
const require = createRequire(import.meta.url);

const USAGE = `prolog-notebook — Jupyter-style notebooks for Prolog

  prolog-notebook run <file.prolog.md>...   run every cell, write the answers back

Options
  --limit <n>     solutions to take from one query before stopping (default ${DEFAULT_LIMIT})
  --stdout        print the result instead of writing the file
  --quiet         report only failures
  --version       version, engine and copyright
  --check-update  ask npm whether a newer one exists, and say so either way
  -h, --help      this

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
  // The same line the page shows in its panel: src/version.js, imported by both.
  const lines = [banner()];
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
    // No update check here, deliberately: --version and --help are what someone
    // types at an install that is not working, and they stay instant and offline.
    process.stdout.write(await version());
    return 0;
  }

  // Asked for explicitly. On its own it is the whole command; alongside `run` it
  // forces the check that would otherwise wait for the day to turn over.
  const asked = args.includes('--check-update');
  if (asked && args.filter((a) => !a.startsWith('-')).length === 0) {
    const notice = await updateNotice({ version: VERSION, force: true });
    process.stderr.write(`${notice}\n`);
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
    else if (arg === '--check-update') { /* handled above, and not a file */ }
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

  // STARTED NOW, READ AT THE END. The registry is somebody else's machine on
  // somebody else's network, and none of that should stand between the reader
  // and their answers — so the question is asked while the work happens and the
  // answer is collected once it is done.
  //
  // Not asked at all under --quiet, unless it was asked for outright: --quiet
  // means "report only failures", and news about a newer version is not one. Not
  // starting the request is better than starting it and discarding the answer.
  const update = options.quiet && !asked
    ? Promise.resolve(null)
    : updateNotice({ version: VERSION, force: asked }).catch(() => null);

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

  // stderr, always: `run --stdout` is a notebook going down a pipe, and a version
  // notice in the middle of it would corrupt the file it is printing.
  const notice = await update;
  if (notice) process.stderr.write(`${notice}\n`);
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
