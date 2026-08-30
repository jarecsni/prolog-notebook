import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { confirm, describeInstall, globalRoot, install, relaunch, upgradePlan } from '../src/upgrade.js';

// Updating itself is mostly a question of knowing how it was installed, and the
// wrong answer breaks somebody's project while trying to help. So the global case
// is PROVED and everything else is refused with the right command (869erkqpc).

test('it knows a global install from a project dependency from a checkout', () => {
  const global = '/usr/local/lib/node_modules';
  assert.equal(describeInstall({
    packageRoot: `${global}/prolog-notebook/`, globalRoot: global,
  }), 'global');

  // Somebody's project depends on this. Upgrading it globally would leave that
  // project on the version it pinned and change a tool they did not ask about.
  assert.equal(describeInstall({
    packageRoot: '/home/j/book/node_modules/prolog-notebook/', globalRoot: global,
  }), 'local');

  // A working copy: git's business, not npm's.
  assert.equal(describeInstall({
    packageRoot: '/home/j/dev/prolog-notebook/', globalRoot: global,
  }), 'source');

  // npm would not say where global packages live, so nothing may be assumed.
  assert.equal(describeInstall({
    packageRoot: '/home/j/book/node_modules/prolog-notebook/', globalRoot: null,
  }), 'local');
});

test('only the global case is ever run; the others are explained', () => {
  assert.deepEqual(upgradePlan('global', '0.4.2'), { argv: ['i', '-g', 'prolog-notebook@0.4.2'] });
  assert.match(upgradePlan('local', '0.4.2').say, /npm i prolog-notebook@0\.4\.2/);
  assert.equal(upgradePlan('local', '0.4.2').argv, undefined, 'nothing is run for a dependency');
  assert.match(upgradePlan('source', '0.4.2').say, /git/);
  assert.equal(upgradePlan('source', '0.4.2').argv, undefined);
});

test('an exact version is installed, not whatever latest means by then', () => {
  // Between the check and the install, `latest` can move. Asking for the version
  // the reader was just told about is the only way the sentence stays true.
  assert.deepEqual(upgradePlan('global', '0.4.2').argv.at(-1), 'prolog-notebook@0.4.2');
});

test('npm not answering is not an answer', async () => {
  assert.equal(await globalRoot(async () => { throw new Error('no npm here'); }), null);
  assert.equal(await globalRoot(async () => ({ stdout: '  /usr/lib/node_modules \n' })),
    '/usr/lib/node_modules');
  assert.equal(await globalRoot(async () => ({ stdout: '' })), null);
});

test('the question defaults to yes, and anything starting with n is no', async () => {
  const ask = async (typed) => {
    const input = new PassThrough();
    const output = new PassThrough();
    const answer = confirm('Update now?', { input, output });
    input.write(`${typed}\n`);
    return answer;
  };
  assert.equal(await ask('y'), true);
  assert.equal(await ask(''), true, 'the default is the thing they asked for');
  assert.equal(await ask('Y'), true);
  assert.equal(await ask('n'), false);
  assert.equal(await ask('No'), false);
});

test('the question is asked on stderr, where it cannot corrupt a notebook', async () => {
  // `execute --stdout` writes a notebook to stdout. A prompt in the middle of it
  // would be part of the file.
  const input = new PassThrough();
  const output = new PassThrough();
  const seen = [];
  output.on('data', (chunk) => seen.push(String(chunk)));
  const answer = confirm('Update now?', { input, output });
  input.write('y\n');
  await answer;
  assert.match(seen.join(''), /Update now\? \[Y\/n\]/);
});

test('npm failing is reported rather than claimed as success', async () => {
  const fake = (code) => () => {
    const child = new PassThrough();
    setImmediate(() => child.emit('close', code));
    return child;
  };
  assert.equal(await install(['i', '-g', 'x'], fake(0)), true);
  assert.equal(await install(['i', '-g', 'x'], fake(1)), false);

  const broken = () => {
    const child = new PassThrough();
    setImmediate(() => child.emit('error', new Error('npm is not installed')));
    return child;
  };
  assert.equal(await install(['i', '-g', 'x'], broken), false);
});

test('it can run the same command again, on whatever is behind that path now', async () => {
  // THE CLAIM THIS FEATURE RESTS ON: after npm replaces the package, the bin the
  // reader typed still points at the same file, so running that path again runs
  // the new bytes. A real child process here, not a stub — stdio inherited, exit
  // code proxied, and the marker set that stops the new one checking again.
  // With `node -e`, argv is [execPath, ...extras] — the script is not in it.
  const script = 'process.exit(Number(process.argv[1]));';
  const code = await relaunch([process.execPath, '-e', script, '7']);
  assert.equal(code, 7, "the child's exit code is the one we leave with");
});

test('the relaunched process is told not to check again', async () => {
  // Without this a failed or partial upgrade re-execs for ever.
  let seen = null;
  await relaunch(['node', 'x'], (cmd, args, opts) => {
    seen = { cmd, args, marker: opts.env.PROLOG_NOTEBOOK_UPGRADED, stdio: opts.stdio };
    const child = new PassThrough();
    setImmediate(() => child.emit('close', 0));
    return child;
  });
  assert.deepEqual([seen.cmd, seen.args], ['node', ['x']]);
  assert.equal(seen.marker, '1');
  assert.equal(seen.stdio, 'inherit', 'it should look like one process, not two');
});

test('a spawn that fails leaves a non-zero code rather than pretending', async () => {
  const broken = () => {
    const child = new PassThrough();
    setImmediate(() => child.emit('error', new Error('no such file')));
    return child;
  };
  assert.equal(await relaunch(['nope'], broken), 1);
});
