import { test } from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { createBrowserCustomerStore, normalizeBrowserPhone } from "../vendor-app/browser-customer-model.mjs";

const origin = "https://shop.example";
const orderId = "SBC-12345678-1234-4234-8234-123456789012";
function memory() {
  const data = new Map();
  return { data, getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) };
}
function share(expiry = new Date(Date.now() + 86400000).toISOString()) {
  return { orderId, url: `${origin}/request/${expiry.slice(0, 10).replaceAll("-", "")}.${"a".repeat(43)}`, expiresAt: expiry };
}
function makeStore(session = memory(), storage = memory()) {
  return { store: createBrowserCustomerStore({ session, storage, origin, cryptoImpl: webcrypto }), session, storage };
}

test("phone entry normalizes Indian numbers and rejects invalid input", () => {
  assert.equal(normalizeBrowserPhone("+91 98765 43210"), "9876543210");
  assert.equal(normalizeBrowserPhone("9876543210"), "9876543210");
  for (const value of ["1234567890", "987654321", "9876543210abc", "00919876543210"]) {
    assert.throws(() => normalizeBrowserPhone(value), /valid 10-digit/);
  }
});

test("history needs this browser's saved links, not merely a matching phone number", async () => {
  const { store, session, storage } = makeStore();
  await store.enter("9876543210");
  store.remember(orderId, { ...share(), name: "not stored", address: "not stored" });
  store.remember(orderId, share());
  assert.equal(store.history().length, 1);
  assert.doesNotMatch(JSON.stringify([...storage.data]), /not stored|9876543210/);
  const restored = makeStore(session, storage).store;
  await restored.restore();
  assert.equal(restored.phone, "9876543210");
  assert.equal(restored.history().length, 1);
  await restored.enter("9876543211");
  assert.deepEqual(restored.history(), []);
  const otherBrowser = makeStore().store;
  await otherBrowser.enter("9876543210");
  assert.deepEqual(otherBrowser.history(), []);
  restored.end();
  assert.equal(restored.phone, "");
  assert.throws(() => restored.history(), /Enter your mobile/);
  await restored.enter("9876543210");
  restored.forget();
  assert.deepEqual(restored.history(), []);
});

test("history rejects untrusted links and retains an expired reference without a customer-data snapshot", async () => {
  const { store, storage } = makeStore();
  await store.enter("9876543210");
  assert.throws(() => store.remember(orderId, { ...share(), url: share().url.replace(origin, "https://attacker.example") }));
  store.remember(orderId, share());
  const key = [...storage.data.keys()][0];
  storage.setItem(key, JSON.stringify([{ ...share("2026-01-01T10:00:00.000Z"), name: "private" }]));
  assert.equal(store.history()[0].expiresAt, "2026-01-01T10:00:00.000Z");
  assert.equal(store.history()[0].name, undefined);
  storage.setItem(key, "{invalid");
  assert.throws(() => store.history());
  store.forget();
  assert.deepEqual(store.history(), []);
});

test("blocked storage fails explicitly without accepting the phone session", async () => {
  const session = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  const { store } = makeStore(session);
  await assert.rejects(store.enter("9876543210"), /blocked/);
  assert.equal(store.phone, "");
});

test("history keeps only the newest 50 references and does not overwrite history on a failed storage write", async () => {
  const { store, storage } = makeStore();
  await store.enter("9876543210");
  for (let index = 0; index < 51; index++) {
    const id = `SBC-${index.toString(16).toUpperCase().padStart(8, "0")}-1234-4234-8234-123456789012`;
    store.remember(id, { ...share(), orderId: id });
  }
  assert.equal(store.history().length, 50);
  assert.match(store.history()[0].orderId, /^SBC-00000032/);
  assert.ok(!store.history().some(entry => entry.orderId.startsWith("SBC-00000000")));
  storage.setItem = () => { throw new Error("quota"); };
  assert.throws(() => store.remember(orderId, share()), /quota/);
  assert.equal(store.history().length, 50);
});
