// Render + store integration tests for DocumentArtifactCard and the global
// DocumentArtifactPanel. We use renderToString to inspect the static HTML;
// interactivity is exercised by calling the store directly (the panel is a
// useSyncExternalStore consumer of artifactStore).

import './_setup';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import DocumentArtifactPanel, { DocumentArtifactCard } from '../components/DocumentArtifact';
import {
  closeArtifact,
  openArtifact,
  type ArtifactPayload,
} from '../lib/artifactStore';

function makePayload(over: Partial<ArtifactPayload> = {}): ArtifactPayload {
  return {
    key: 'doc::test',
    title: '01-research/output.json',
    subtitle: 'skill 01',
    data: { niche: { primary_keyword: 'jewelry OEM' }, pain_points: [{ id: 'p1' }] },
    path: '/Users/x/project/aisd/01-research/output.json',
    mtime: '2026-05-19T08:00:00Z',
    ...over,
  };
}

beforeEach(() => {
  closeArtifact();
});

// ─── DocumentArtifactCard ─────────────────────────────────────────────────

test('Card renders title, subtitle, and the "打开" CTA', () => {
  const html = renderToString(createElement(DocumentArtifactCard, { payload: makePayload() }));
  assert.match(html, /01-research\/output\.json/);
  assert.match(html, /skill 01/);
  assert.match(html, /打开/);
  assert.match(html, /doc-artifact-card/);
});

test('Card renders highlight chips when provided', () => {
  const html = renderToString(
    createElement(DocumentArtifactCard, {
      payload: makePayload(),
      highlights: ['5 Pain Points', '6 Competitors', '3 Audience Profiles'],
    }),
  );
  assert.match(html, /5 Pain Points/);
  assert.match(html, /6 Competitors/);
  assert.match(html, /3 Audience Profiles/);
  // Cap at 3 chips.
  const chips = (html.match(/doc-artifact-chip/g) ?? []).length;
  assert.equal(chips, 3);
});

test('Card caps highlights at 3 even when more provided', () => {
  const html = renderToString(
    createElement(DocumentArtifactCard, {
      payload: makePayload(),
      highlights: ['a', 'b', 'c', 'd', 'e'],
    }),
  );
  const chips = (html.match(/doc-artifact-chip/g) ?? []).length;
  assert.equal(chips, 3);
});

test('Card has no chips section when highlights is empty or missing', () => {
  const htmlEmpty = renderToString(
    createElement(DocumentArtifactCard, { payload: makePayload(), highlights: [] }),
  );
  const htmlMissing = renderToString(
    createElement(DocumentArtifactCard, { payload: makePayload() }),
  );
  assert.doesNotMatch(htmlEmpty, /doc-artifact-chip/);
  assert.doesNotMatch(htmlMissing, /doc-artifact-chip/);
});

test('Card without an open artifact does NOT carry the is-open class', () => {
  // store is reset by beforeEach
  const html = renderToString(createElement(DocumentArtifactCard, { payload: makePayload() }));
  assert.doesNotMatch(html, /doc-artifact-card[^"]*is-open/);
});

test('Card with same-key artifact open carries is-open class', () => {
  const payload = makePayload();
  openArtifact(payload);
  const html = renderToString(createElement(DocumentArtifactCard, { payload }));
  assert.match(html, /doc-artifact-card[^"]*is-open/);
});

test('Card with different-key artifact open does NOT carry is-open class', () => {
  openArtifact(makePayload({ key: 'other' }));
  const html = renderToString(createElement(DocumentArtifactCard, { payload: makePayload() }));
  assert.doesNotMatch(html, /doc-artifact-card[^"]*is-open/);
});

// ─── DocumentArtifactPanel ────────────────────────────────────────────────

test('Panel renders nothing when no artifact is open', () => {
  const html = renderToString(createElement(DocumentArtifactPanel, {}));
  assert.equal(html, '');
});

test('Panel renders title, subtitle, and actions when an artifact is open', () => {
  openArtifact(makePayload());
  const html = renderToString(createElement(DocumentArtifactPanel, {}));
  assert.match(html, /doc-panel/);
  assert.match(html, /01-research\/output\.json/);
  assert.match(html, /skill 01/);
  assert.match(html, /原始 JSON/); // toggle to raw view
  assert.match(html, /复制路径/);
  assert.match(html, /复制 JSON/);
  // Document body rendered via JsonDocumentView
  assert.match(html, /Niche/);
  assert.match(html, /jewelry OEM/);
});

test('Panel hides "复制路径" button when payload has no path', () => {
  openArtifact(makePayload({ path: null }));
  const html = renderToString(createElement(DocumentArtifactPanel, {}));
  assert.doesNotMatch(html, /复制路径/);
});

test('Panel footer shows the formatted mtime when present', () => {
  openArtifact(makePayload());
  const html = renderToString(createElement(DocumentArtifactPanel, {}));
  assert.match(html, /最后更新/);
});

test('Panel has scrim + dialog role for accessibility', () => {
  openArtifact(makePayload());
  const html = renderToString(createElement(DocumentArtifactPanel, {}));
  assert.match(html, /doc-panel-scrim/);
  assert.match(html, /role="dialog"/);
  assert.match(html, /aria-modal="true"/);
});

test('Panel uses dialog aria-label equal to artifact title', () => {
  openArtifact(makePayload({ title: 'My Document' }));
  const html = renderToString(createElement(DocumentArtifactPanel, {}));
  assert.match(html, /aria-label="My Document"/);
});

// ─── Lifecycle ────────────────────────────────────────────────────────────

test('Opening a different artifact replaces the previous one in the panel', () => {
  openArtifact(makePayload({ key: 'a', title: 'First' }));
  let html = renderToString(createElement(DocumentArtifactPanel, {}));
  assert.match(html, /First/);

  openArtifact(makePayload({ key: 'b', title: 'Second' }));
  html = renderToString(createElement(DocumentArtifactPanel, {}));
  assert.match(html, /Second/);
  assert.doesNotMatch(html, /First/);
});

test('closeArtifact returns the panel to empty render', () => {
  openArtifact(makePayload());
  closeArtifact();
  const html = renderToString(createElement(DocumentArtifactPanel, {}));
  assert.equal(html, '');
});
