#!/usr/bin/env node
// The command line. Thin on purpose: argument parsing, files, and words for a
// terminal. Everything it does lives in src/run.js and src/export.js, so a VS
// Code "run all" and a future --check get the same behaviour without going
// through a shell (869ectt38, 869ectt3e).
import { createRequire } from 'node:module';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { parse, NotebookError } from '../src/format.js';
import { prologVersion } from '../src/engine.js';
import { buildLine, currentBuild } from '../src/build-info.js';
import { banner, VERSION } from '../src/version.js';
import { updateNotice } from '../src/update.js';
import { confirm, describeInstall, globalRoot, install, relaunch, upgradePlan } from '../src/upgrade.js';
import { clearedSource, exportSource } from '../src/export.js';
import { runNotebook, DEFAULT_LIMIT } from '../src/run.js';
import { livePages } from '../src/build.js';
import { openInBrowser, serve } from '../src/serve.js';

// The engine is imported WHERE IT IS USED, never at the top. src/node.js pulls in
// 5.9 MB of WebAssembly at module scope, so a static import here would mean that
// `--help` on a broken install fails before it can print anything — and the two
// commands most likely to be typed at a broken install are --help and --version.
const engine = () => import('../src/node.js');

// `prolog-notebook execute --stdout file | head` closes the pipe while we are still
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

/**
 * WHAT A COMMAND TAKES BESIDE ITS OPTIONS, named and explained once.
 *
 * `.prolog.md` is a convention and nothing enforces it — any markdown file runs —
 * so the operand is `<file>` everywhere and the line below the usage says what
 * kind of file to hand it.
 *
 * SEVERAL FILES ARE `<file(s)>`, NOT THE POSIX `<file>...`, and the departure is
 * deliberate. The ellipsis is the convention — Base Specifications 12.1, and what
 * cc, cp, grep and git print — but it is punctuation you have to already know, and
 * the Captain read it as saying less than it does. `(s)` is legible to someone who
 * has never read a man page, and the row below spells it out in words anyway.
 * Nobody types either form, so the cost of being unconventional here is zero.
 */
const FILE = ['<file>', 'Prolog Notebook file (.md)'];
const FILES = ['<file(s)>', 'space separated list of Prolog Notebook files (.md)'];

/**
 * THE COMMANDS, AND WHAT EACH ONE TAKES — one table, three readers (869erqra0).
 *
 * The whole help, a single command's help, and the message a misplaced option
 * gets are all derived from here. They were three lists kept by hand, which is
 * how the help came to advertise flags that no command accepted.
 *
 * Options belong to COMMANDS, not to the tool. Listing them in one flat block
 * reads as a promise that every one works everywhere, and only three of them do.
 */
const COMMANDS = {
  view: {
    takes: [FILE],
    blurb: 'read it in a browser, cells and all',
    options: [
      ['--port <n>', 'what it listens on (default 8777)'],
      ['--no-open', 'print the URL instead of opening a browser'],
    ],
  },
  build: {
    takes: [FILE],
    blurb: 'write a page you can host or send',
    options: [['--out <dir>', 'where it writes (default: <file>-site)']],
  },
  execute: {
    takes: [FILES],
    blurb: 'run every query, write the answers in',
    options: [
      ['--limit <n>', `solutions to take from one query before stopping (default ${DEFAULT_LIMIT})`],
      ['--stdout', 'print the result instead of writing the file'],
      ['--quiet', 'report only failures'],
    ],
    // Belongs to --limit, so it goes wherever --limit goes and nowhere else.
    note: 'A query that stops at the limit is written without a terminator, which is the\n'
      + "format's way of saying the search was never exhausted. Nothing is invented.\n",
  },
  clear: {
    takes: [FILES],
    blurb: 'take the answers back out',
    options: [
      ['--stdout', 'print the result instead of writing the file'],
      ['--quiet', 'report only failures'],
    ],
  },
  upgrade: {
    takes: [],
    blurb: 'fetch the latest version',
    options: [],
  },
};

/** `exec` and `run` reach `execute` and are deliberately undocumented (869erp0jd). */
const ALIASES = { exec: 'execute', run: 'execute' };

/** The command this argument names, aliases resolved, or null. */
const commandNamed = (arg) => (COMMANDS[arg] ? arg : ALIASES[arg] ?? null);

/**
 * What works anywhere, and one line saying what --help has just done.
 *
 * The flag is contextual and that line was not: `-h, --help  this` was written
 * before a command could be asked about itself and nobody revisited it, so the
 * summary sat there promising the summary (869ery5hj). Each screen says which
 * of the two it is.
 */
const anywhere = (help) => `Anywhere
  --check-update  ask npm whether a newer one exists, and say so either way
  --version       version, engine and copyright
  -h, --help      ${help}
`;

/**
 * One command, one line — the summary's unit.
 *
 * Everything but the name and the blurb belongs to the command's own help, where
 * the line is the one you would actually type rather than an entry in a list.
 * This screen answers WHICH COMMAND; that one answers HOW TO CALL IT.
 */
/**
 * How the command is called: options before operands, as POSIX has it and as
 * every tool a reader has already met prints it.
 *
 * `[<options>]` IS BRACKETED AND `<file(s)>` IS NOT, which is the same convention
 * saying the two are not alike: brackets mean you may leave it out, and every
 * command here works with no options and none works with no file.
 *
 * The rows below the line stay operand-first, because that row explains the
 * placeholder in the line above and is no use to anyone underneath five switches.
 */
const called = (name) => {
  const { takes, options } = COMMANDS[name];
  return [name, options.length ? '[<options>]' : '', ...takes.map(([operand]) => operand)]
    .filter(Boolean)
    .join(' ');
};

function commandLine(name) {
  // THE NAME AND WHAT IT DOES, AND NOTHING ELSE. A reader on this screen is
  // choosing a command, and every one of them takes a file — so the operand told
  // them nothing about the choice while making five lines wider than the answer
  // they came for.
  return `  ${name.padEnd(11)}${COMMANDS[name].blurb}`;
}

/**
 * One command, everything it takes, and nothing another command takes.
 *
 * Operands and options are laid out the same way because they are the same kind
 * of fact — what may follow the command — and a reader who has to learn two
 * shapes to read one screen is being charged for our tidiness.
 */
function commandHelp(name) {
  const { takes, blurb, options } = COMMANDS[name];
  return [`  prolog-notebook ${called(name).padEnd(32)}${blurb}`]
    .concat([...takes, ...options].map(([what, why]) => `    ${what.padEnd(16)}${why}`))
    .join('\n');
}

/**
 * THE SUMMARY NAMES THE COMMANDS AND NOTHING ELSE (869ery5hj).
 *
 * The Captain, on running the tool bare: "this is not great, why do we have
 * command level help then." It printed every option of every command, so the tier
 * below it earned nothing and the first screen a new reader met was the longest
 * one in the tool. What is left is the list, the three flags that do work
 * anywhere, and where to ask for more.
 *
 * The execute note goes with them. It explains --limit, and the comment on it in
 * COMMANDS says it travels wherever --limit goes and nowhere else — a rule this
 * screen was breaking.
 */
const USAGE = `prolog-notebook — Jupyter-style notebooks for Prolog

${Object.keys(COMMANDS).map(commandLine).join('\n')}

${anywhere("this, or one command's: prolog-notebook build --help")}`;

/**
 * JUST THE COMMAND ASKED ABOUT (869erqra0).
 *
 * The Captain, on being shown all five for `build --help`: "not really. If I run
 * prolog-notebook cmd --help I want only help on that cmd." Printing everything
 * makes the reader find their command again in a page they did not ask for.
 *
 * What works anywhere stays, because it is true of the command they asked about
 * as much as of any other.
 */
function helpFor(name) {
  const { note } = COMMANDS[name];
  return `${commandHelp(name)}\n\n${anywhere('this')}${note ? `\n${note}` : ''}`;
}

/**
 * Which command each option belongs to, so a misplaced one can say where it lives.
 *
 * Derived, so a flag added to a command above cannot be forgotten here.
 * `unknown option "--limit"` is true and unhelpful when the flag is real and two
 * lines further up the same help.
 */
const BELONGS_TO = {};
for (const [name, { options }] of Object.entries(COMMANDS)) {
  for (const [flag] of options) {
    const bare = flag.split(' ')[0];
    BELONGS_TO[bare] = BELONGS_TO[bare] ? `${BELONGS_TO[bare]} and ${name}` : name;
  }
}

function unknownOption(arg, command) {
  const home = BELONGS_TO[arg];
  return home && home !== command
    ? `${arg} belongs to ${home}, not to ${command}\n`
    : `unknown option "${arg}"\n`;
}

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

/**
 * Fetch the latest, if this copy is one we know how to replace.
 *
 * @param {string} version what to install
 * @returns {Promise<number>} an exit code
 */
async function upgrade(version) {
  const packageRoot = new URL('..', import.meta.url).pathname;
  const kind = describeInstall({ packageRoot, globalRoot: await globalRoot() });
  const plan = upgradePlan(kind, version);
  if (plan.say) {
    process.stderr.write(`${plan.say}\n`);
    return 1;
  }
  process.stderr.write(`Updating with ${NPM_LINE} ${plan.argv.join(' ')}\n`);
  if (!(await install(plan.argv))) {
    process.stderr.write('npm could not complete the update.\n');
    return 1;
  }
  process.stderr.write(`You now have Prolog Notebook ${version}.\n`);
  return 0;
}

/**
 * Offer it, but only where a question is a question.
 *
 * A pipe, a script and CI are all places where waiting for an answer is a hang,
 * so the notice is simply printed there. Both streams are checked because the
 * question goes to stderr and the answer comes from stdin.
 */
/**
 * Is there somebody at the other end?
 *
 * Both streams, because the question goes to stderr and the answer comes back on
 * stdin. A pipe, a script and CI are all places where a question is a hang.
 */
function canAsk() {
  return Boolean(process.stdin.isTTY && process.stderr.isTTY);
}

/**
 * The offer, BEFORE the command does anything — which is the only place it can
 * change the outcome. Afterwards the files are written, the server is up, and a
 * newer version has nothing left to do.
 *
 * Every command that does real work goes through here: `run`, `view` and
 * `build`. It went in the execute path first and stayed there, so `view` — the
 * command somebody is most likely to leave running — was the one that never
 * looked.
 *
 * It costs a network round trip once a day, not once a run: the rest of the day
 * is a file read.
 *
 * @returns {Promise<number|null>} an exit code when the command has been handed
 *   to a newer version, null to carry on here.
 */
async function upgradeFirst({ quiet = false, asked = false } = {}) {
  // ASKED OUTRIGHT ALWAYS ANSWERS (869erqra0). A terminal is needed to OFFER the
  // upgrade, never to report one: `--check-update` down a pipe used to check
  // nothing and say nothing, which is indistinguishable from "you are up to
  // date" — the one thing this must never look like.
  if (!asked && (!canAsk() || quiet)) return null;
  const ahead = await updateNotice({ version: VERSION, force: asked })
    .catch(() => ({ message: null, newer: null }));
  if (ahead.message) process.stderr.write(`${ahead.message}\n`);
  // The notice is printed above whatever happens next; only the question needs
  // somebody at the other end to answer it.
  if (!ahead.newer || !canAsk()) return null;
  if (!(await confirm('Update and continue on the new version?'))) return null;
  if ((await upgrade(ahead.newer)) !== 0) {
    process.stderr.write('Carrying on with the version you have.\n');
    return null;
  }
  process.stderr.write('Continuing on the new version.\n');
  // The path has not changed — npm replaced what is behind it — so this is the
  // same command, running the bytes that have just arrived.
  return relaunch(process.argv);
}

async function offerUpgrade(newer) {
  if (!canAsk()) {
    // Nobody to ask, so say what to type instead. `prolog-notebook upgrade`
    // rather than the npm line: it knows how this copy was installed, and the
    // npm line is wrong for a project dependency.
    process.stderr.write('Update with: prolog-notebook upgrade\n');
    return null;
  }
  if (!(await confirm('Update now?'))) {
    process.stderr.write('  (run `prolog-notebook upgrade` whenever you like)\n');
    return null;
  }
  return upgrade(newer);
}

const NPM_LINE = process.platform === 'win32' ? 'npm.cmd' : 'npm';

async function main(argv) {
  const args = argv.slice(2);
  if (!args.length || args.includes('-h') || args.includes('--help')) {
    // Whichever command they named, wherever they named it: `view --help`,
    // `--help view` and `view chapter.prolog.md -h` all ask the same question.
    // A help flag that is positional is its own small annoyance.
    const named = args.map((arg) => commandNamed(arg)).find(Boolean);
    process.stdout.write(named ? helpFor(named) : USAGE);
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
    const { message, newer } = await updateNotice({ version: VERSION, force: true });
    if (message) process.stderr.write(`${message}\n`);
    return newer ? (await offerUpgrade(newer)) ?? 0 : 0;
  }

  const command = args.shift();
  if (command === 'view' || command === 'build') return page(command, args, asked);
  if (command === 'clear') return clear(args, asked);
  if (command === 'upgrade') {
    const { message, newer } = await updateNotice({ version: VERSION, force: true });
    if (message) process.stderr.write(`${message}\n`);
    return newer ? upgrade(newer) : 0;
  }
  // `execute` and `exec` are aliases and stay undocumented: one name is the name.
  // `run` because it is published in every release since 0.3.0 and breaking it
  // silently would be rude; `exec` because seven characters is a lot to type in
  // a loop (869erp0jd).
  if (!['execute', 'exec', 'run'].includes(command)) {
    process.stderr.write(`unknown command "${command}"\n\n${USAGE}`);
    return 2;
  }

  const options = { limit: DEFAULT_LIMIT, stdout: false, quiet: false };
  // Whether the offer has already been made, before the work started.
  let checked = false;
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
      process.stderr.write(unknownOption(arg, 'execute'));
      return 2;
    } else files.push(arg);
  }

  if (!files.length) {
    process.stderr.write('execute needs at least one file\n');
    return 2;
  }
  if (!options.quiet) process.stderr.write(`${RUNAWAY_WARNING}\n`);

  const jump = await upgradeFirst({ quiet: options.quiet, asked });
  if (jump !== null) return jump;
  // Whatever upgradeFirst has just reported must not be reported again below.
  // Asked outright, it always reports now, terminal or not.
  checked = asked || (canAsk() && !options.quiet);

  // STARTED NOW, READ AT THE END. The registry is somebody else's machine on
  // somebody else's network, and none of that should stand between the reader
  // and their answers — so the question is asked while the work happens and the
  // answer is collected once it is done.
  //
  // Not asked at all under --quiet, unless it was asked for outright: --quiet
  // means "report only failures", and news about a newer version is not one. Not
  // starting the request is better than starting it and discarding the answer.
  // The other half: nobody to ask, so the question is asked ALONGSIDE the work
  // and reported at the end. A terminal has had its offer already.
  const update = checked || (options.quiet && !asked)
    ? Promise.resolve({ message: null, newer: null })
    : updateNotice({ version: VERSION, force: asked }).catch(() => ({ message: null, newer: null }));

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

  // stderr, always: `execute --stdout` is a notebook going down a pipe, and a version
  // notice in the middle of it would corrupt the file it is printing.
  const { message, newer } = await update;
  if (message) process.stderr.write(`${message}\n`);
  // Offered AFTER the work, and never re-running it: the files are written, and
  // a command that repeated itself on a newer version would write them twice.
  if (newer) await offerUpgrade(newer);
  return status;
}

/**
 * Take the answers back out.
 *
 * The counterpart to `execute`, and it exists because the alternative was editing
 * the file by hand: a workbook edition with the answers withheld, a diff without
 * nineteen solution sequences in the way, or starting again deliberately rather
 * than trusting an overwrite.
 *
 * No engine, no network and no update check: this is a text operation on a file
 * the reader already has.
 */
async function clear(args, asked = false) {
  const options = { stdout: false, quiet: false };
  const files = [];
  for (const arg of args) {
    if (arg === '--stdout') options.stdout = true;
    else if (arg === '--quiet') options.quiet = true;
    // Handled by the caller, and not a file.
    else if (arg === '--check-update') { /* global */ }
    else if (arg.startsWith('-')) {
      process.stderr.write(unknownOption(arg, 'clear'));
      return 2;
    } else files.push(arg);
  }
  if (!files.length) {
    process.stderr.write('clear needs at least one file\n');
    return 2;
  }

  // THE SAME DOOR AS EVERY OTHER COMMAND THAT DOES REAL WORK (869erqra0). 0.5.1
  // put `view` and `build` through it and this command shipped afterwards, so it
  // never looked. Emptying somebody's notebook is as real as work gets here, and
  // before the work is the only point at which a newer version changes anything.
  const jump = await upgradeFirst({ quiet: options.quiet, asked });
  if (jump !== null) return jump;

  let status = 0;
  for (const file of files) {
    let source;
    let emptied;
    try {
      source = readFileSync(file, 'utf8');
      emptied = clearedSource(parse(source));
    } catch (e) {
      process.stderr.write(`${file}: ${e.message}\n`);
      status = 1;
      continue;
    }
    if (options.stdout) {
      process.stdout.write(emptied.text);
      continue;
    }
    if (emptied.text === source) {
      if (!options.quiet) process.stderr.write(`${basename(file)}: nothing to remove\n`);
      continue;
    }
    writeFileSync(file, emptied.text);
    if (!options.quiet) {
      const n = emptied.cleared;
      process.stderr.write(`${basename(file)}: ${n} answer${n === 1 ? '' : 's'} removed\n`);
    }
  }
  return status;
}

/**
 * `build` and `view`, which are the same page put in two different places.
 *
 * Neither runs a cell: a chapter's answers are already in the file, which is the
 * whole reason a built page is readable before any engine arrives. Use `run` to
 * put them there.
 */
async function page(command, args, asked = false) {
  const options = { out: null, port: 8777, open: true };
  const files = [];
  while (args.length) {
    const arg = args.shift();
    // ONE PARSER, TWO COMMANDS, AND THEY DO NOT TAKE THE SAME FLAGS. `view` and
    // `build` share this function, so `build --port 90` was quietly accepted and
    // ignored while the help said --port was view's (869erqra0). A flag that is
    // read and thrown away is worse than one that is refused: it looks like it
    // worked.
    if (BELONGS_TO[arg] && BELONGS_TO[arg] !== command) {
      process.stderr.write(unknownOption(arg, command));
      return 2;
    }
    if (arg === '--out') options.out = args.shift();
    else if (arg === '--port') {
      options.port = Number(args.shift());
      if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535) {
        process.stderr.write('--port takes a port number\n');
        return 2;
      }
    } else if (arg === '--no-open') options.open = false;
    // Handled by the caller, and not a file.
    else if (arg === '--check-update') { /* global */ }
    else if (arg.startsWith('-')) {
      process.stderr.write(unknownOption(arg, command));
      return 2;
    } else files.push(arg);
  }
  if (files.length !== 1) {
    process.stderr.write(`${command} takes exactly one notebook\n`);
    return 2;
  }

  // The same offer the execute path makes, and for the same reason: a server about to
  // start, or a directory about to be written, is work that a newer version
  // should be doing.
  const jump = await upgradeFirst({ asked });
  if (jump !== null) return jump;

  const file = files[0];
  // ASKED AGAIN ON EVERY REQUEST, and built again only when the bytes have moved
  // (869erpuhk). `build` takes the first answer and writes it; `view` keeps the
  // producer, so a reload shows the chapter as it is now rather than as it was
  // when the server started.
  const pages = livePages(() => readFileSync(file, 'utf8'), {
    filename: basename(file),
    onError: (e) => process.stderr.write(`${file}: ${e.message}\n`),
  });
  let built;
  try {
    built = pages();
  } catch (e) {
    process.stderr.write(`${file}: ${e.message}\n`);
    return 1;
  }

  if (command === 'build') {
    const out = options.out ?? `${file.replace(/\.prolog\.md$/, '')}-site`;
    for (const [name, entry] of built) {
      const target = join(out, name);
      mkdirSync(dirname(target), { recursive: true });
      if (entry.text !== undefined) writeFileSync(target, entry.text);
      else copyFileSync(entry.copy, target);
    }
    process.stderr.write(`${out}: ${built.size} files\n`);
    // SAID HERE BECAUSE THIS IS WHERE IT IS ACTED ON. The obvious next move is to
    // double-click index.html, and that is the one thing that cannot work:
    // browsers refuse ES modules over file:// and the engine cannot be fetched
    // there either (869erqq1u). The page says so too, but by then somebody is
    // already looking at a chapter whose buttons do nothing.
    process.stderr.write(`Host ${out} over HTTP — opening ${join(out, 'index.html')} from disk`
      + ' will not run.\n');
    return 0;
  }

  const server = await serve(pages, { port: options.port });
  // THE URL IS THIS COMMAND'S OUTPUT. `view` writes no notebook and no data to
  // stdout, so there is nothing for it to corrupt — and a URL on stderr is a URL
  // a wrapper does not see, which is how somebody came to type localhost by hand
  // and land on another server entirely (869ernmvh).
  process.stdout.write(`${server.url}\n`);
  if (server.port !== options.port) {
    process.stderr.write(`${options.port} was already answering — using ${server.port} instead.\n`);
  }
  process.stderr.write(`${basename(file)} is at ${server.url} — Ctrl-C to stop.\n`);
  if (options.open) openInBrowser(server.url);
  // Deliberately never resolves: the server is the command.
  return new Promise(() => {});
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
