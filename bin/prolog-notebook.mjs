#!/usr/bin/env node
// The command line. Thin on purpose: argument parsing, files, and words for a
// terminal. Everything it does lives in src/run.js and src/export.js, so a VS
// Code "run all" and a future --check get the same behaviour without going
// through a shell (869ectt38, 869ectt3e).
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import {
  copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { parse, NotebookError } from '../src/format.js';
import { prologVersion } from '../src/engine.js';
import { buildLine, currentBuild } from '../src/build-info.js';
import { banner, VERSION } from '../src/version.js';
import { updateNotice } from '../src/update.js';
import { confirm, describeInstall, globalRoot, install, relaunch, upgradePlan } from '../src/upgrade.js';
import { clearedSource, exportSource } from '../src/export.js';
import { DEFAULT_LIMIT } from '../src/run.js';
import { Guarded, DEFAULT_TIMEOUT } from '../src/guard.js';
import { buildFiles, livePages, sharedFiles, titleOf } from '../src/build.js';
import {
  SITE, blocksFromDirectory, findSite, indexHtml, isEngine, isShared, pageName, pagesIn,
  projectSite, reconcile, shownAs,
} from '../src/site.js';
import {
  SPINE, booksOf, chaptersOf, findSpine, resolveSpine, seedSpine, withEntry,
} from '../src/spine.js';
import { liveSite, runtimeStale, siteFiles, unchanged } from '../src/book.js';
import { NOBODY, pagesUrl, pushSite, remoteUrl, repository } from '../src/publish.js';
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
  new: {
    takes: [FILES],
    blurb: 'start a chapter, wired up and in the book',
    options: [
      ['--title <text>', "the chapter's heading (default: from the filename)"],
    ],
    note: 'It is the one command that needs a name: there is no chapter yet for an operand\n'
      + 'to filter, and nothing sensible to default to.\n',
  },
  view: {
    takes: [FILES],
    blurb: 'read it in a browser, cells and all',
    options: [
      ['--port <n>', 'what it listens on (default 8777)'],
      ['--no-open', 'print the URL instead of opening a browser'],
      ['--built', 'serve the site as built, rather than your sources as they are'],
    ],
  },
  build: {
    takes: [FILES],
    blurb: 'write a page you can host or send',
    options: [
      ['--out <dir>', `where the site is (default: the nearest ${SITE})`],
      ['--root', `write to the project's ${SITE}, skipping any nearer one`],
    ],
  },
  execute: {
    takes: [FILES],
    blurb: 'run every query, write the answers in',
    options: [
      ['--limit <n>', `solutions to take from one query before stopping (default ${DEFAULT_LIMIT})`],
      ['--timeout <s>', `seconds a cell may say nothing before it is abandoned (default ${DEFAULT_TIMEOUT}, 0 waits)`],
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
      ['--yes', 'do not ask before emptying a whole book'],
    ],
  },
  publish: {
    takes: [],
    blurb: 'push the site where a host will serve it',
    options: [
      ['--dry-run', 'say what would go and where, push nothing'],
      ['--yes', 'do not ask first'],
    ],
    note: 'It pushes the site at the top of your repository, and only that one: GitHub Pages\n'
      + 'serves one site per repository, so a second one could only ever replace it.\n',
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
 * THE TWO THAT ARE NOT COMMANDS, on the summary and nowhere else.
 *
 * There used to be three, under a heading that said "Anywhere", and only one of
 * them was:
 *
 *   --check-update  gone. It forced the update check that the tool performs on
 *                   its own anyway, and `upgrade` already answers the question
 *                   outright — printing the verdict either way and acting only
 *                   when there is something to act on. A flag carried by every
 *                   command to force something that happens by itself is a
 *                   sentence in five help screens buying nothing.
 *   --version       no longer anywhere: it is its own whole command, and
 *                   `build --version` was a way of asking that never made sense.
 *   -h, --help      genuinely anywhere, and the only one that ever was.
 *
 * So no heading. Two lines beginning with dashes are not going to be mistaken
 * for commands, and a heading that has to be qualified is worse than none.
 */
const GLOBALS = `  --version   version, engine and copyright — on its own
  -h, --help  this, or one command's: prolog-notebook build --help
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

${GLOBALS}`;

/**
 * JUST THE COMMAND ASKED ABOUT (869erqra0).
 *
 * The Captain, on being shown all five for `build --help`: "not really. If I run
 * prolog-notebook cmd --help I want only help on that cmd." Printing everything
 * makes the reader find their command again in a page they did not ask for.
 *
 * NOTHING GLOBAL DOWN HERE ANY MORE. It used to end with the three that worked
 * anywhere; two of those are gone, and the survivor is `--help` — which the
 * reader has just used, on a screen that exists because they used it. Telling
 * them it is available is the one piece of help nobody in this position needs.
 */
function helpFor(name) {
  const { note } = COMMANDS[name];
  // The block that used to sit here was also, incidentally, what ended the screen
  // with a newline and held the note off the last option. Its going is not a
  // reason for the page to run into the prompt.
  return `${commandHelp(name)}\n${note ? `\n${note}` : ''}`;
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
async function upgradeFirst({ quiet = false } = {}) {
  // A terminal is needed to OFFER an upgrade, and there is no longer a flag that
  // forces the question: `upgrade` is the way to ask outright, and it answers
  // either way rather than going quiet on a pipe.
  if (!canAsk() || quiet) return null;
  const ahead = await updateNotice({ version: VERSION })
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
    // ON ITS OWN, OR NOT AT ALL. `--version` asks what this installation is; it
    // is not a way of running a command, and `build chapter.md --version` was a
    // sentence with two verbs in it. Refusing says which of the two was meant far
    // better than picking one silently.
    if (args.length > 1) {
      process.stderr.write('--version is a command of its own: prolog-notebook --version\n');
      return 2;
    }
    // No update check here, deliberately: --version and --help are what someone
    // types at an install that is not working, and they stay instant and offline.
    process.stdout.write(await version());
    return 0;
  }

  const command = args.shift();
  if (command === 'view' || command === 'build') return page(command, args);
  if (command === 'clear') return clear(args);
  if (command === 'new') return newChapter(args);
  if (command === 'publish') return publish(args);

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

  const options = {
    limit: DEFAULT_LIMIT, timeout: DEFAULT_TIMEOUT, stdout: false, quiet: false,
  };
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
    } else if (arg === '--timeout') {
      const value = Number(args.shift());
      if (!Number.isInteger(value) || value < 0) {
        process.stderr.write('--timeout takes a whole number of seconds, or 0 to wait\n');
        return 2;
      }
      options.timeout = value;
    } else if (arg === '--stdout') options.stdout = true;
    else if (arg === '--quiet') options.quiet = true;
    else if (arg.startsWith('-')) {
      process.stderr.write(unknownOption(arg, 'execute'));
      return 2;
    } else files.push(arg);
  }

  // BARE MEANS THE WHOLE BOOK. This is the gesture for "fill in every answer
  // before I publish", which is what a chapter published with no answers needs
  // and what 869erqqf0's warning wants to be able to point at. It is not asked
  // about the way `clear` is: adding answers is additive, and a chapter without
  // them is a chapter that has not been executed yet.
  if (!files.length) {
    const chapters = bookChapters('execute');
    if (chapters === null) return 1;
    files.push(...chapters);
  }

  const jump = await upgradeFirst({ quiet: options.quiet });
  if (jump !== null) return jump;
  // Whatever upgradeFirst has just reported must not be reported again below.
  checked = canAsk() && !options.quiet;

  // STARTED NOW, READ AT THE END. The registry is somebody else's machine on
  // somebody else's network, and none of that should stand between the reader
  // and their answers — so the question is asked while the work happens and the
  // answer is collected once it is done.
  //
  // Not asked at all under --quiet: that means "report only failures", and news
  // about a newer version is not one. Not starting the request is better than
  // starting it and discarding the answer. The other half: nobody to ask, so the
  // question is asked ALONGSIDE the work and reported at the end. A terminal has
  // had its offer already.
  const update = checked || options.quiet
    ? Promise.resolve({ message: null, newer: null })
    : updateNotice({ version: VERSION }).catch(() => ({ message: null, newer: null }));

  // ONE ENGINE FOR THE WHOLE INVOCATION, IN A THREAD WE CAN KILL (869ejgyax).
  // A notebook is a world of its own — one cell is one virtual file, and two
  // chapters may define the same predicate — so the runner resets between files
  // and nothing crosses (869euun4p).
  const runner = new Guarded({ limit: options.limit, seconds: options.timeout });
  let status = 0;

  try {
    for (const file of files) {
      status = Math.max(status, await runFile(file, runner, options));
    }
  } finally {
    await runner.close();
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
/**
 * THE SITE ONTO THE BRANCH A HOST WILL SERVE (869ery8ac).
 *
 * ONE REPOSITORY SERVES ONE SITE, which is the fact the whole shape of this
 * command follows from. GitHub Pages takes one source per repository — a branch,
 * or an Actions workflow — and serves it at https://<user>.github.io/<repo>/.
 * Extra branches full of HTML are just branches; nothing serves them.
 *
 * So there is no operand and no way to name a site. The one at the top of the
 * repository is the only one that can be published, and offering to push another
 * would be offering to REPLACE what the URL already serves — a data-loss-shaped
 * mistake dressed as a convenience. A site built somewhere else with --out is a
 * local artefact: preview it, zip it, send it.
 *
 * IT IS THE MOST OUTWARD-FACING THING THIS TOOL DOES. A push to a public branch
 * is on somebody's CDN before you can change your mind, so it says what it is
 * about to do and waits for a yes.
 */
async function publish(args) {
  const options = { branch: 'gh-pages', remote: 'origin', dryRun: false, yes: false };
  for (const arg of args) {
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--yes' || arg === '-y') options.yes = true;
    else {
      process.stderr.write(unknownOption(arg, 'publish'));
      return 2;
    }
  }

  const repo = await repository(process.cwd());
  if (!repo) {
    // Publishing is pushing. Without a repository there is nowhere to push to,
    // and no amount of arguments would supply one.
    process.stderr.write('publish needs a git repository — this directory is not in one.\n');
    return 2;
  }

  const site = join(repo.root, SITE);
  if (!existsSync(site)) {
    process.stderr.write(`no site to publish: ${shownAs(site)} does not exist.\n`
      // Named rather than implied, because an author who has been building into a
      // nearer site has a site — just not the one that can be served.
      + 'Run `prolog-notebook build <file>` to make one, or `build --root <file>` if you\n'
      + 'have been building into a site somewhere below the top of the repository.\n');
    return 1;
  }

  const pages = pagesIn(site);
  const url = pagesUrl(await remoteUrl(repo.root, options.remote));
  process.stderr.write(`${shownAs(site)} — ${pages.length} notebook`
    + `${pages.length === 1 ? '' : 's'} → ${options.remote} ${options.branch}\n`);

  if (options.dryRun) {
    const would = await pushSite({ ...repo, site, ...options });
    if (!would.ok) {
      process.stderr.write(`${would.why}\n`);
      return 1;
    }
    process.stderr.write(`${would.files} files would be pushed. Nothing was.\n`);
    return 0;
  }

  // A terminal is asked; a pipeline has to have said so outright. Neither is
  // allowed to be assumed from the other — a question nobody can answer is a
  // hang, and a push nobody agreed to is worse.
  if (!options.yes) {
    if (!canAsk()) {
      process.stderr.write('Nobody to ask, and this pushes to a public branch. Pass --yes.\n');
      return 2;
    }
    if (!(await confirm('Publish this site?'))) {
      process.stderr.write('Nothing was pushed.\n');
      return 0;
    }
  }

  const done = await pushSite({ ...repo, site, ...options });
  if (!done.ok) {
    process.stderr.write(`${done.why}\n`);
    return 1;
  }
  process.stderr.write(`Pushed ${done.files} files to ${options.remote} ${options.branch}.\n`);
  if (done.anonymous) {
    // Said, not hidden: a commit attributed to a name the author never chose is
    // a small surprise, and one line removes it.
    process.stderr.write('git has no author identity here, so the commit is by'
      + ` ${NOBODY[0]} <${NOBODY[1]}>. Set user.email to use your own.\n`);
  }
  // OFFERED AS WHERE TO LOOK, NEVER AS A PROMISE: whether anything is served
  // there depends on a setting only a person can see, and saying "your site is
  // live at" when it is not is worse than saying nothing.
  if (url) {
    process.stderr.write(`If Pages is set to serve ${options.branch}, that is ${url}\n`
      + `Settings → Pages → Deploy from a branch → ${options.branch} / (root)\n`);
  }
  return 0;
}

async function clear(args) {
  const options = { stdout: false, quiet: false, yes: false };
  const files = [];
  for (const arg of args) {
    if (arg === '--stdout') options.stdout = true;
    else if (arg === '--quiet') options.quiet = true;
    else if (arg === '--yes') options.yes = true;
    else if (arg.startsWith('-')) {
      process.stderr.write(unknownOption(arg, 'clear'));
      return 2;
    } else files.push(arg);
  }

  // BARE MEANS THE WHOLE BOOK, and this one asks first. Emptying every answer in
  // a book is the most destructive thing the tool does to a file an author
  // wrote, and it is a keystroke away from emptying one chapter.
  if (!files.length) {
    const chapters = bookChapters('clear');
    if (chapters === null) return 1;
    if (!options.stdout && !options.yes) {
      // A terminal is asked; a pipeline has to have said so outright. A question
      // nobody can answer is a hang (869ery8ac).
      if (!canAsk()) {
        process.stderr.write(`Nobody to ask, and this empties ${chapters.length} `
          + `chapter${chapters.length === 1 ? '' : 's'}. Pass --yes.\n`);
        return 2;
      }
      const answer = await confirm(`Take the answers out of all ${chapters.length} `
        + `chapter${chapters.length === 1 ? '' : 's'}?`);
      if (!answer) {
        process.stderr.write('Nothing was changed.\n');
        return 0;
      }
    }
    files.push(...chapters);
  }

  // THE SAME DOOR AS EVERY OTHER COMMAND THAT DOES REAL WORK (869erqra0). 0.5.1
  // put `view` and `build` through it and this command shipped afterwards, so it
  // never looked. Emptying somebody's notebook is as real as work gets here, and
  // before the work is the only point at which a newer version changes anything.
  const jump = await upgradeFirst({ quiet: options.quiet });
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
async function page(command, args) {
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
    else if (arg === '--root') options.root = true;
    else if (arg === '--port') {
      options.port = Number(args.shift());
      if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535) {
        process.stderr.write('--port takes a port number\n');
        return 2;
      }
    } else if (arg === '--no-open') options.open = false;
    else if (arg === '--built') options.built = true;
    else if (arg.startsWith('-')) {
      process.stderr.write(unknownOption(arg, command));
      return 2;
    } else files.push(arg);
  }

  // The same offer the execute path makes, and for the same reason: a server about to
  // start, or a directory about to be written, is work that a newer version
  // should be doing.
  const jump = await upgradeFirst();
  if (jump !== null) return jump;

  if (command === 'build') return buildSite(files, options);

  const showing = await viewing(files, options);
  if (typeof showing === 'number') return showing;

  const server = await serve(showing.pages, { port: options.port });
  // THE URL IS THIS COMMAND'S OUTPUT. `view` writes no notebook and no data to
  // stdout, so there is nothing for it to corrupt — and a URL on stderr is a URL
  // a wrapper does not see, which is how somebody came to type localhost by hand
  // and land on another server entirely (869ernmvh).
  process.stdout.write(`${server.url}\n`);
  if (server.port !== options.port) {
    process.stderr.write(`${options.port} was already answering — using ${server.port} instead.\n`);
  }
  const at = `${server.url}${showing.open}`;
  process.stderr.write(`${showing.what} is at ${at} — Ctrl-C to stop.\n`);
  if (options.open) openInBrowser(at);
  // Deliberately never resolves: the server is the command.
  return new Promise(() => {});
}

/**
 * A chapter that already has its shape (869edp5ej).
 *
 * Small, and worth more than it looks. At ten chapters the difference between
 * "every chapter is laid out the same way" and "every chapter was laid out by
 * hand" is the difference between a book and a pile of files — and the first
 * thing anybody does otherwise is copy an old chapter and delete its contents,
 * which carries its ids and its front matter along too.
 *
 * IT BINDS WHAT IT MAKES. A chapter nobody has put in the book is a file, and
 * before the spine existed there was nowhere to put it — which is why this
 * waited for 869eu5tg1 rather than shipping as a lone file-writer.
 */
async function newChapter(args) {
  const options = { title: null };
  const files = [];
  while (args.length) {
    const arg = args.shift();
    if (arg === '--title') options.title = args.shift();
    else if (arg.startsWith('-')) {
      process.stderr.write(unknownOption(arg, 'new'));
      return 2;
    } else files.push(arg);
  }
  if (!files.length) {
    process.stderr.write('new needs a name for the chapter: prolog-notebook new <file>\n');
    return 2;
  }
  if (options.title !== null && files.length > 1) {
    // One title cannot be the heading of three chapters, and silently giving it
    // to the first would be a flag read and thrown away (869erqra0).
    process.stderr.write('--title names one chapter. Make them one at a time.\n');
    return 2;
  }

  const made = [];
  for (const name of files) {
    const file = name.endsWith('.md') ? name : `${name}.prolog.md`;
    // NEVER OVER A FILE THAT EXISTS. This writes prose somebody may have spent a
    // week on, and there is no undo outside git.
    if (existsSync(file)) {
      process.stderr.write(`${file} already exists — nothing written\n`);
      return 1;
    }
    mkdirSync(dirname(resolve(file)), { recursive: true });
    writeFileSync(file, chapterSkeleton(options.title ?? titleFromName(file)));
    made.push(file);
    process.stderr.write(`created ${file}\n`);
  }

  // Into the book, if there is one. No spine is not an error: `build` writes the
  // first one, and a chapter can exist before a site does.
  const spineFile = findSpine(made[0]);
  if (spineFile) {
    for (const file of made) {
      const entry = bind(spineFile, file);
      if (entry) process.stderr.write(`added ${entry} to ${shownAs(spineFile)}\n`);
    }
  }
  process.stderr.write(`Write it, then \`prolog-notebook view ${made[0]}\` to read it back.\n`);
  return 0;
}

/** A chapter's heading, from what the author called the file. */
function titleFromName(file) {
  const name = basename(file).replace(/\.prolog\.md$/, '').replace(/\.md$/, '')
    .replace(/[-_]+/g, ' ').trim();
  return name ? name[0].toUpperCase() + name.slice(1) : 'A Prolog notebook';
}

/**
 * The starting shape of a chapter.
 *
 * SMALL ON PURPOSE. It has to teach the format by being it — front matter, a
 * heading, a program cell, a query cell with an id — without being a page of
 * scaffolding to delete. Everything here is what the parser requires or what a
 * chapter cannot be without; the handbook is where the rest is explained, and
 * the command says so rather than writing it into the file.
 */
function chapterSkeleton(title) {
  return `---
format: prolog-notebook/1
---

# ${title}

What a reader will be able to do by the end of this chapter.

\`\`\`prolog program id="p-1"
% The facts and rules the queries below run against.
\`\`\`

\`\`\`prolog query id="q-1"
true
\`\`\`
`;
}

/**
 * The book onto the site (869eu5tg1, 869eu5tn7).
 *
 * BARE MEANS THE WHOLE BOOK, NAMED MEANS THOSE CHAPTERS — the same rule every
 * other command follows. The spine says what the site contains and in what
 * order, so a full build is a thing that can exist at all: before it, the only
 * record of the set was the site itself, and a fresh clone could rebuild nothing
 * but whatever chapter its author happened to name.
 *
 * Measured at 55 ms a chapter once the engine is in place, which is why the full
 * build is the default gesture rather than an occasional chore.
 */
async function buildSite(files, options) {
  const where = await destination(files, options);
  if (typeof where === 'number') return where;
  const { site, existed, book, spineFile, created, added } = where;

  // WHAT WROTE THIS SITE, AND WHAT IS WRITING NOW (869erqwkp). A site has exactly
  // one runtime, so this decides whether the shared files are already the right
  // ones, need replacing, or are newer than us.
  const state = reconcile(site);
  if (state.verdict === 'older') {
    process.stderr.write(`${shownAs(site)} was built by prolog-notebook `
      + `${state.have.runtime ?? '?'} with engine ${state.have.engine ?? '?'};`
      + ` you are running ${state.ours.runtime} with ${state.ours.engine}.\n`
      // Overwriting would downgrade every page in the site, none of which the
      // author named. Refusing is the only move that breaks nothing.
      + 'Run `prolog-notebook upgrade`, or build somewhere else with --out.\n');
    return 1;
  }
  const writeShared = state.verdict !== 'same';

  // THE RUNTIME MOVED WITHOUT THE VERSION MOVING (869etggpr) — somebody is
  // developing the runtime itself, which is the one case where the site's version
  // has stopped being evidence of anything. Every page is generated by that same
  // code, so they all come with it.
  const moved = state.verdict === 'same' && runtimeStale(site);

  // EVERY OTHER PAGE COMES WITH US when the runtime has moved: a page generated
  // by an older tool imports symbols from a lib/ that has just moved under it, so
  // leaving it alone is not the cautious option, it is the one that breaks it.
  // With a book that is simply a full build, from the author's own sources rather
  // than from the copies in the site.
  const whole = files.length === 0 || state.verdict === 'newer' || moved;
  const wanted = new Set(files.map((f) => resolve(f)));
  const only = whole ? null : wanted;

  let assembled;
  try {
    assembled = book
      ? siteFiles(book, { only })
      : looseFiles(files, site);
  } catch (e) {
    process.stderr.write(`${e.message}\n`);
    return 1;
  }

  let shared = 0;
  for (const [name, entry] of assembled) {
    if (isShared(name)) {
      // The engine is keyed by version — 6.2 MB is not worth comparing to answer
      // a question the version answers. Everything else is keyed by its bytes.
      if (isEngine(name) ? !writeShared : unchanged(join(site, name), entry)) continue;
      shared += 1;
    }
    const target = join(site, name);
    mkdirSync(dirname(target), { recursive: true });
    if (entry.text !== undefined) writeFileSync(target, entry.text);
    else copyFileSync(entry.copy, target);
  }

  // WITHOUT A BOOK THE INDEX STILL COMES FROM THE DIRECTORY, alphabetically, as
  // it has since 0.7 — which is what keeps a project that has never had a spine
  // building exactly as it did.
  if (!book) {
    writeFileSync(join(site, 'index.html'),
      indexHtml({ blocks: blocksFromDirectory(pagesIn(site)) }));
  }

  // A CHAPTER TAKEN OUT OF THE BOOK LEAVES THE SITE, and only on a full build: an
  // author who named one chapter has not asked about the others.
  const dropped = book && files.length === 0 ? prune(site, book) : [];

  // WHICH PAGES THE AUTHOR ASKED FOR, as against which came along: "2 pages
  // regenerated" is about the ones they did not name, and counting their own
  // chapter among them makes the number say nothing.
  const mine = book
    ? new Set(chaptersOf(book).filter((c) => wanted.has(c.source)).map((c) => c.url))
    : new Set(files.map((f) => `${pageName(f)}/`));

  announce({
    site, existed, created, added, spineFile, book, state, dropped, shared, assembled, mine,
    moved, named: files.length > 0, pages: pagesBuilt(assembled),
  });
  return 0;
}

/**
 * Where the site is, which book it belongs to, and the spine written on the way.
 *
 * @returns {number|object} an exit code when it refuses, otherwise the answer
 */
async function destination(files, options) {
  if (options.out && options.root) {
    // Both name a destination, and one of them would have to be ignored. A flag
    // read and thrown away looks like it worked (869erqra0).
    process.stderr.write('--root and --out both say where to write. Pick one.\n');
    return 2;
  }

  const from = files[0] ?? join(process.cwd(), SPINE);
  let spineFile = findSpine(from);
  // A DEFAULT AND TWO OVERRIDES (869etpd4c): the walk is the answer almost
  // always, --root reaches past a nearer site to the project's, --out says where.
  const site = options.out ? resolve(options.out)
    : options.root ? projectSite(spineFile ?? from)
      : findSite(spineFile ?? from);
  const existed = existsSync(site);

  if (!spineFile && files.length === 0) {
    process.stderr.write(noBook('build'));
    return 1;
  }

  let created = null;
  const added = [];
  if (files.length > 0 && !spineFile && !options.out) {
    const first = readNotebook(files[0]);
    if (first === null) return 1;
    // WRITTEN FOR THE AUTHOR, NOT LEFT AS A CHORE — but never into somewhere they
    // only named in passing. `--out` is a one-off build to a directory of its
    // own, and a tracked file at its parent is not what was asked for.
    spineFile = join(dirname(site), SPINE);
    writeFileSync(spineFile, seedSpine({
      // NAMED FOR THE PROJECT, NOT FOR ITS FIRST CHAPTER. A book called "Where
      // does the fence go?" because that happened to be built first is a worse
      // guess than the directory the author already named themselves.
      title: projectName(dirname(spineFile)),
      entries: [{ title: titleOf(first.notebook), target: relative(dirname(spineFile), files[0]) }],
    }));
    created = spineFile;
  }

  let book = spineFile === null ? null : readBook(spineFile);
  if (book === false) return 1;

  // A CHAPTER THE BOOK DOES NOT ALREADY HOLD, ANYWHERE IN IT, is added to the
  // spine. "Anywhere" is load-bearing: a chapter bound through a SUB-BOOK is
  // already in this book, and appending it again would publish it twice — once
  // where its book puts it and once at the top, from one build the author
  // thought was about one chapter.
  if (book) {
    for (const file of files) {
      if (chaptersOf(book).some((c) => c.source === resolve(file))) continue;
      const entry = bind(spineFile, file);
      if (entry) added.push(entry);
    }
    if (added.length) {
      book = readBook(spineFile);
      if (book === false) return 1;
    }
    // A chapter nobody bound — --out sent it somewhere of its own.
    const bound = new Set(chaptersOf(book).map((c) => c.source));
    if (files.some((f) => !bound.has(resolve(f)))) book = null;
  }
  return { site, existed, book, spineFile, created, added };
}

/**
 * Pages for chapters that belong to no book.
 *
 * THE 0.8 SHAPE, KEPT WHOLE: one directory per chapter named after its file, no
 * navigation, and an index built from the directory. A chapter with no book has
 * nothing to be a breadcrumb of, and a project that has never had a spine should
 * not acquire one by being built.
 */
function looseFiles(files, site) {
  const assembled = new Map();
  for (const [name, entry] of sharedFiles()) assembled.set(name, entry);
  for (const file of files) {
    const read = readNotebook(file);
    if (read === null) throw new Error(`could not build ${file}`);
    const page = buildFiles(read.notebook, read.source, {
      filename: basename(file), prefix: '../',
    });
    for (const [name, entry] of page) {
      if (isShared(name)) continue;
      assembled.set(`${pageName(file)}/${name}`, entry);
    }
  }
  return assembled;
}

/** The page directories an assembled site covers, for counting and for skipping. */
function pagesBuilt(assembled) {
  const pages = new Set();
  for (const name of assembled.keys()) {
    if (isShared(name) || !name.includes('/')) continue;
    if (name.endsWith('/index.html')) continue;
    pages.add(name.slice(0, name.lastIndexOf('/') + 1));
  }
  return [...pages];
}

/** What a build says it did. Kept in one place so a full build is not a wall. */
function announce({
  site, existed, created, added, spineFile, book, state, dropped, shared, assembled, mine,
  moved, named, pages,
}) {
  // SAY WHERE IT WENT. This is the one command that writes outside the directory
  // it was pointed at, and doing that in silence is spooky.
  if (!existed) {
    process.stderr.write(`created ${shownAs(site)}/ — you may want it in .gitignore\n`);
  }
  if (created) {
    process.stderr.write(`created ${shownAs(created)} — the contents of your site.`
      + ' Reorder it, rename chapters, group them under headings.\n');
  }
  for (const entry of added) {
    process.stderr.write(`added ${entry} to ${shownAs(spineFile)}\n`);
  }

  // ONE LINE FOR A BOOK, the chapter's own line when a chapter was named: twenty
  // announce lines is a wall, and a full build is meant to be run often.
  if (!named || pages.length > 1) {
    process.stderr.write(`${pages.length} chapter${pages.length === 1 ? '' : 's'} → `
      + `${shownAs(site)}/`
      + `${shared ? ` (${shared} shared file${shared === 1 ? '' : 's'})` : ''}\n`);
  } else {
    // The chapter's own files, not the site's: a contents page regenerated
    // alongside is not part of how big this chapter is.
    const own = [...assembled.keys()].filter((n) => n.startsWith(pages[0] ?? '\u0000')).length;
    process.stderr.write(`${own} files → ${shownAs(join(site, pages[0] ?? ''))}/`
      + (shared ? ` (${shared} shared with the site)\n` : ' (runtime and engine already'
        + ' there)\n'));
  }
  if (dropped.length) {
    process.stderr.write(`${dropped.length} page${dropped.length === 1 ? '' : 's'} no longer in `
      + `the book removed: ${dropped.join(', ')}\n`);
  }

  // SAID OUT LOUD, or the person it is for reads "already there" and believes it.
  if (moved) {
    process.stderr.write(`runtime ${state.ours.runtime} rewritten — its files had changed`
      + ` without the version moving · ${pages.length} page${pages.length === 1 ? '' : 's'}`
      + ' rebuilt\n');
  }
  // SAID OUT LOUD, because a build aimed at one file has just rewritten others.
  if (state.verdict === 'newer' && state.runtimeMoved) {
    const came = pages.filter((url) => !mine.has(url)).length;
    process.stderr.write(`runtime ${state.have.runtime ?? 'unknown'} → ${state.ours.runtime}`
      + ` · ${came} page${came === 1 ? '' : 's'} regenerated\n`);
  }
  if (state.verdict === 'newer' && state.engineMoved) {
    // What regeneration cannot fix: the pages' code is current, their saved
    // answers came out of the old engine and still live in the author's file.
    process.stderr.write(`engine ${state.have.engine ?? 'unknown'} → ${state.ours.engine}`
      + ' · re-run `execute` on your chapters\n');
  }
  const listed = book ? chaptersOf(book).length : pagesIn(site).length;
  process.stderr.write(`${shownAs(join(site, 'index.html'))} lists `
    + `${listed} notebook${listed === 1 ? '' : 's'}\n`);
  // SAID HERE BECAUSE THIS IS WHERE IT IS ACTED ON. The obvious next move is to
  // double-click index.html, and that is the one thing that cannot work: browsers
  // refuse ES modules over file:// and the engine cannot be fetched there either
  // (869erqq1u).
  process.stderr.write(`Host ${shownAs(site)} over HTTP — opening it from disk`
    + ' will not run.\n');
}

/**
 * What `view` is about to show, and where to open the browser.
 *
 * THE WHOLE BOOK WHENEVER THERE IS ONE, with the operand choosing where a reader
 * lands rather than what the server holds. That is a revision of what this
 * ticket first said — serving only the named chapters, "the same machinery with
 * fewer entries" — and it was wrong: a filtered book still renders a contents
 * page and prev/next cards pointing at chapters the server would then 404. A
 * preview riddled with dead links is worse than one that shows everything.
 *
 * So the filter applies to attention, not to what exists. `view lists.prolog.md`
 * opens on that chapter; its neighbours are a click away because they are there.
 *
 * @returns {number|{pages: Function|Map, open: string, what: string}}
 */
async function viewing(files, options) {
  // --built SERVES THE ARTEFACT, as it stands on disk: the rehearsal for the one
  // irreversible command. Everything else here serves your sources as they are
  // this second, which is what an author wants while writing.
  if (options.built) {
    const site = findSite(files[0] ?? join(process.cwd(), SPINE));
    if (!existsSync(join(site, 'index.html'))) {
      process.stderr.write(`Nothing built yet at ${shownAs(site)} — run \`build\` first.\n`);
      return 1;
    }
    return { pages: siteOnDisk(site), open: '', what: shownAs(site) };
  }

  const spineFile = findSpine(files[0] ?? join(process.cwd(), SPINE));
  let book = null;
  if (spineFile) {
    try {
      book = resolveSpine(spineFile);
    } catch (e) {
      process.stderr.write(`${e.message}\n`);
      return 1;
    }
  }
  const bound = book ? chaptersOf(book) : [];
  const named = files.map((f) => resolve(f));
  const mine = bound.filter((c) => named.includes(c.source));

  if (book && (files.length === 0 || mine.length === named.length)) {
    // An index of one item is a pointless click, so a single named chapter opens
    // on itself; anything else opens on the contents.
    const open = files.length === 1 ? mine[0].url : '';
    const pages = liveSite(() => resolveSpine(spineFile), {
      onError: (e) => process.stderr.write(`${e.message}\n`),
    });
    try {
      pages();
    } catch (e) {
      process.stderr.write(`${e.message}\n`);
      return 1;
    }
    return { pages, open, what: files.length === 1 ? basename(files[0]) : (book.title ?? 'the book') };
  }

  // NO BOOK, OR A CHAPTER THAT IS NOT IN IT — a loose notebook, which is still
  // the whole workflow for somebody with one file. Served alone at the root,
  // exactly as it has been since 0.5.
  if (files.length !== 1) {
    process.stderr.write(files.length === 0
      ? noBook('view')
      : 'view takes one notebook, or none for the whole book\n');
    return files.length === 0 ? 1 : 2;
  }
  const file = files[0];
  // ASKED AGAIN ON EVERY REQUEST, and built again only when the bytes have moved
  // (869erpuhk): a reload is the universal gesture for "show me what I just
  // did", and it used to confirm the version from start-up.
  const pages = livePages(() => readFileSync(file, 'utf8'), {
    filename: basename(file),
    prefix: './',
    onError: (e) => process.stderr.write(`${file}: ${e.message}\n`),
  });
  try {
    pages();
  } catch (e) {
    process.stderr.write(`${file}: ${e.message}\n`);
    return 1;
  }
  return { pages, open: '', what: basename(file) };
}

/**
 * A built site as a set of names this process knows about.
 *
 * READ ONCE, INTO A MAP, rather than serving the directory. serve.js answers for
 * a fixed set of names it generated and 404s everything else — "it is not a
 * static file server and must not become one" — and --built is showing an
 * artefact as it stands, so a snapshot is also the honest thing to show.
 */
function siteOnDisk(site, at = '') {
  const files = new Map();
  for (const name of readdirSync(join(site, at))) {
    const full = join(site, at, name);
    if (statSync(full).isDirectory()) {
      for (const [k, v] of siteOnDisk(site, `${at}${name}/`)) files.set(k, v);
    } else files.set(`${at}${name}`, { copy: pathToFileURL(full) });
  }
  return files;
}

/**
 * Every chapter of the book you are standing in — the bare form of a command.
 *
 * THE OPERAND IS A FILTER: name files and a command acts on those, name none and
 * it acts on the whole book. This is the "none" (869eu5tn7).
 *
 * Deduplicated, because a chapter bound into two books is two PAGES but one
 * FILE, and `execute` writes to files.
 *
 * @returns {string[]|null} null when it has already said why it cannot
 */
function bookChapters(command) {
  const spineFile = findSpine(join(process.cwd(), SPINE));
  if (!spineFile) {
    process.stderr.write(noBook(command));
    return null;
  }
  try {
    return [...new Set(chaptersOf(resolveSpine(spineFile)).map((c) => c.source))];
  } catch (e) {
    process.stderr.write(`${e.message}\n`);
    return null;
  }
}

/** The one thing to say when a command that acts on a book cannot find one. */
function noBook(command) {
  return `No book here — ${SPINE} is what says which chapters a site holds.\n`
    + 'Build a chapter by name and one will be written for you:'
    + ' prolog-notebook build <file>\n'
    + (command === 'build' ? ''
      : `Then \`prolog-notebook ${command}\` with no arguments acts on all of them.\n`);
}

/** A first guess at what a book is called: the project's own directory. */
function projectName(dir) {
  const name = basename(resolve(dir)).replace(/[-_]+/g, ' ').trim();
  return name ? name[0].toUpperCase() + name.slice(1) : 'Prolog notebooks';
}

/** Read and parse a chapter, reporting it the way every other command does. */
function readNotebook(file) {
  try {
    const source = readFileSync(file, 'utf8');
    return { source, notebook: parse(source) };
  } catch (e) {
    process.stderr.write(`${file}: ${e.message}\n`);
    return null;
  }
}

/**
 * Put chapters the book does not name into it, and say so.
 *
 * APPENDED, NEVER SORTED IN. The order in that file is the author's opinion and
 * a tool that rearranges it is one they stop trusting with it.
 */
function bind(spineFile, file) {
  const read = readNotebook(file);
  if (read === null) return null;
  const target = relative(dirname(spineFile), resolve(file)).split(sep).join('/');
  writeFileSync(spineFile,
    withEntry(readFileSync(spineFile, 'utf8'), { title: titleOf(read.notebook), target }));
  return target;
}

/** The book, or false once it has said why it could not be read. */
function readBook(spineFile) {
  try {
    return resolveSpine(spineFile);
  } catch (e) {
    process.stderr.write(`${e.message}\n`);
    return false;
  }
}

/**
 * Page directories the site holds, at any depth, as site-relative URLs.
 *
 * A PAGE IS A DIRECTORY WITH AN app.js IN IT — ours, unmistakably, and written
 * by nothing else. pagesIn() asks a looser question (does it have an index.html)
 * because it is deciding what to list; this one decides what may be deleted, and
 * the site is somebody's directory that may hold things we did not put there.
 */
function builtPages(site, at = '') {
  if (!existsSync(join(site, at))) return [];
  const found = [];
  for (const name of readdirSync(join(site, at))) {
    if (at === '' && isShared(`${name}/`)) continue;
    const dir = join(site, at, name);
    if (!statSync(dir).isDirectory()) continue;
    if (existsSync(join(dir, 'app.js'))) found.push(`${at}${name}/`);
    else found.push(...builtPages(site, `${at}${name}/`));
  }
  return found;
}

/** Pages the book no longer names, removed. Only ever called on a full build. */
function prune(site, book) {
  const keep = new Set(chaptersOf(book).map((c) => c.url));
  const dropped = builtPages(site).filter((url) => !keep.has(url));
  for (const url of dropped) rmSync(join(site, url), { recursive: true, force: true });
  // A book's contents page goes with the last of its chapters; the directory may
  // still hold somebody else's files, so only the page we wrote is removed.
  const books = new Set(booksOf(book).map((b) => b.url));
  for (const url of new Set(dropped.map((u) => u.split('/').slice(0, -2).join('/')))) {
    const dir = url === '' ? '' : `${url}/`;
    if (books.has(dir) || dir === '') continue;
    rmSync(join(site, dir, 'index.html'), { force: true });
  }
  return dropped.map((u) => u.replace(/\/$/, ''));
}

async function runFile(file, runner, options) {
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

  const { edits, failures, warnings, hung } = await runner.run(source, (event) => {
    {
      if (options.quiet || event.kind === 'begin') return;
      if (event.kind === 'program') {
        process.stderr.write(`  ${event.ok ? '✓' : '✗'} ${event.id}\n`);
        return;
      }
      const answers = event.error
        ? `error: ${event.error}`
        : `${event.solutions.length} solution${event.solutions.length === 1 ? '' : 's'}`
          + (event.truncated ? ` (stopped at ${options.limit}, not exhausted)` : '');
      process.stderr.write(`  ${event.error ? '✗' : '✓'} ${event.id} — ${answers}\n`);
    }
  });

  for (const warning of warnings) process.stderr.write(`  ! ${warning.id}: ${warning.text}\n`);

  // A GOAL THAT NEVER CAME BACK. Nothing is written, for the same reason a failed
  // program cell writes nothing: the answers that DID arrive are fine, but the
  // cell that hung would keep whatever stale answer it already had, and a file
  // that is part fresh and part stale is worse than one that was not touched.
  if (hung) {
    process.stderr.write(`${file}: ${hung.id} did not finish within ${options.timeout}s`
      + `${hung.goal ? ` — ?- ${hung.goal}` : ''}\n`);
    process.stderr.write(`${name}: not written. Fix the goal, or raise --timeout.\n`);
    return 1;
  }

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
