import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';
const source = (await readFile(new URL('../vendor-app/telemetry-client.mjs', import.meta.url), 'utf8')).replace('export function', 'function');
function client(navigator = {}, blocked = false) {
  const requests = [];
  const storage = new Map();
  const context = vm.createContext({ navigator, crypto: { randomUUID }, Date, Set, JSON,
    sessionStorage: { getItem: k => { if (blocked) throw new Error('Blocked'); return storage.get(k); }, setItem: (k, v) => storage.set(k, v) },
    fetch: (url, options) => { requests.push({ url, ...options, body: JSON.parse(options.body) }); return Promise.resolve({ ok: true }); }
  });
  vm.runInContext(source, context);
  return { requests, track: type => vm.runInContext(`track('${type}')`, context) };
}
test('collects only anonymous allowed fields and deduplicates stages', () => {
  const c = client(); c.track('cart'); c.track('cart'); c.track('checkout');
  assert.equal(c.requests.filter(r => r.body.type === 'cart').length, 1);
  assert.equal(new Set(c.requests.map(r => r.body.session)).size, 1);
  for (const request of c.requests) {
    assert.deepEqual(Object.keys(request.body).sort(), ['id', 'session', 'type']);
    assert.equal(request.url, '/api/telemetry');
    assert.equal(request.keepalive, true);
  }
});
test('respects privacy signals', () => {
  assert.equal(client({ globalPrivacyControl: true }).requests.length, 0);
  assert.equal(client({ doNotTrack: '1' }).requests.length, 0);
});
test('storage restrictions never interrupt catalogue', () => {
  const c = client({}, true); assert.doesNotThrow(() => c.track('saved')); assert.equal(c.requests.length, 0);
});
