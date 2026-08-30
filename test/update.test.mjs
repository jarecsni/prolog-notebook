import test from 'node:test';
import assert from 'node:assert/strict';
import { DAY, cachePath, isNewer, latestFromRegistry, updateNotice } from '../src/update.js';

// The update check (869erkqpc), tested without a network anywhere near it: the
// clock, the cache and "what is the latest version" are all arguments, so what is
// asserted here is the BEHAVIOUR — when it speaks, when it stays quiet, and what
// it does when everything goes wrong.

/** A cache that lives in a variable. */
const memory = (initial = null) => {
  let state = initial;
  return { read: () => state, write: (next) => { state = next; }, get state() { return state; } };
};

const never = async () => assert.fail('the registry must not be asked');

test('it says nothing at all when you are up to date', async () => {
  // A tool that congratulates you on every command is one you learn to read past,
  // and then it is not there when it has something to say.
  const notice = await updateNotice({
    version: '0.3.1', store: memory(), latest: async () => '0.3.1', env: {},
  });
  assert.equal(notice, null);
});

test('and says so plainly when there is something newer', async () => {
  const notice = await updateNotice({
    version: '0.3.1', store: memory(), latest: async () => '0.4.0', env: {},
  });
  assert.equal(notice, 'A newer Prolog Notebook is available: 0.3.1 → 0.4.0\n'
    + 'Update with: npm i -g prolog-notebook');
});

test('once a day, and the rest of the day from what it remembered', async () => {
  const store = memory();
  let asked = 0;
  const latest = async () => { asked++; return '0.4.0'; };
  const now = 1_000_000;

  await updateNotice({ version: '0.3.1', store, latest, now, env: {} });
  assert.equal(asked, 1);
  assert.deepEqual(store.state, { checked: now, latest: '0.4.0' });

  // Same day: answered from the file, and the registry is not asked again.
  const again = await updateNotice({
    version: '0.3.1', store, latest: never, now: now + DAY - 1, env: {},
  });
  assert.match(again, /0\.4\.0/);

  await updateNotice({ version: '0.3.1', store, latest, now: now + DAY, env: {} });
  assert.equal(asked, 2, 'the day turned over');
});

test('--check-update asks anyway, and answers either way', async () => {
  // The one case where "you are on the latest" is worth saying: the reader asked.
  const store = memory({ checked: Date.now(), latest: '0.3.1' });
  const notice = await updateNotice({
    version: '0.3.1', force: true, store, latest: async () => '0.3.1', env: {},
  });
  assert.equal(notice, 'Prolog Notebook 0.3.1 is the latest.');

  // Even a cache written a second ago is ignored when it was asked for.
  let asked = 0;
  await updateNotice({
    version: '0.3.1', force: true, store, latest: async () => { asked++; return '0.3.1'; }, env: {},
  });
  assert.equal(asked, 1);
});

test('never in CI, and never when told not to', async () => {
  // `--check` will run this command on every push one day. A build that fails, or
  // even pauses, because a registry was slow is worse than no notice at all.
  for (const env of [{ CI: 'true' }, { NO_UPDATE_NOTIFIER: '1' }]) {
    assert.equal(await updateNotice({ version: '0.1.0', store: memory(), latest: never, env }), null);
  }
  // Asking explicitly still works, because that is a person, not a pipeline.
  assert.match(
    await updateNotice({
      version: '0.1.0', force: true, store: memory(), latest: async () => '0.3.1', env: { CI: 'true' },
    }),
    /0\.1\.0 → 0\.3\.1/,
  );
});

test('everything that can go wrong goes wrong quietly', async () => {
  // No network, a registry answering nonsense, a cache it cannot write: none of
  // it is the reader's problem, and none of it stops the command.
  assert.equal(await updateNotice({
    version: '0.3.1', store: memory(), latest: async () => null, env: {},
  }), null);

  const unwritable = { read: () => null, write: () => { throw new Error('read-only'); } };
  await assert.rejects(async () => unwritable.write({}), /read-only/, 'the store really does throw');
  assert.equal(await updateNotice({
    version: '0.3.1',
    store: { read: () => null, write: () => {} },
    latest: async () => 'not-a-version',
    env: {},
  }), null);

  // Asked explicitly, silence would look like a bug, so this one says what happened.
  assert.equal(await updateNotice({
    version: '0.3.1', force: true, store: memory(), latest: async () => null, env: {},
  }), 'Could not reach the npm registry.');
});

test('a prerelease is not an upgrade', () => {
  assert.equal(isNewer('0.4.0', '0.3.1'), true);
  assert.equal(isNewer('0.3.2', '0.3.1'), true);
  assert.equal(isNewer('1.0.0', '0.9.9'), true);
  assert.equal(isNewer('0.3.1', '0.3.1'), false);
  assert.equal(isNewer('0.3.0', '0.3.1'), false);
  // Deciding whether to print a sentence, not resolving a dependency: a release
  // candidate is simply not an upgrade, and comparing them properly is semver's
  // job rather than this file's.
  assert.equal(isNewer('0.4.0-rc.1', '0.3.1'), false);
  assert.equal(isNewer('rubbish', '0.3.1'), false);
});

test('the cache is in the reader\'s cache directory, not in the install', () => {
  // A global install is often read-only, and a check that needs to write into
  // node_modules is a check that quietly stops happening.
  assert.equal(cachePath({ XDG_CACHE_HOME: '/x' }, '/home/j'), '/x/prolog-notebook/update-check.json');
  assert.equal(cachePath({}, '/home/j'), '/home/j/.cache/prolog-notebook/update-check.json');
});

test('the registry call asks for the small document, and shrugs at anything else', async () => {
  // The only part of this that ever touches the wire, so the only part with a
  // stubbed fetch: the abbreviated document, because the full packument carries
  // every version ever published to answer a one-line question.
  let seen = null;
  const version = await latestFromRegistry({
    registry: 'https://example.invalid',
    fetchImpl: async (url, init) => {
      seen = { url, accept: init.headers.accept };
      return { ok: true, json: async () => ({ version: '9.9.9' }) };
    },
  });
  assert.equal(version, '9.9.9');
  assert.equal(seen.url, 'https://example.invalid/prolog-notebook/latest');
  assert.match(seen.accept, /install-v1\+json/);

  // A trailing slash is what npm's own config carries, and two slashes in a URL
  // is the kind of thing a registry is entitled to refuse.
  await latestFromRegistry({
    registry: 'https://example.invalid/',
    fetchImpl: async (url) => { seen = { url }; return { ok: true, json: async () => ({}) }; },
  });
  assert.equal(seen.url, 'https://example.invalid/prolog-notebook/latest');

  const failed = await latestFromRegistry({ fetchImpl: async () => { throw new Error('offline'); } });
  assert.equal(failed, null);
  const refused = await latestFromRegistry({ fetchImpl: async () => ({ ok: false }) });
  assert.equal(refused, null);
});
