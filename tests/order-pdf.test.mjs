import { test } from "node:test";
import assert from "node:assert/strict";
import { getStore } from "../netlify/node_modules/@netlify/blobs/dist/main.js";
import { buildOrder, handleOrderRequest } from "../netlify/functions/orders.mjs";
import { DEFAULT_OFFERS } from "../vendor-app/offers-model.mjs";
import { handlePdfRequest } from "../netlify/functions/order-pdf.mjs";
import { config as cleanupConfig } from "../netlify/functions/expire-order-pdfs.mjs";
import { PDF_TTL_MS, pdfKey, saveOrderPdf, readOrderPdf, removeExpiredOrderPdfs } from "../netlify/lib/order-pdfs.mjs";
import { generateOrderPdf, orderTextRuns } from "../netlify/lib/pdf.mjs";
import { products } from "../vendor-app/catalog.mjs";
import { prepareOrderMessage, validatePdfLink } from "../vendor-app/order.mjs";

const now = new Date("2026-11-03T04:34:22.858Z");
const origin = "https://saibabacrackers.netlify.app";
const secret = "test-only-pdf-signing-value-".repeat(2);
const input = {
  offerVersion: null,
  requestId: "12345678-1234-4234-8234-123456789abc", consent: true, pdfConsent: true,
  cart: Object.fromEntries(products.map(product => [product.id, 99])),
  customer: {
    name: "Example Customer", phone: "9876543210", address: "Example Street, Hyderabad 500018",
    fulfilment: "delivery", preferredDate: "", notes: "Please call first.",
  },
};
const order = buildOrder(input, now);
const message = order.message.replace("\n", "\nOrder date & time: 2026-11-03 10:04:22 IST\n");
const args = { order, message, savedAt: now, origin, secret };
const fakePdf = Buffer.from("%PDF-1.7\nTest fixture only\n%%EOF");

function memoryStore() {
  const entries = new Map();
  return {
    entries, writes: 0, deletes: 0,
    async getMetadata(key) { const entry = entries.get(key); return entry ? { metadata: { ...entry.metadata } } : null; },
    async getWithMetadata(key) { return entries.get(key) ?? null; },
    async set(key, data, { metadata, onlyIfNew }) {
      const bytes = Buffer.from(await data.arrayBuffer());
      if (onlyIfNew && entries.has(key)) return { modified: false };
      this.writes++;
      entries.set(key, { data: bytes, metadata: { ...metadata } });
      return { modified: true };
    },
    async delete(key) { this.deletes++; entries.delete(key); },
    async *list() {
      const blobs = [...entries.keys()].map(key => ({ key }));
      yield { blobs: blobs.slice(0, 1) };
      yield { blobs: blobs.slice(1) };
    },
  };
}
const generation = { generatePdf: async () => fakePdf, now: () => now };

test("order PDFs retain every text run, embed Unicode fonts and paginate without empty footer pages", async () => {
  const unicode = message + "\nరవి హైదరాబాద్ कुमार कृपया 🎉";
  const runs = await orderTextRuns(unicode);
  assert.equal(runs.map(run => run.text).join(""), unicode);
  assert.ok(runs.some(run => run.font === "NotoSansTelugu"));
  assert.ok(runs.some(run => run.font === "NotoEmoji"));
  const bytes = await generateOrderPdf(unicode, order.orderId, now.toISOString());
  assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
  assert.ok(bytes.subarray(-20).toString().includes("%%EOF"));
  const pages = bytes.toString("latin1").match(/\/Type \/Page\b/g)?.length ?? 0;
  assert.ok(pages > 1 && pages <= 8, `full cart should fit without blank footer pages: ${pages}`);
  assert.ok(bytes.length < 1024 * 1024);
  await assert.rejects(() => orderTextRuns("Unsupported \u{10ffff}"), { code: "PDF_UNSUPPORTED_TEXT" });
});

test("PDF links are unguessable, private, retry-stable and expire seven days after the original saved time", async () => {
  const store = memoryStore();
  const first = await saveOrderPdf(args, { store, ...generation });
  const second = await saveOrderPdf(args, { store, ...generation, now: () => new Date(now.getTime() + 86400000) });
  assert.deepEqual(second, first);
  assert.equal(new Date(first.expiresAt).getTime() - now.getTime(), PDF_TTL_MS);
  assert.equal(store.writes, 1);
  assert.equal(store.entries.size, 1);
  const url = new URL(first.url);
  assert.equal(url.origin, origin);
  assert.equal(url.pathname, "/api/order-pdf");
  assert.match(url.searchParams.get("token"), /^\d{8}\.[A-Za-z0-9_-]{43}$/);
  for (const privateValue of [order.orderId, order.customer.name, order.customer.phone, secret]) {
    assert.ok(!first.url.includes(privateValue));
  }
  assert.ok(![...store.entries.keys()][0].includes(url.searchParams.get("token")));
  assert.deepEqual(validatePdfLink(first, origin), first);
});

test("concurrent retries never overwrite a stored PDF or create different links", async () => {
  const store = memoryStore();
  const links = await Promise.all([saveOrderPdf(args, { store, ...generation }), saveOrderPdf(args, { store, ...generation })]);
  assert.deepEqual(links[0], links[1]);
  assert.equal(store.writes, 1);
});

test("the real Blobs SDK stores binary PDFs and metadata using strong consistency without network access", async () => {
  let stored;
  let requests = 0;
  const store = getStore({
    name: "order-pdfs-test", siteID: "test-site", token: "test-only-token",
    consistency: "strong", edgeURL: "https://cached.blobs.test", uncachedEdgeURL: "https://uncached.blobs.test",
    fetch: async (url, options) => {
      requests++;
      assert.equal(new URL(url).hostname, "uncached.blobs.test");
      const method = options.method.toUpperCase();
      const headers = new Headers(options.headers);
      if (method === "PUT") {
        assert.ok(options.body instanceof Blob);
        assert.equal(headers.get("if-none-match"), "*");
        stored = { data: Buffer.from(await options.body.arrayBuffer()), metadata: headers.get("x-amz-meta-user") };
        assert.equal(stored.data.subarray(0, 5).toString(), "%PDF-");
        return new Response(null, { headers: { etag: "test-etag" } });
      }
      if (!stored) return new Response(null, { status: 404 });
      return new Response(method === "HEAD" ? null : stored.data, {
        headers: { etag: "test-etag", "netlify-blobs-metadata": stored.metadata },
      });
    },
  });
  const link = await saveOrderPdf(args, { store, now: () => now });
  const pdf = await readOrderPdf(new URL(link.url).searchParams.get("token"), { store, now: () => now });
  assert.equal(pdf.status, 200);
  assert.equal(pdf.orderId, order.orderId);
  assert.deepEqual(pdf.data, stored.data);
  assert.equal(requests, 3);
});

test("PDF access stops at the exact expiry and does not depend on cleanup having run", async () => {
  const store = memoryStore();
  const link = await saveOrderPdf(args, { store, ...generation });
  const token = new URL(link.url).searchParams.get("token");
  const expiry = new Date(link.expiresAt).getTime();
  const allowed = await readOrderPdf(token, { store, now: () => new Date(expiry - 1) });
  assert.equal(allowed.status, 200);
  assert.deepEqual(allowed.data, fakePdf);
  const expired = await readOrderPdf(token, { store, now: () => new Date(expiry) });
  assert.deepEqual(expired, { status: 410 });
  assert.equal(store.entries.size, 0);
  assert.equal((await readOrderPdf(token, { store, now: () => now })).status, 404);
  await assert.rejects(() => saveOrderPdf(args, { store, ...generation, now: () => new Date(expiry) }),
    { code: "PDF_EXPIRED" });
});

test("expired PDF access remains denied when deletion fails", async () => {
  const store = memoryStore();
  const link = await saveOrderPdf(args, { store, ...generation });
  store.delete = async () => { throw new Error("Temporary storage fault"); };
  const result = await readOrderPdf(new URL(link.url).searchParams.get("token"), {
    store, now: () => new Date(link.expiresAt),
  });
  assert.deepEqual(result, { status: 410 });
});

test("invalid, missing, altered and corrupt PDF objects never reveal order data", async () => {
  const store = memoryStore();
  for (const token of ["", "../receipts", "20260230." + "A".repeat(43), "20261110." + "A".repeat(42)]) {
    assert.equal(pdfKey(token), null);
    assert.equal((await readOrderPdf(token, { store })).status, 400);
  }
  const link = await saveOrderPdf(args, { store, ...generation });
  const token = new URL(link.url).searchParams.get("token");
  const changed = token.slice(0, -1) + (token.endsWith("A") ? "B" : "A");
  assert.equal((await readOrderPdf(changed, { store })).status, 404);
  const entry = store.entries.get(pdfKey(token));
  entry.metadata.expiresAt = "2026-12-01T04:34:22.858Z";
  await assert.rejects(() => readOrderPdf(token, { store, now: () => now }), /metadata/);
  entry.metadata.expiresAt = link.expiresAt;
  entry.data = Buffer.from("<html>not a PDF</html>");
  await assert.rejects(() => readOrderPdf(token, { store, now: () => now }), /content/);
});

test("hourly cleanup handles multiple pages and deletes only expired PDFs", async () => {
  const store = memoryStore();
  const link = await saveOrderPdf(args, { store, ...generation });
  const laterArgs = { ...args, savedAt: new Date(now.getTime() + 2 * 86400000) };
  await saveOrderPdf(laterArgs, { store, ...generation });
  const cleanupTime = new Date(new Date(link.expiresAt).getTime() + 1);
  assert.equal(await removeExpiredOrderPdfs({ store, now: () => cleanupTime }), 1);
  assert.equal(store.entries.size, 1);
  assert.equal(cleanupConfig.schedule, "@hourly");
  store.delete = async () => { throw new Error("Temporary storage fault"); };
  await assert.rejects(() => removeExpiredOrderPdfs({ store, now: () => new Date(cleanupTime.getTime() + 3 * 86400000) }));
});

test("unacknowledged PDF writes fail explicitly rather than returning a dead link", async () => {
  const store = memoryStore();
  store.set = async () => ({ modified: false });
  await assert.rejects(() => saveOrderPdf(args, { store, ...generation }), /not acknowledged/);
});

test("PDF downloads require a valid token, support HEAD and never allow indexing or caching", async () => {
  const store = memoryStore();
  const link = await saveOrderPdf(args, { store, ...generation });
  const readPdf = token => readOrderPdf(token, { store, now: () => now });
  const response = await handlePdfRequest(new Request(link.url), { readPdf });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/pdf");
  assert.ok(response.headers.get("cache-control").includes("no-store"));
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.ok(response.headers.get("x-robots-tag").includes("noindex"));
  assert.ok(response.headers.get("content-disposition").includes(order.orderId));
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), fakePdf);
  const head = await handlePdfRequest(new Request(link.url, { method: "HEAD" }), { readPdf });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  const invalid = await handlePdfRequest(new Request(`${origin}/api/order-pdf?token=bad`), {
    readPdf: () => { throw new Error("Must not access storage"); },
  });
  assert.equal(invalid.status, 400);
  assert.equal((await handlePdfRequest(new Request(link.url, { method: "POST" }), { readPdf })).status, 405);
  assert.equal((await handlePdfRequest(new Request(link.url), { readPdf: async () => { throw new Error("Store down"); } })).status, 503);
});

async function submit(payload, { savePdf, acknowledge = true, site = origin } = {}) {
  return handleOrderRequest(new Request(`${site}/api/orders`, {
    method: "POST", headers: { Origin: site, "Content-Type": "application/json" }, body: JSON.stringify(payload),
  }), {
    env: { GOOGLE_SHEETS_WEBHOOK_URL: "https://script.google.com/macros/s/test/exec", ORDER_TRACKING_SECRET: secret },
    now: () => now, savePdf,
    readOfferSettings: async () => ({ offers: DEFAULT_OFFERS, version: null }),
    fetchImpl: async (_, options) => {
      const saved = JSON.parse(options.body).order;
      return Response.json({ ok: acknowledge, orderId: saved.orderId, createdAt: saved.createdAt });
    },
  });
}

test("only consented long orders create PDFs, after acknowledgement, and include the link in one bounded message", async () => {
  for (const site of [origin, "https://" + ["a".repeat(63), "b".repeat(63), "c".repeat(63), "d".repeat(61)].join(".")]) {
    let calls = 0;
    const payload = { ...input, customer: { ...input.customer, name: String.fromCharCode(0x800).repeat(80) } };
    const response = await submit(payload, {
      site, savePdf: async received => {
        calls++;
        assert.equal(received.order.items.length, 68);
        assert.equal(received.message, received.order.message.replace("\n", "\nOrder date & time: 2026-11-03 10:04:22 IST\n"));
        assert.equal(received.origin, site);
        assert.equal(received.secret, secret);
        return { url: `${site}/api/order-pdf?token=20261110.${"A".repeat(43)}`, expiresAt: "2026-11-10T04:34:22.858Z" };
      },
    });
    assert.equal(response.status, 200);
    assert.equal(calls, 1);
    const result = await response.json();
    assert.ok(result.summary.includes(result.pdf.url));
    assert.ok(result.summary.includes("expires 2026-11-10 10:04:22 IST"));
    const prepared = prepareOrderMessage(result.message, result.summary);
    assert.equal(prepared.isSummary, true);
    assert.ok(prepared.url.length <= 1800, `PDF summary exceeds the encoded budget: ${prepared.url.length}`);
    assert.equal(validatePdfLink(result.pdf, site).url, result.pdf.url);
  }
  for (const payload of [
    { ...input, cart: { 1: 1 } }, { ...input, pdfConsent: undefined },
    { ...input, pdfConsent: false }, { ...input, pdfConsent: "true" },
  ]) {
    const response = await submit(payload, { savePdf: () => { throw new Error("Must not store PDF"); } });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).pdf, undefined);
  }
  let uploaded = false;
  const failed = await submit(input, { acknowledge: false, savePdf: () => { uploaded = true; } });
  assert.equal(failed.status, 503);
  assert.equal(uploaded, false);
});

test("failed PDF generation or upload accurately reports that the order was saved and permits retry", async () => {
  for (const code of [undefined, "PDF_UNSUPPORTED_TEXT", "PDF_EXPIRED"]) {
    const response = await submit(input, { savePdf: async () => {
      const error = new Error("Test-only PDF failure"); error.code = code; throw error;
    } });
    assert.equal(response.status, 503);
    const result = await response.json();
    assert.ok(result.error.includes(`${order.orderId} is saved`));
    assert.equal(result.summary, undefined);
    assert.equal(result.pdf, undefined);
  }
});

test("the browser rejects foreign, malformed and ambiguous PDF links", () => {
  const valid = { url: `${origin}/api/order-pdf?token=20261110.${"A".repeat(43)}`, expiresAt: "2026-11-10T04:34:22.858Z" };
  for (const value of [
    null, {}, { ...valid, expiresAt: "2026-11-10" }, { ...valid, expiresAt: "invalid" },
    { ...valid, url: valid.url.replace(origin, "https://another.example") },
    { ...valid, url: "javascript:alert(1)" }, { ...valid, url: valid.url + "&token=another" },
    { ...valid, url: valid.url.replace("20261110", "20260230") },
    { ...valid, expiresAt: "2026-11-11T04:34:22.858Z" },
    { ...valid, url: valid.url.replace("/api/order-pdf", "/elsewhere") },
  ]) assert.throws(() => validatePdfLink(value, origin), /PDF link could not be confirmed/);
});
