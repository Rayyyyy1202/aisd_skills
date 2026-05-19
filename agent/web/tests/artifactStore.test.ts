// Unit tests for the artifact store — pure module state, no React.

import './_setup';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  closeArtifact,
  getArtifact,
  openArtifact,
  subscribe,
  type ArtifactPayload,
} from '../lib/artifactStore';

function makePayload(over: Partial<ArtifactPayload> = {}): ArtifactPayload {
  return {
    key: 'doc::test',
    title: 'output.json',
    subtitle: 'skill 01',
    data: { hello: 'world' },
    path: '/tmp/output.json',
    mtime: '2026-05-19T00:00:00Z',
    ...over,
  };
}

beforeEach(() => {
  closeArtifact();
});

test('getArtifact returns null when nothing open', () => {
  assert.equal(getArtifact(), null);
});

test('openArtifact stores the payload and notifies subscribers', () => {
  let notified = 0;
  const unsubscribe = subscribe(() => {
    notified += 1;
  });
  openArtifact(makePayload());
  assert.equal(notified, 1);
  assert.equal(getArtifact()?.title, 'output.json');
  unsubscribe();
});

test('openArtifact replaces the previously open artifact', () => {
  openArtifact(makePayload({ key: 'a', title: 'A' }));
  openArtifact(makePayload({ key: 'b', title: 'B' }));
  assert.equal(getArtifact()?.key, 'b');
  assert.equal(getArtifact()?.title, 'B');
});

test('closeArtifact clears state and notifies', () => {
  openArtifact(makePayload());
  let notified = 0;
  const unsubscribe = subscribe(() => {
    notified += 1;
  });
  closeArtifact();
  assert.equal(getArtifact(), null);
  assert.equal(notified, 1);
  unsubscribe();
});

test('closeArtifact is a no-op when nothing is open', () => {
  let notified = 0;
  const unsubscribe = subscribe(() => {
    notified += 1;
  });
  closeArtifact();
  closeArtifact();
  assert.equal(notified, 0);
  unsubscribe();
});

test('multiple subscribers all receive open/close events', () => {
  const calls: string[] = [];
  const off1 = subscribe(() => calls.push('a'));
  const off2 = subscribe(() => calls.push('b'));
  openArtifact(makePayload());
  closeArtifact();
  assert.deepEqual(calls, ['a', 'b', 'a', 'b']);
  off1();
  off2();
});

test('unsubscribe stops further notifications', () => {
  let count = 0;
  const off = subscribe(() => {
    count += 1;
  });
  openArtifact(makePayload());
  off();
  openArtifact(makePayload({ key: 'other' }));
  closeArtifact();
  assert.equal(count, 1);
});
