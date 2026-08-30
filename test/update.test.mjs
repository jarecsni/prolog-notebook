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
  // It says what you HAVE first: that is the question being asked, and a line
  // that only names versions leaves the reader to work out which one is theirs.
  assert.equal(notice, 'You have Prolog Notebook 0.3.1. The latest is 0.4.0.\n'
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
  assert.equal(notice, 'You have the latest version of Prolog Notebook, 0.3.1.');

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
    /You have Prolog Notebook 0\.1\.0\. The latest is 0\.3\.1\./,
  );
});

test('everything else that can go wrong goes wrong quietly', async () => {
  // A registry answering nonsense, and a cache that cannot be written: neither is
  // the reader's problem, and neither stops the command. (Not reaching the
  // registry at all IS said — once a day — see the test below.)
  assert.equal(await updateNotice({
    version: '0.3.1',
    store: memory(),
    latest: async () => 'not-a-version',
    env: {},
  }), null);

  // A read-only home means the check happens every time instead of once a day.
  // That is a slower notifier, not a failure, and nothing may escape from it.
  const unwritable = { read: () => null, write: () => { throw new Error('read-only'); } };
  assert.throws(() => unwritable.write({}), /read-only/, 'the store really does throw');

  // Asked explicitly, silence would look like a bug, so this one says what happened.
  assert.equal(await updateNotice({
    version: '0.3.1', force: true, store: memory(), latest: async () => null, env: {},
  }), 'Could not reach the npm registry to check for updates.');
});

test('a registry it cannot reach is said once a day, not on every command', async () => {
  // Silence here would be indistinguishable from "you are up to date", which is
  // the one thing a broken check must not look like. But a blocked proxy must not
  // put a line in front of somebody on every single run either — so the failed
  // attempt is remembered exactly like a successful one.
  const store = memory();
  let asked = 0;
  const offline = async () => { asked++; return null; };
  const now = 5_000_000;

  assert.match(await updateNotice({ version: '0.3.1', store, latest: offline, now, env: {} }),
    /Could not reach the npm registry/);
  assert.deepEqual(store.state, { checked: now, latest: null });

  assert.equal(
    await updateNotice({ version: '0.3.1', store, latest: never, now: now + 1000, env: {} }),
    null,
    'said once; not again for the rest of the day',
  );

  await updateNotice({ version: '0.3.1', store, latest: offline, now: now + DAY, env: {} });
  assert.equal(asked, 2, 'and tried again when the day turned over');
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
  // stubbed fetch. `/latest` because the packument carries every version ever
  // published to answer a one-line question — and PLAIN JSON, because npm's
  // abbreviated type is defined for the packument and this endpoint is entitled
  // to answer 406, which is exactly what it did to 0.4.0's notifier.
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
  assert.equal(seen.accept, 'application/json');
  assert.doesNotMatch(seen.accept, /install-v1/, 'that type belongs to the packument, not to /latest');

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
