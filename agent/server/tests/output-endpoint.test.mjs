// Integration tests for skill output read/write endpoints.
//
// Hits the running dev server on http://localhost:3001 (override with API_URL).
// Snapshots the target skill output before mutating and restores it after,
// so the test is safe to run against a real workspace.
//
// Run:   pnpm test:output     (or directly:  node --test tests/output-endpoint.test.mjs)

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const API = process.env.API_URL ?? 'http://localhost:3001';
const SKILL_ID = process.env.TEST_SKILL_ID ?? '01';

let BRAND_ID = process.env.TEST_BRAND_ID ?? null;
let snapshot = null;

async function discoverBrandId() {
  const r = await fetch(`${API}/brands`);
  if (!r.ok) throw new Error(`GET /brands failed: ${r.status}`);
  const j = await r.json();
  if (j.default_brand_id) return j.default_brand_id;
  if (Array.isArray(j.brands) && j.brands[0]?.id) return j.brands[0].id;
  throw new Error('no brand available — set TEST_BRAND_ID or seed a brand first');
}

async function getOutput(brandId) {
  const r = await fetch(`${API}/brands/${brandId}/skills/${SKILL_ID}/output`);
  return { status: r.status, body: await r.json().catch(() => null) };
}

async function putOutput(brandId, payload, { rawBody } = {}) {
  const r = await fetch(`${API}/brands/${brandId}/skills/${SKILL_ID}/output`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: rawBody ?? JSON.stringify(payload),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

before(async () => {
  // Sanity: server alive
  const h = await fetch(`${API}/health`);
  assert.equal(h.status, 200, 'dev server must be up on ' + API);

  // Auto-discover a brand id if none was provided via env.
  if (!BRAND_ID) BRAND_ID = await discoverBrandId();

  // Snapshot — fail loudly if the brand/skill doesn't exist
  const r = await getOutput(BRAND_ID);
  assert.equal(
    r.status,
    200,
    `GET output failed for brand=${BRAND_ID} skill=${SKILL_ID}: ${JSON.stringify(r.body)}`,
  );
  assert.ok(r.body.data && typeof r.body.data === 'object', 'no output to snapshot');
  snapshot = r.body.data;
});

after(async () => {
  if (snapshot) {
    const r = await putOutput(BRAND_ID, snapshot);
    assert.equal(r.status, 200, `restore failed: ${JSON.stringify(r.body)}`);
  }
});

test('GET roundtrip: PUT same content reads back identical JSON', async () => {
  const put = await putOutput(BRAND_ID, snapshot);
  assert.equal(put.status, 200);
  assert.equal(put.body.ok, true);
  assert.match(put.body.path, /\/output\.json$/);

  const got = await getOutput(BRAND_ID);
  assert.equal(got.status, 200);
  assert.deepEqual(got.body.data, snapshot);
});

test('rejects array body (must be a JSON object)', async () => {
  const r = await putOutput(BRAND_ID, [1, 2, 3]);
  assert.equal(r.status, 400);
  assert.ok(typeof r.body.error === 'string' && r.body.error.length > 0);
});

test('rejects null body', async () => {
  const r = await putOutput(BRAND_ID, null);
  assert.equal(r.status, 400);
  assert.ok(typeof r.body.error === 'string' && r.body.error.length > 0);
});

test('rejects scalar body', async () => {
  const r = await putOutput(BRAND_ID, 'not-an-object');
  assert.equal(r.status, 400);
  assert.ok(typeof r.body.error === 'string' && r.body.error.length > 0);
});

test('rejects malformed JSON body', async () => {
  const r = await putOutput(BRAND_ID, null, { rawBody: '{not json' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /json/i);
});

test('rejects schema-violating object with ajv errors[]', async () => {
  const r = await putOutput(BRAND_ID, { totally: 'wrong shape' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /schema/i);
  assert.ok(Array.isArray(r.body.errors), 'expected ajv errors[]');
  assert.ok(r.body.errors.length > 0, 'errors[] should not be empty');
  for (const e of r.body.errors) {
    assert.ok('path' in e && 'message' in e, 'each error must have {path, message}');
  }
});

test('legacy PUT /skills/:id/output (no brand) also works', async () => {
  const r = await fetch(`${API}/skills/${SKILL_ID}/output`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'x-brand-id': BRAND_ID },
    body: JSON.stringify(snapshot),
  });
  const body = await r.json();
  assert.equal(r.status, 200);
  assert.equal(body.ok, true);
});

test('unknown brand id → 404', async () => {
  const r = await getOutput('00000000-0000-0000-0000-000000000000');
  assert.equal(r.status, 404);
});

test('unknown skill id → 404', async () => {
  const r = await fetch(`${API}/brands/${BRAND_ID}/skills/zz-not-a-skill/output`);
  assert.equal(r.status, 404);
});
