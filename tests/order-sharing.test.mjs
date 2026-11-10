import { test } from "node:test";
import assert from "node:assert/strict";
import { getStore } from "../netlify/node_modules/@netlify/blobs/dist/main.js";
import { vendorSettings, createSession, unseal } from "../netlify/lib/vendor-auth.mjs";
import { handleVendorOrderShare, config as createConfig } from "../netlify/functions/vendor-order-share.mjs";
import { handleOrderShare, config as pageConfig } from "../netlify/functions/order-share.mjs";
import { config as cleanupConfig } from "../netlify/functions/expire-order-shares.mjs";
import { SHARE_TTL_MS, shareKey, saveOrderShare, readOrderShare, removeExpiredOrderShares } from "../netlify/lib/order-shares.mjs";
import { handleOrderRequest } from "../netlify/functions/orders.mjs";
import { products } from "../vendor-app/catalog.mjs";
import { validateOrderShareLink, whatsappUrl, MAX_WHATSAPP_URL_LENGTH } from "../vendor-app/order.mjs";

const origin = "https://vendor.example";
const now = new Date("2026-11-10T07:00:00.000Z");
const order = {
  orderId: "SBC-00000000-0000-4000-8000-000000000001", createdAt: "2025-01-01T00:00:00.000Z",
  status: "Confirmed", name: '<img src=x onerror="alert(1)"> Synthetic customer',
  phone: "9876543210", fulfilment: "Pickup", address: "Synthetic street\nHyderabad",
  notes: "</pre><script>alert('private')</script>", preferredDate: "",
  items: "#1 Synthetic pack | Qty 1 x Rs.100.00 = Rs.100.00\n#2 తెలుగు pack | Qty 2 x Rs.0.00 = Rs.0.00",
  total: 85, subtotal: 100, discountPercent: 15, discount: 15, deliveryCharge: 0,
};
const env = {
  ORDER_BACKEND: "netlify-db", ORDER_PDF_SECRET: "synthetic-pdf-secret-".repeat(3),
  VENDOR_APP_ORIGIN: origin, VENDOR_ALLOWED_EMAILS: "owner@example.com",
  VENDOR_GOOGLE_CLIENT_ID: "synthetic.apps.googleusercontent.com",
  VENDOR_GOOGLE_CLIENT_SECRET: "synthetic-google-secret",
  VENDOR_SESSION_SECRET: "synthetic-session-secret-".repeat(3),
};
const settings = vendorSettings(env);
const cookie = createSession({ sub: "synthetic-owner", email: "owner@example.com" }, settings, now.getTime());
const session = unseal(cookie, "session", settings, now.getTime());
function request({ method = "POST", authenticated = true, body = { orderId: order.orderId }, headers = {} } = {}) {
  return new Request(`${origin}/api/vendor-order-share`, {
    method, headers: {
      ...(authenticated ? { Cookie: `${settings.sessionCookie}=${cookie}` } : {}),
      Origin: origin, "X-Vendor-CSRF": session.csrf, "Content-Type": "application/json", ...headers,
    }, ...(method === "GET" ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
}
function memoryStore() {
  const entries = new Map();
  return {
    entries, writes: 0,
    async setJSON(key, data, { metadata, onlyIfNew }) {
      if (onlyIfNew && entries.has(key)) return { modified: false };
      this.writes++;
      entries.set(key, { data: structuredClone(data), metadata: { ...metadata } });
      return { modified: true };
    },
    async getWithMetadata(key) { return entries.get(key) ?? null; },
    async getMetadata(key) { return entries.has(key) ? { metadata: entries.get(key).metadata } : null; },
    async delete(key) { entries.delete(key); },
    async *list() {
      const blobs = [...entries.keys()].map(key => ({ key }));
      yield { blobs: blobs.slice(0, 1) };
      yield { blobs: blobs.slice(1) };
    },
  };
}
const tokenOf = link => new URL(link.url).pathname.split("/")[2];
const save = store => saveOrderShare({ order, origin }, { store, now: () => now });
const backend = overrides => ({
  env, now: () => now.getTime(),
  databaseFactory: async () => ({ dashboard: async () => ({ ok: true, order }) }),
  ...overrides,
});

test("sharing requires current vendor approval, same-origin POST and CSRF before reading or storing orders", async () => {
  let calls = 0;
  const options = backend({
    databaseFactory: async () => { calls++; throw new Error("Unexpected backend call"); },
    createShare: async () => { calls++; throw new Error("Unexpected share write"); },
  });
  for (const [req, status] of [
    [request({ authenticated: false }), 401],
    [request({ headers: { Cookie: `${settings.sessionCookie}=forged` } }), 401],
    [request({ headers: { Origin: "https://elsewhere.example" } }), 403],
    [request({ headers: { "X-Vendor-CSRF": "incorrect" } }), 403],
    [request({ method: "GET" }), 405],
    [request({ headers: { "Content-Type": "text/plain" } }), 415],
    [request({ body: "{" }), 400],
    [request({ body: { orderId: "invalid" } }), 400],
    [request({ body: { orderId: [order.orderId] } }), 400],
    [request({ body: { orderId: 123 } }), 400],
    [request({ body: { orderId: null } }), 400],
    [request({ body: { orderId: order.orderId, order } }), 400],
    [request({ body: "x".repeat(1025) }), 413],
    [request({ headers: { "Content-Length": "1025" } }), 413],
  ]) assert.equal((await handleVendorOrderShare(req, options)).status, status);
  assert.equal((await handleVendorOrderShare(request(), { ...options, now: () => session.exp })).status, 401);
  assert.equal((await handleVendorOrderShare(request(), {
    ...options, env: { ...env, VENDOR_ALLOWED_EMAILS: "other@example.com" },
  })).status, 401);
  assert.equal((await handleVendorOrderShare(request(), { ...options, env: {} })).status, 503);
  assert.equal(calls, 0);
});

test("creation snapshots only the fresh saved request and works with database and Sheets backends without changing either", async () => {
  for (const database of [true, false]) {
    const store = memoryStore();
    const calls = [];
    const options = backend({
      createShare: (args, timing) => saveOrderShare(args, { store, ...timing }),
      ...(database ? {
        databaseFactory: async () => ({ dashboard: async (input, actor) => {
          calls.push(input);
          assert.equal(actor, "owner@example.com");
          return { ok: true, order: { ...order, fingerprint: "never-share", auditEmail: "private@example.com" } };
        } }),
      } : {
        env: { ...env, ORDER_BACKEND: "sheets",
          GOOGLE_SHEETS_WEBHOOK_URL: "https://script.google.com/macros/s/test/exec",
          ORDER_TRACKING_SECRET: "synthetic-sheet-secret-".repeat(3) },
        fetchImpl: async (url, options) => {
          const input = JSON.parse(options.body);
          calls.push({ action: input.action, orderId: input.orderId });
          return Response.json({ ok: true, order });
        },
      }),
    });
    const response = await handleVendorOrderShare(request(), options);
    assert.equal(response.status, 200);
    const link = await response.json();
    assert.equal(link.orderId, order.orderId);
    assert.match(response.headers.get("cache-control"), /no-store/);
    assert.deepEqual(calls, [{ action: "vendor-detail", orderId: order.orderId }]);
    const snapshot = (await readOrderShare(tokenOf(link), { store, now: () => now })).snapshot;
    assert.deepEqual(snapshot.order, order);
    assert.ok(!JSON.stringify(snapshot).includes("never-share"));
    assert.ok(!JSON.stringify(snapshot).includes("private@example.com"));
  }
});

test("missing requests, invalid backend replies and uncertain writes never return usable share links", async () => {
  let writes = 0;
  for (const [result, status] of [
    [{ ok: false, error: "NOT_FOUND" }, 404],
    [{ ok: true, order: { ...order, orderId: "invalid" } }, 503],
    [{ ok: true, order: { ...order, items: null } }, 503],
  ]) {
    const response = await handleVendorOrderShare(request(), backend({
      databaseFactory: async () => ({ dashboard: async () => result }),
      createShare: async () => { writes++; },
    }));
    assert.equal(response.status, status);
    assert.equal((await response.json()).url, undefined);
  }
  assert.equal(writes, 0);
  const response = await handleVendorOrderShare(request(), backend({
    createShare: async () => { throw new Error("Synthetic private storage failure"); },
  }));
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /Synthetic private/);
  const store = memoryStore();
  store.setJSON = async () => ({ modified: false });
  await assert.rejects(() => save(store), /not acknowledged/);
});

test("links are unguessable independent snapshots, contain no customer details and expire seven days after sharing older orders", async () => {
  const store = memoryStore();
  const first = await save(store);
  const second = await save(store);
  assert.notEqual(first.url, second.url);
  assert.match(new URL(first.url).pathname, /^\/request\/\d{8}\.[A-Za-z0-9_-]{43}$/);
  assert.equal(Date.parse(first.expiresAt) - now.getTime(), SHARE_TTL_MS);
  for (const value of [order.orderId, order.phone, order.name, settings.secret]) assert.ok(!first.url.includes(value));
  assert.ok(![...store.entries.keys()][0].includes(tokenOf(first)));
  const snapshot = (await readOrderShare(tokenOf(first), { store, now: () => now })).snapshot;
  assert.equal(snapshot.sharedAt, now.toISOString());
  assert.equal(snapshot.order.createdAt, order.createdAt);
  assert.equal(snapshot.order.items, order.items);
  assert.equal(store.writes, 2);
});

test("the actual Blobs SDK persists JSON snapshots and private metadata with strong consistency and conditional creation", async () => {
  let stored;
  const store = getStore({
    name: "order-shares-test", siteID: "test-site", token: "test-only-token",
    consistency: "strong", edgeURL: "https://cached.blobs.test", uncachedEdgeURL: "https://uncached.blobs.test",
    fetch: async (url, options) => {
      assert.equal(new URL(url).hostname, "uncached.blobs.test");
      const headers = new Headers(options.headers);
      if (options.method.toUpperCase() === "PUT") {
        assert.equal(headers.get("if-none-match"), "*");
        stored = { data: options.body, metadata: headers.get("x-amz-meta-user") };
        return new Response(null, { headers: { etag: "test-etag" } });
      }
      return new Response(stored.data, { headers: { etag: "test-etag", "netlify-blobs-metadata": stored.metadata } });
    },
  });
  const link = await save(store);
  const result = await readOrderShare(tokenOf(link), { store, now: () => now });
  assert.deepEqual(result.snapshot.order, order);
  assert.equal(result.snapshot.expiresAt, link.expiresAt);
});

test("tokens cannot be replaced with order IDs; invalid, altered or corrupt snapshots disclose nothing", async () => {
  const store = memoryStore();
  for (const token of ["", "../private", order.orderId, "20260230." + "A".repeat(43), "20261117." + "A".repeat(42)]) {
    assert.equal(shareKey(token), null);
    assert.equal((await readOrderShare(token, { store })).status, 400);
  }
  const link = await save(store);
  const token = tokenOf(link);
  const changed = token.slice(0, -1) + (token.endsWith("A") ? "B" : "A");
  assert.equal((await readOrderShare(changed, { store, now: () => now })).status, 404);
  const entry = store.entries.get(shareKey(token));
  entry.data.order.items = null;
  await assert.rejects(() => readOrderShare(token, { store, now: () => now }), /snapshot/);
  entry.data.order.items = order.items;
  entry.metadata.expiresAt = "2026-12-01T00:00:00.000Z";
  await assert.rejects(() => readOrderShare(token, { store, now: () => now }), /metadata/);
});

test("access is denied at the exact expiry even if physical deletion fails; the original register is not involved", async () => {
  const store = memoryStore();
  const link = await save(store);
  const expiry = Date.parse(link.expiresAt);
  assert.equal((await readOrderShare(tokenOf(link), { store, now: () => new Date(expiry - 1) })).status, 200);
  store.delete = async () => { throw new Error("Synthetic cleanup failure"); };
  assert.deepEqual(await readOrderShare(tokenOf(link), { store, now: () => new Date(expiry) }), { status: 410 });
  assert.equal(store.entries.size, 1);
  store.delete = async key => store.entries.delete(key);
  assert.deepEqual(await readOrderShare(tokenOf(link), { store, now: () => new Date(expiry + 1) }), { status: 410 });
  assert.equal(store.entries.size, 0);
});

test("hourly cleanup paginates, respects exact expiry and never removes a live snapshot", async () => {
  const store = memoryStore();
  const link = await save(store);
  await saveOrderShare({ order, origin }, { store, now: () => new Date(now.getTime() + 86400000) });
  assert.equal(await removeExpiredOrderShares({ store, now: () => new Date(link.expiresAt) }), 1);
  assert.equal(store.entries.size, 1);
  store.delete = async () => { throw new Error("Synthetic cleanup failure"); };
  await assert.rejects(() => removeExpiredOrderShares({
    store, now: () => new Date(Date.parse(link.expiresAt) + 2 * 86400000),
  }));
  assert.equal(cleanupConfig.schedule, "@hourly");
});

test("recipient pages work without vendor login, escape all customer content and prohibit scripts, edits, caching and indexing", async () => {
  const store = memoryStore();
  const link = await save(store);
  const options = { readShare: token => readOrderShare(token, { store, now: () => now }) };
  const response = await handleOrderShare(new Request(link.url), options);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/html/);
  assert.match(response.headers.get("cache-control"), /private.*no-store/);
  assert.equal(response.headers.get("netlify-cdn-cache-control"), "no-store");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.match(response.headers.get("x-robots-tag"), /noindex/);
  assert.match(response.headers.get("content-security-policy"), /default-src 'none'.*form-action 'none'.*frame-ancestors 'none'/);
  assert.equal(response.headers.get("set-cookie"), null);
  const html = await response.text();
  assert.ok(html.includes(order.items));
  assert.ok(html.includes(order.orderId));
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.match(html, /&lt;\/pre&gt;&lt;script&gt;/);
  assert.match(html, /read-only|Read-only/);
  assert.match(html, /not live updates/);
  assert.match(html, /Rs\.85\.00/);
  assert.match(html, /IST/);
  assert.doesNotMatch(html, /<script|<form|<input|vendor\.mjs|owner@example\.com/);
  const head = await handleOrderShare(new Request(link.url, { method: "HEAD" }), options);
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  const blocked = await handleOrderShare(new Request(link.url, { method: "POST", body: "{}" }), options);
  assert.equal(blocked.status, 405);
  assert.equal(blocked.headers.get("allow"), "GET, HEAD");
  assert.equal(createConfig.path, "/api/vendor-order-share");
  assert.equal(pageConfig.path, "/request/*");
});

test("invalid, missing, expired and failed page lookups have explicit private-data-free responses", async () => {
  const store = memoryStore();
  const link = await save(store);
  for (const [url, readShare, status] of [
    [`${origin}/request/${order.orderId}`, async () => { throw new Error("Must not read"); }, 400],
    [link.url + "?token=other", async () => { throw new Error("Must not read"); }, 400],
    [link.url, async () => ({ status: 404 }), 404],
    [link.url, token => readOrderShare(token, { store, now: () => new Date(link.expiresAt) }), 410],
    [link.url, async () => { throw new Error(order.phone); }, 503],
  ]) {
    const response = await handleOrderShare(new Request(url), { readShare });
    assert.equal(response.status, status);
    assert.ok(!(await response.text()).includes(order.phone));
  }
});

const checkout = {
  requestId: "00000000-0000-4000-8000-000000000001",
  catalogue: { year: 2026, revision: 1 }, cart: { 1: 1 }, consent: true, shareConsent: true,
  customer: {
    name: "Synthetic Customer", phone: "9876543210", address: "Synthetic address only",
    fulfilment: "pickup", preferredDate: "", notes: "",
  },
};
function checkoutRequest(input = checkout) {
  return new Request(`${origin}/api/orders`, {
    method: "POST", headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}
function checkoutBackend(save, overrides = {}) {
  return {
    env, now: () => now,
    databaseFactory: async () => ({
      catalogueVersion: async () => ({ year: 2026, revision: 1, products }),
      save,
    }),
    ...overrides,
  };
}

test("small and large submissions prepare name, amount and a full-details web link only after Database or Sheets acknowledges saving", async () => {
  for (const database of [true, false]) {
    for (const large of [false, true]) {
      const store = memoryStore();
      const input = {
        ...checkout, ...(large ? {
          cart: Object.fromEntries(products.map(product => [product.id, 99])),
          customer: { ...checkout.customer, name: String.fromCharCode(0x800).repeat(80),
            address: "A".repeat(500), notes: "N".repeat(500), fulfilment: "delivery" },
        } : {}),
      };
      let recorded;
      const acknowledge = value => {
        recorded = structuredClone(value);
        assert.equal(store.writes, 0);
        return { ok: true, orderId: value.orderId, createdAt: value.createdAt };
      };
      const options = checkoutBackend(acknowledge, {
        saveShare: (args, timing) => {
          assert.ok(recorded);
          return saveOrderShare(args, { store, ...timing });
        },
        savePdf: () => { throw new Error("Web-link submissions must not generate a PDF"); },
        ...(database ? {} : {
          env: { ...env, ORDER_BACKEND: "sheets",
            GOOGLE_SHEETS_WEBHOOK_URL: "https://script.google.com/macros/s/test/exec",
            ORDER_TRACKING_SECRET: "synthetic-sheet-secret-".repeat(3) },
          fetchImpl: async (_, options) => Response.json(acknowledge(JSON.parse(options.body).order)),
        }),
      });
      const response = await handleOrderRequest(checkoutRequest(input), options);
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.equal(result.pdf, undefined);
      assert.equal(result.share.orderId, recorded.orderId);
      validateOrderShareLink(result.share, origin, recorded.orderId, now.getTime());
      assert.ok(result.summary.includes(`Customer: ${input.customer.name}`));
      assert.ok(result.summary.includes(`Estimated total: Rs.${recorded.amounts.total.toFixed(2)}`));
      assert.ok(result.summary.includes(`Mobile: +91 ${input.customer.phone}`));
      assert.ok(result.summary.includes(result.share.url));
      assert.ok(!result.summary.includes("#1 "));
      assert.ok(!result.summary.includes(input.customer.address));
      assert.ok(whatsappUrl(result.summary).length <= MAX_WHATSAPP_URL_LENGTH);
      const snapshot = (await readOrderShare(tokenOf(result.share), { store, now: () => now })).snapshot;
      assert.equal(snapshot.source, "submission");
      assert.equal(snapshot.order.createdAt, recorded.createdAt);
      assert.equal(snapshot.order.name, input.customer.name);
      assert.equal(snapshot.order.address, input.customer.address);
      assert.equal(snapshot.order.notes, input.customer.notes);
      assert.equal(snapshot.order.total, recorded.amounts.total);
      assert.equal(snapshot.order.status, "New");
      assert.equal(snapshot.order.fingerprint, undefined);
      for (const item of recorded.items) {
        assert.ok(snapshot.order.items.includes(`#${item.id} ${item.name} | ${item.brand}`));
        assert.ok(snapshot.order.items.includes(`Pack: ${item.unit}`));
        assert.ok(snapshot.order.items.includes(`Rs.${item.amount.toFixed(2)}`));
        assert.ok(result.message.includes(`#${item.id} ${item.name}`));
      }
      const page = await handleOrderShare(new Request(result.share.url), {
        readShare: token => readOrderShare(token, { store, now: () => now }),
      });
      assert.equal(page.status, 200);
      const html = await page.text();
      assert.match(html, /original submitted request, not live updates/);
      assert.match(html, /Status at submission<\/dt><dd>New/);
      assert.equal(store.writes, 1);
    }
  }
});

test("a retried submission preserves its recorded timestamp and creates a fresh link even after the first link expires", async () => {
  const store = memoryStore();
  const records = new Map();
  let instant = now;
  const options = checkoutBackend(value => {
    if (!records.has(value.orderId)) records.set(value.orderId, value);
    return { ok: true, orderId: value.orderId, createdAt: records.get(value.orderId).createdAt };
  }, {
    now: () => instant,
    saveShare: (args, timing) => saveOrderShare(args, { store, ...timing }),
  });
  const first = await (await handleOrderRequest(checkoutRequest(), options)).json();
  instant = new Date(now.getTime() + 8 * 86400000);
  const response = await handleOrderRequest(checkoutRequest(), options);
  assert.equal(response.status, 200);
  const retry = await response.json();
  assert.equal(retry.orderId, first.orderId);
  assert.equal(records.size, 1);
  assert.notEqual(retry.share.url, first.share.url);
  assert.equal(Date.parse(retry.share.expiresAt), instant.getTime() + SHARE_TTL_MS);
  const snapshot = (await readOrderShare(tokenOf(retry.share), { store, now: () => instant })).snapshot;
  assert.equal(snapshot.order.createdAt, now.toISOString());
  assert.equal(snapshot.sharedAt, instant.toISOString());
  assert.ok(retry.summary.includes("2026-11-10 12:30:00 IST"));
  assert.equal((await readOrderShare(tokenOf(first.share), { store, now: () => instant })).status, 410);
});

test("submission storage failures report a saved request and safe retry, while unacknowledged or unconsented requests never create links", async () => {
  let writes = 0;
  const options = checkoutBackend(value => ({ ok: true, orderId: value.orderId, createdAt: value.createdAt }), {
    saveShare: async () => { writes++; throw new Error("Private synthetic storage detail"); },
  });
  const failed = await handleOrderRequest(checkoutRequest(), options);
  assert.equal(failed.status, 503);
  const result = await failed.json();
  assert.match(result.error, /is saved.*details link.*retry with the same details/);
  assert.doesNotMatch(result.error, /Private synthetic/);
  assert.equal(result.share, undefined);
  assert.equal(result.summary, undefined);
  assert.equal(writes, 1);
  writes = 0;
  const rejected = await handleOrderRequest(checkoutRequest({ ...checkout, consent: false }), options);
  assert.equal(rejected.status, 400);
  const unacknowledged = await handleOrderRequest(checkoutRequest(), checkoutBackend(() => ({ ok: false }), {
    saveShare: options.saveShare,
  }));
  assert.equal(unacknowledged.status, 503);
  const legacy = await handleOrderRequest(checkoutRequest({ ...checkout, shareConsent: false }), options);
  assert.equal(legacy.status, 200);
  assert.equal((await legacy.json()).share, undefined);
  assert.equal(writes, 0);
});

test("checkout rejects missing, mismatched, foreign, tampered, noncanonical and expired detail links", () => {
  const expiresAt = new Date(now.getTime() + SHARE_TTL_MS).toISOString();
  const valid = { orderId: order.orderId, url: `${origin}/request/20261117.${"a".repeat(43)}`, expiresAt };
  assert.deepEqual(validateOrderShareLink(valid, origin, order.orderId, now.getTime()),
    { url: valid.url, expiresAt });
  for (const share of [
    null, {}, { ...valid, orderId: "another-request" }, { ...valid, url: "not a URL" },
    { ...valid, url: valid.url.replace(origin, "https://elsewhere.example") },
    { ...valid, url: valid.url.replace("vendor.example", "user:password@vendor.example") },
    { ...valid, url: valid.url + "?other=1" }, { ...valid, url: valid.url + "#other" },
    { ...valid, url: valid.url.replace("/request/", "/vendor/") },
    { ...valid, url: valid.url.slice(0, -1) },
    { ...valid, expiresAt: now.toISOString() },
    { ...valid, expiresAt: "not a date" },
    { ...valid, expiresAt: expiresAt.replace(".000Z", "Z") },
    { ...valid, expiresAt: new Date(now.getTime() + 6 * 86400000).toISOString() },
    { ...valid, expiresAt: new Date(now.getTime() + SHARE_TTL_MS + 60001).toISOString() },
  ]) assert.throws(() => validateOrderShareLink(share, origin, order.orderId, now.getTime()), /details link/);
});

test("snapshot source is validated while existing vendor snapshots without a source remain readable", async () => {
  const store = memoryStore();
  const link = await save(store);
  const entry = store.entries.get(shareKey(tokenOf(link)));
  delete entry.data.source;
  assert.equal((await readOrderShare(tokenOf(link), { store, now: () => now })).status, 200);
  entry.data.source = "invalid";
  await assert.rejects(() => readOrderShare(tokenOf(link), { store, now: () => now }), /snapshot/);
  await assert.rejects(() => saveOrderShare({ order, origin, source: "invalid" }, { store }), /snapshot/);
});
