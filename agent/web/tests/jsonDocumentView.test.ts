// Render tests for JsonDocumentView. We use React's renderToString to get the
// static HTML and assert structural properties (no JSX → plain createElement).

import './_setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { JsonDocumentView } from '../components/JsonDocumentView';

function render(data: unknown): string {
  return renderToString(createElement(JsonDocumentView, { data }));
}

test('top-level object renders titled sections per key', () => {
  const html = render({
    niche: { primary_keyword: 'jewelry OEM' },
    demand: { volume_band: 'medium' },
  });
  // humanKey turns snake → Title
  assert.match(html, /<h3[^>]*>Niche<\/h3>/);
  assert.match(html, /<h3[^>]*>Demand<\/h3>/);
});

test('snake_case key names are humanized; acronyms stay uppercase', () => {
  const html = render({ primary_keyword: 'x', sku_id: 'A1', moq_floor: 50 });
  assert.match(html, /Primary Keyword/);
  assert.match(html, /SKU ID/);
  assert.match(html, /MOQ Floor/);
});

test('array of primitives renders as <ul> with <li> per item', () => {
  const html = render({ rising_queries: ['a', 'b', 'c'] });
  const ulMatch = html.match(/<ul class="doc-list">[\s\S]*?<\/ul>/);
  assert.ok(ulMatch, 'expected a doc-list <ul>');
  const ul = ulMatch?.[0] ?? '';
  const liCount = (ul.match(/<li>/g) ?? []).length;
  assert.equal(liCount, 3);
});

test('array of objects renders numbered card rows', () => {
  const html = render({
    pain_points: [
      { id: 'p1', summary: 'Low MOQ' },
      { id: 'p2', summary: 'Plating issues' },
    ],
  });
  const cardRows = (html.match(/doc-card-row-index/g) ?? []).length;
  assert.equal(cardRows, 2);
  // Indices are 1-based.
  assert.match(html, />1<\/div>/);
  assert.match(html, />2<\/div>/);
});

test('URLs inside string values become <a> tags with target="_blank"', () => {
  const html = render({
    notes: 'See https://example.com/foo for context.',
  });
  assert.match(html, /<a[^>]+href="https:\/\/example\.com\/foo"/);
  assert.match(html, /target="_blank"/);
  assert.match(html, /rel="noreferrer"/);
});

test('claim_meta and meta keys get is-dim class', () => {
  const html = render({
    headline: 'something',
    claim_meta: { sources: [{ url: 'https://x.com' }], confidence: 'high' },
    meta: { schema_version: '1.0.0' },
  });
  // claim_meta is a nested object → rendered as a section with is-dim
  assert.match(html, /class="doc-section is-dim"/);
});

test('null renders as em-dash, booleans as 是/否, empty array as 空', () => {
  const html = render({ flag_true: true, flag_false: false, missing: null, empties: [] });
  assert.match(html, /是/);
  assert.match(html, /否/);
  assert.match(html, /—/);
  assert.match(html, /（空）/);
});

test('pinned-first keys (id, name, project) appear before others', () => {
  const html = render({
    description: 'last by JSON order',
    id: 'comp_001',
    name: 'Acme',
  });
  // id should appear in HTML before description
  const idPos = html.indexOf('comp_001');
  const namePos = html.indexOf('Acme');
  const descPos = html.indexOf('last by JSON order');
  assert.ok(idPos > 0, 'id present');
  assert.ok(namePos > 0, 'name present');
  assert.ok(idPos < descPos, 'id pinned before description');
  assert.ok(namePos < descPos, 'name pinned before description');
});

test('deeply nested object still renders without throwing', () => {
  const deep = { a: { b: { c: { d: { e: 'leaf' } } } } };
  const html = render(deep);
  assert.match(html, /leaf/);
});

test('top-level primitive (not an object) still renders something readable', () => {
  const html = render('just a string with http://x.com inside');
  assert.match(html, /just a string with/);
  assert.match(html, /<a[^>]+href="http:\/\/x\.com"/);
});

test('numbers are rendered verbatim (tabular numerals via class)', () => {
  const html = render({ monthly_search_estimate: 12000 });
  assert.match(html, /12000/);
  assert.match(html, /doc-scalar/);
});

test('text without URLs is rendered as a single text run (no <a> tags)', () => {
  const html = render({ note: 'plain text only here' });
  assert.match(html, /plain text only here/);
  assert.equal((html.match(/<a /g) ?? []).length, 0);
});
