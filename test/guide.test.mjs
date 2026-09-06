import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { GUIDE, guideText, literal } from '../src/guide.js';

const CLI = new URL('../bin/prolog-notebook.mjs', import.meta.url).pathname;
const MAN = new URL('../man/prolog-notebook.1', import.meta.url);
const PACKAGE = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const exec = promisify(execFile);
const run = (args) => exec('node', [CLI, ...args], { env: { NO_UPDATE_NOTIFIER: '1', ...process.env } });

// THE THIRD TIER OF HELP (869ewp4xd). The Captain, after the operand row shipped:
// "whole book doesnt mean anything - 'project/repo level notebook' - ... maybe we
// want something similar to a man page - available using a command switch or
// arg?" Both, in the end — and both from one source, because a tour and a manual
// that can disagree eventually do.

test('the tour is a command, and the bare screen offers it first', async () => {
  const { stdout } = await run([]);
  // FIRST, not last. A reader on this screen who does not yet know what a book is
  // has their next move on the line their eye starts at.
  const commands = stdout.split('\n').filter((line) => /^ {2}[a-z]+ {2,}/.test(line));
  assert.match(commands[0], /^ {2}guide /);
  assert.match(commands[0], /the tour/);

  const { stdout: tour } = await run(['guide']);
  for (const { title } of GUIDE) {
    assert.ok(tour.includes(title.toUpperCase()), `${title} must be in the tour`);
  }
  // The two facts a reader cannot guess, which is why this screen exists.
  assert.match(tour, /name none and it acts on the whole book/);
  assert.match(tour, /\.gitignore/);
  // And the way back to the detail it deliberately leaves out.
  assert.match(tour, /prolog-notebook --help/);
  assert.doesNotMatch(tour, /--timeout/);
});

test('the pager is for a terminal, and this is not one', async () => {
  // A pager started against a pipe is a hang, which is the same rule the
  // confirmations follow. Under `node --test` there is no tty, so the plain text
  // is what must arrive — and --no-pager must not change it for anyone else.
  const { stdout } = await run(['guide']);
  assert.equal(stdout, guideText());
  assert.equal((await run(['guide', '--no-pager'])).stdout, stdout);

  // An option that belongs to another command says where it lives, as everywhere.
  await assert.rejects(run(['guide', '--port', '9']), (e) => {
    assert.equal(e.code, 2);
    assert.match(e.stderr, /--port/);
    return true;
  });
});

test('the man page is generated, shipped, and never behind the tool', async () => {
  // COMMITTED, BECAUSE npm's `man` FIELD POINTS AT A FILE IN THE TARBALL. So the
  // copy in the repository is the one readers get, and the only defence against
  // it going stale is this test: regenerate, compare, fail.
  const { stdout: generated } = await run(['guide', '--roff']);
  assert.equal(readFileSync(MAN, 'utf8'), generated,
    'man/prolog-notebook.1 is out of date — run `npm run man`');
  assert.equal(PACKAGE.man, './man/prolog-notebook.1');
  assert.ok(PACKAGE.files.includes('man'), 'the man page has to be in the package');
  assert.match(generated, new RegExp(`prolog\\\\-notebook ${PACKAGE.version}`));

  // DERIVED FROM THE SAME TABLE THE HELP READS, so a flag added to a command
  // turns up in the manual without anybody remembering the manual. That is the
  // whole reason it is generated rather than written.
  const { stdout: usage } = await run([]);
  const commands = usage.split('\n').flatMap((l) => /^ {2}([a-z]+) {2,}/.exec(l)?.[1] ?? []);
  let flags = 0;
  for (const name of commands) {
    assert.ok(generated.includes(`.B ${name}`), `${name} must be in the man page`);
    const { stdout: help } = await run([name, '--help']);
    for (const flag of help.match(/^ {4}--[a-z-]+/gm) ?? []) {
      assert.ok(generated.includes(flag.trim().replace(/-/g, '\\-')),
        `${flag.trim()} must be in the man page`);
      flags += 1;
    }
  }
  assert.equal(commands.length, 8);
  assert.ok(flags >= 12, `only ${flags} flags were checked`);

  // ESCAPED FOR ROFF, where a bare hyphen is a typographic one that may be broken
  // across a line — wrong for `--built`, and wrong for a filename. Every line but
  // the requests roff reads as commands.
  for (const line of generated.split('\n').filter((l) => !l.startsWith('.'))) {
    assert.doesNotMatch(line, /(?<!\\)-/, `unescaped hyphen: ${line}`);
  }
});

test('the tour keeps its own shape', () => {
  // A line indented by two spaces is laid out as typed and everything else is
  // prose; the renderers both key off that, and a section that breaks it renders
  // as neither. This is the only rule the format has.
  for (const { title, lines } of GUIDE) {
    for (const line of lines) {
      assert.ok(line === '' || literal(line) || !line.startsWith(' '),
        `${title}: "${line}" is indented but not by two`);
      assert.ok(line.length <= 76, `${title}: "${line}" is too wide for a terminal`);
    }
  }
});
