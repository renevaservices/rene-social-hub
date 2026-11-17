import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./facebook-publisher.js', import.meta.url), 'utf8');
const worker = readFileSync(new URL('./index.js', import.meta.url), 'utf8');
const { publishScheduledFacebookPost } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));

test('publishing disabled by default: no database or network call', async () => {
  let called = false;
  const result = await publishScheduledFacebookPost({
    db: { prepare() { called = true; throw Error('DB should not be called'); } },
    postId: 'test',
    resolvePageAccessToken() { called = true; throw Error('Token should not be resolved'); },
    fetchImpl() { called = true; throw Error('Network should not be called'); }
  });
  assert.deepEqual(result, { ok: false, reason: 'publishing_disabled' });
  assert.equal(called, false);
});

test('already claimed posts are never published', async () => {
  let networkCalled = false;
  const db = { prepare() { return { bind() { return { async run() { return { meta: { changes: 0 } }; } }; } }; } };
  const result = await publishScheduledFacebookPost({
    db, postId: 'claimed', enabled: true,
    resolvePageAccessToken() { throw Error('Should not resolve'); },
    fetchImpl() { networkCalled = true; throw Error('Should not publish'); }
  });
  assert.deepEqual(result, { ok: false, reason: 'not_due_or_already_claimed' });
  assert.equal(networkCalled, false);
});

test('Worker health and cron remain disabled', () => {
  assert.match(worker, /publishingEnabled: false/);
  const cron = worker.slice(worker.indexOf('async scheduled(event'));
  assert.doesNotMatch(cron, /await publishScheduledFacebookPost\(/);
  assert.match(worker, /setupAuthorized\(request, env\)/);
});
