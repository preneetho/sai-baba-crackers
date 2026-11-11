import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_OFFERS, validOffers, normalizeCoupon } from "../vendor-app/offers-model.mjs";
import { pricing, createRequirement } from "../vendor-app/order.mjs";
import { products } from "../vendor-app/catalog.mjs";
import { readOffers, saveOffers } from "../netlify/lib/offer-settings.mjs";
import { handleOffers } from "../netlify/functions/offers.mjs";
import { handleVendorOffers } from "../netlify/functions/vendor-offers.mjs";
import { handleOrderRequest, buildOrder } from "../netlify/functions/orders.mjs";
import { createSession, unseal, vendorSettings } from "../netlify/lib/vendor-auth.mjs";

const offers = {
  coupons: [{ code: "DIWALI15", percent: 15, enabled: true }, { code: "OLD20", percent: 20, enabled: false }],
  freeDeliveryMinimum: 2500, deliveryFee: 100,
};
const now = new Date("2026-11-11T03:00:00Z");
const origin = "https://vendor.example";
const env = {
  ORDER_BACKEND: "sheets",
  GOOGLE_SHEETS_WEBHOOK_URL: "https://script.google.com/macros/s/test/exec",
  ORDER_TRACKING_SECRET: "synthetic-only-order-secret-".repeat(3),
  VENDOR_APP_ORIGIN: origin, VENDOR_ALLOWED_EMAILS: "owner@example.com",
  VENDOR_GOOGLE_CLIENT_ID: "synthetic.apps.googleusercontent.com",
  VENDOR_GOOGLE_CLIENT_SECRET: "synthetic-only-secret",
  VENDOR_SESSION_SECRET: "synthetic-only-session-secret-".repeat(3),
};
const settings = vendorSettings(env);
const cookie = createSession({ sub: "synthetic", email: "owner@example.com" }, settings, now.getTime());
const csrf = unseal(cookie, "session", settings, now.getTime()).csrf;
function request(path, body, headers = {}) {
  return new Request(origin + path, { method: body === undefined ? "GET" : "POST",
    headers: { Origin: origin, "Content-Type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
function memoryStore() {
  let record = null;
  let revision = 0;
  return {
    async getWithMetadata(key, options) {
      assert.equal(key, "checkout-offers");
      assert.deepEqual(options, { type: "json", consistency: "strong" });
      return structuredClone(record);
    },
    async setJSON(key, data, options) {
      assert.equal(key, "checkout-offers");
      if (options.onlyIfNew ? record !== null : record?.etag !== options.onlyIfMatch) return { modified: false };
      record = { data: structuredClone(data), etag: `version-${++revision}` };
      return { modified: true, etag: record.etag };
    },
  };
}
const customer = { name: "Synthetic Customer", phone: "9876543210", address: "Synthetic address only",
  fulfilment: "delivery", preferredDate: "", notes: "" };
const input = { requestId: "12345678-1234-4234-8234-123456789abc", consent: true, shareConsent: true,
  cart: { 1: 2, 12: 1 }, customer, couponCode: "diwali15", offerVersion: "version-1" };

test("coupon discounts are opt-in, normalize codes, round once and reject invalid or disabled codes", () => {
  assert.equal(pricing(input.cart, products, offers).discount, 0);
  assert.equal(normalizeCoupon("  diwali15 "), "DIWALI15");
  const result = pricing(input.cart, products, offers, "diwali15", "delivery");
  assert.deepEqual(result, { subtotal: 370, discount: 55.5, discountPercent: 15, couponCode: "DIWALI15",
    billed: 314.5, freeDeliveryRemaining: 2185.5, deliveryCharge: 100, total: 414.5 });
  for (const code of ["OLD20", "UNKNOWN", "DIWALI15,OLD20", {}, null]) {
    assert.throws(() => pricing(input.cart, products, offers, code), /coupon/i);
  }
  const fractional = pricing({ 1: 1 }, [{ ...products[0], price: 0.1 }], offers, "DIWALI15");
  assert.equal(fractional.discount, 0.02);
  assert.equal(fractional.total, 0.08);
  const free = { ...offers, coupons: [{ code: "FREE100", percent: 100, enabled: true }] };
  assert.equal(pricing(input.cart, products, free, "FREE100", "delivery").total, 100);
});

test("free-delivery eligibility uses post-discount merchandise paise at and either side of the threshold", () => {
  for (const [price, remaining, fee] of [[2499.99, 0.01, 100], [2500, 0, 0], [2500.01, 0, 0]]) {
    const list = [{ ...products[0], price }];
    const result = pricing({ 1: 1 }, list, offers, "", "delivery");
    assert.equal(result.freeDeliveryRemaining, remaining);
    assert.equal(result.deliveryCharge, fee);
    assert.equal(pricing({ 1: 1 }, list, offers, "", "pickup").deliveryCharge, 0);
  }
  const result = pricing({ 31: 1 }, products, offers, "DIWALI15", "delivery");
  assert.equal(result.billed, 2550);
  assert.equal(result.deliveryCharge, 0);
  const reduced = pricing({ 31: 1 }, products, { ...offers, freeDeliveryMinimum: 2600 }, "DIWALI15", "delivery");
  assert.equal(reduced.freeDeliveryRemaining, 50);
  assert.equal(reduced.deliveryCharge, 100);
  assert.equal(pricing(input.cart, products, DEFAULT_OFFERS, "", "delivery").deliveryCharge, 0);
  const zeroFee = pricing(input.cart, products, { ...offers, deliveryFee: 0 }, "", "delivery");
  assert.equal(zeroFee.deliveryCharge, 0);
  assert.equal(zeroFee.freeDeliveryRemaining, 0);
});

test("offer validation rejects duplicates, noninteger discounts, negative/sub-paise amounts and unexpected fields", () => {
  for (const invalid of [null, [], { ...offers, coupons: [...offers.coupons, offers.coupons[0]] },
    { ...offers, coupons: [{ code: "A", percent: 15, enabled: true }] },
    { ...offers, coupons: [{ code: "VALID", percent: 1.5, enabled: true }] },
    { ...offers, coupons: [{ code: "VALID", percent: 0, enabled: true }] },
    { ...offers, coupons: [{ code: "VALID", percent: 101, enabled: true }] },
    { ...offers, freeDeliveryMinimum: 1.001 }, { ...offers, deliveryFee: -1 }, { ...offers, extra: true }]) {
    assert.equal(validOffers(invalid), false);
  }
});

test("offer persistence defaults only when absent and conditional updates reject stale vendors", async () => {
  const store = memoryStore();
  assert.deepEqual(await readOffers({ store }), { offers: DEFAULT_OFFERS, version: null });
  const results = await Promise.allSettled([saveOffers(offers, null, { store }), saveOffers(offers, null, { store })]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(results.find(result => result.status === "rejected").reason.code, "OFFERS_CONFLICT");
  const current = await readOffers({ store });
  assert.deepEqual((await (await handleOffers(request("/api/offers"), { store })).json()), current);
  await saveOffers(DEFAULT_OFFERS, current.version, { store });
  await assert.rejects(saveOffers(offers, current.version, { store }), /changed/);
  for (const entry of [{ data: null, etag: "v1" }, { data: offers }, { data: offers, etag: null }]) {
    assert.equal((await handleOffers(request("/api/offers"), {
      store: { async getWithMetadata() { return entry; } },
    })).status, 503);
  }
  await assert.rejects(saveOffers(offers, null, { store: { async setJSON() { return { modified: true }; } } }), /acknowledged/);
});

test("vendor offer edits require approved authentication, origin, CSRF, valid JSON and expected version", async () => {
  const store = memoryStore();
  const call = (body, headers = {}) => handleVendorOffers(request("/api/vendor-offers", body, {
    Cookie: `${settings.sessionCookie}=${cookie}`, "X-Vendor-CSRF": csrf, ...headers,
  }), { env, now: () => now.getTime(), store });
  assert.equal((await handleVendorOffers(request("/api/vendor-offers"), { env, store })).status, 401);
  assert.equal((await call({ offers, expectedVersion: null }, { Origin: "https://evil.example" })).status, 403);
  assert.equal((await call({ offers, expectedVersion: null }, { "X-Vendor-CSRF": "incorrect" })).status, 403);
  assert.equal((await call({ offers, expectedVersion: null }, { "Content-Type": "text/plain" })).status, 415);
  assert.equal((await call({ offers })).status, 400);
  assert.equal((await call({ offers, expectedVersion: null, extra: true })).status, 400);
  assert.equal((await call({ offers, expectedVersion: null }, { "Content-Length": "8193" })).status, 413);
  const saved = await call({ offers, expectedVersion: null });
  assert.equal(saved.status, 200);
  assert.match(saved.headers.get("cache-control"), /no-store/);
  assert.equal((await call({ offers, expectedVersion: null })).status, 409);
  assert.deepEqual((await (await call()).json()).offers, offers);
});

test("checkout recalculates coupons and fees, rejects changed/unavailable rules before writes and snapshots exact amounts", async () => {
  let recorded;
  let snapshot;
  const options = { env, now: () => now,
    readOfferSettings: async () => ({ offers, version: "version-1" }),
    saveShare: async ({ order }) => {
      snapshot = order;
      return { orderId: order.orderId, url: `${origin}/request/20261118.${"a".repeat(43)}`,
        expiresAt: "2026-11-18T03:00:00.000Z" };
    },
    fetchImpl: async (url, options) => {
      recorded = JSON.parse(options.body).order;
      return Response.json({ ok: true, orderId: recorded.orderId, createdAt: recorded.createdAt });
    } };
  const result = await handleOrderRequest(request("/api/orders", { ...input, total: 1, discountPercent: 99, deliveryCharge: 0 }), options);
  assert.equal(result.status, 200);
  assert.equal(recorded.amounts.total, 414.5);
  assert.equal(recorded.amounts.couponCode, "DIWALI15");
  assert.equal(snapshot.couponCode, "DIWALI15");
  assert.equal(snapshot.deliveryCharge, 100);
  assert.equal(snapshot.fulfilment, "Home delivery");
  const text = (await result.json()).message;
  assert.match(text, /DIWALI15/);
  assert.match(text, /Delivery fee: Rs\.100\.00/);
  assert.match(text, /Delivery option: Home delivery/);
  assert.doesNotMatch(text, /Free home delivery/);
  const forbidden = async () => { throw new Error("Must not write rejected checkout"); };
  const changed = await handleOrderRequest(request("/api/orders", { ...input, offerVersion: "stale" }), { ...options, fetchImpl: forbidden });
  assert.equal(changed.status, 409);
  assert.equal((await changed.json()).offersChanged, true);
  const unavailable = await handleOrderRequest(request("/api/orders", input), {
    ...options, fetchImpl: forbidden, readOfferSettings: async () => { throw new Error("Synthetic outage"); },
  });
  assert.equal(unavailable.status, 503);
  assert.equal((await handleOrderRequest(request("/api/orders", { ...input, couponCode: "OLD20" }), { ...options, fetchImpl: forbidden })).status, 400);
  assert.notEqual(buildOrder(input, now, undefined, offers).fingerprint,
    buildOrder({ ...input, couponCode: "" }, now, undefined, offers).fingerprint);
  assert.match(createRequirement(input.cart, customer, "2026-11-11", undefined, offers, "DIWALI15"), /Estimated total: Rs\.414\.50/);
});
