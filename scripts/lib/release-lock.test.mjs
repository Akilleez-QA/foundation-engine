import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {acquireReleaseLock, staleReason, UNOWNED_GRACE_MS} from './release-lock.mjs';

const withDir = fn => {
  const dir = mkdtempSync(join(tmpdir(), 'engine-lock-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
};

test('one holder at a time; the holder releases; a repeat or stale release never frees a successor', () =>
  withDir(dir => {
    const lock = join(dir, 'release.lock');
    const release = acquireReleaseLock(lock, {log: () => {}});
    assert.throws(() => acquireReleaseLock(lock, {log: () => {}}), /Another production release holds/);
    release();
    assert.ok(!existsSync(lock));
    const second = acquireReleaseLock(lock, {log: () => {}});
    release();
    assert.ok(existsSync(lock), 'the first release function cannot remove the second lock');
    second();
  }));

test('a lock whose owner process is gone on this host is reclaimed; a live or foreign owner is respected', () =>
  withDir(dir => {
    const lock = join(dir, 'release.lock');
    mkdirSync(lock);
    writeFileSync(join(lock, 'owner.json'), JSON.stringify({pid: 999999, host: 'here', started: 'then'}));
    const logs = [];
    const release = acquireReleaseLock(lock, {host: 'here', alive: () => false, log: m => logs.push(m)});
    assert.match(logs[0], /no longer running/);
    assert.equal(JSON.parse(readFileSync(join(lock, 'owner.json'), 'utf8')).host, 'here');
    release();
    assert.equal(
      staleReason({pid: 1, host: 'other'}, {host: 'here', alive: () => false}),
      null,
      'another host: never guessed stale',
    );
    assert.equal(staleReason({pid: 1, host: 'here'}, {host: 'here', alive: () => true}), null);
  }));

test('an ownerless lock is respected during the grace period, then reclaimed', () =>
  withDir(dir => {
    assert.equal(staleReason(null, {now: 1000, createdMs: 1000}), null);
    assert.match(staleReason(null, {now: UNOWNED_GRACE_MS + 2000, createdMs: 1000}), /no owner record/);
    const lock = join(dir, 'release.lock');
    mkdirSync(lock);
    const old = (Date.now() - UNOWNED_GRACE_MS - 60000) / 1000;
    utimesSync(lock, old, old);
    acquireReleaseLock(lock, {log: () => {}})();
  }));
