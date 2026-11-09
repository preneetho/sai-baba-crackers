import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { createOrderDatabase } from "../netlify/lib/order-database.mjs";
import { handleCatalogue } from "../netlify/functions/catalogue.mjs";
import { handleVendorCatalogue } from "../netlify/functions/vendor-catalogue.mjs";
import { handleOrderRequest, buildOrder } from "../netlify/functions/orders.mjs";
import { createSession, unseal, vendorSettings } from "../netlify/lib/vendor-auth.mjs";
import { products } from "../vendor-app/catalog.mjs";
import { validCatalogue, catalogueProducts } from "../vendor-app/catalogue-model.mjs";

const engine = new PGlite();
const database = createOrderDatabase(drizzle({ client: engine }));
const origin = "https://vendor.example";
const now = new Date("2026-11-09T06:30:00.000Z");
const env = {
  ORDER_BACKEND: "netlify-db", ORDER_PDF_SECRET: "synthetic-pdf-secret-".repeat(3),
  VENDOR_APP_ORIGIN: origin, VENDOR_ALLOWED_EMAILS: "owner@example.com",
  VENDOR_GOOGLE_CLIENT_ID: "synthetic.apps.googleusercontent.com",
  VENDOR_GOOGLE_CLIENT_SECRET: "synthetic-secret",
  VENDOR_SESSION_SECRET: "synthetic-session-secret-".repeat(3),
};
const settings = vendorSettings(env);
const cookie = createSession({ sub: "synthetic-owner", email: "owner@example.com" }, settings, now.getTime());
const csrf = unseal(cookie, "session", settings, now.getTime()).csrf;
const options = { env, databaseFactory: async () => database, now: () => now.getTime() };
const base = { year: 2026, revision: 1, products: catalogueProducts(products) };
let migrationSeed;
function request(path, body, authenticated = true) {
  return new Request(origin + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { Origin: origin, "Content-Type": "application/json",
      ...(authenticated ? { Cookie: `${settings.sessionCookie}=${cookie}`, "X-Vendor-CSRF": csrf } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const edit = body => handleVendorCatalogue(request("/api/vendor-catalogue", body), options);
const publicList = () => handleCatalogue(request("/api/catalogue", undefined, false), options);
const payload = (revision = 1, year = 2026, id = 1) => ({
  requestId: `00000000-0000-4000-8000-${String(id).padStart(12, "0")}`,
  consent: true, cart: { 1: 2 }, catalogue: { year, revision },
  customer: { name: "Synthetic Customer", phone: "9876543210", address: "Synthetic address only",
    fulfilment: "pickup", preferredDate: "", notes: "" },
});
const submit = input => handleOrderRequest(request("/api/orders", input, false), {
  ...options, now: () => now, fetchImpl: async () => { throw new Error("No Sheets fallback"); },
});
const save = (year, expectedRevision, rows) => database.priceLists({
  action: "save", year, expectedRevision, products: catalogueProducts(rows),
}, "owner@example.com");
const copy = year => database.priceLists({
  action: "create", year, sourceYear: 2026, expectedRevision: 1,
}, "owner@example.com");
const activate = (year, revision = 1, expectedActiveYear = 2026) => database.priceLists({
  action: "activate", year, expectedRevision: revision, expectedActiveYear,
}, "owner@example.com");

before(async () => {
  const root = new URL("../netlify/database/migrations/", import.meta.url);
  for (const directory of (await readdir(root)).sort()) {
    await engine.exec(await readFile(new URL(`${directory}/migration.sql`, root), "utf8"));
  }
  migrationSeed = await database.activeCatalogue();
});
beforeEach(async () => {
  await engine.exec("truncate order_items, order_status_history, order_requests, catalogue_settings, catalogue_revisions, catalogue_years");
  await engine.exec("insert into catalogue_years values (2026, 1); insert into catalogue_settings values (1, 2026)");
  await engine.query("insert into catalogue_revisions (year, revision, products, actor) values (2026, 1, $1::jsonb, 'synthetic seed')",
    [JSON.stringify(migrationSeed.products)]);
});
after(async () => { await engine.close(); });

test("tracked migration seeds every original 2026 product, pack, category and price exactly", async () => {
  assert.deepEqual(migrationSeed, base);
  const response = await publicList();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), base);
  assert.equal((await handleCatalogue(request("/api/catalogue?year=2025"), options)).status, 400);
});

test("copying and editing another year never changes the active catalogue until explicit activation", async () => {
  const created = await edit({ action: "create", year: 2027, sourceYear: 2026, expectedRevision: 1 });
  assert.equal(created.status, 200);
  assert.equal((await created.json()).activeYear, 2026);
  const changed = catalogueProducts(products);
  changed[0] = { ...changed[0], price: 99.95, name: "Synthetic <product> & quote", category: "New category" };
  await save(2027, 1, changed);
  assert.deepEqual(await (await publicList()).json(), base);
  await activate(2027, 2);
  const active = await (await publicList()).json();
  assert.equal(active.year, 2027);
  assert.equal(active.revision, 2);
  assert.equal(active.products[0].price, 99.95);
  assert.equal(active.products[0].category, "New category");
  assert.deepEqual(await database.catalogueVersion(2027, 1), { ...base, year: 2027 });
  const history = (await engine.query("select actor from catalogue_revisions where year=2027 order by revision")).rows;
  assert.deepEqual(history.map(row => row.actor), ["owner@example.com", "owner@example.com"]);
});

test("stale edits, duplicate years, stale source versions and stale year switches cannot overwrite another vendor", async () => {
  await copy(2027);
  await save(2026, 1, products);
  await assert.rejects(save(2026, 1, products), { code: "CATALOGUE_CONFLICT" });
  await assert.rejects(copy(2027), { code: "CATALOGUE_CONFLICT" });
  await assert.rejects(copy(2028), { code: "CATALOGUE_CONFLICT" });
  await activate(2027);
  await assert.rejects(activate(2026, 2, 2026), { code: "CATALOGUE_CONFLICT" });
  assert.equal((await database.activeCatalogue()).year, 2027);
  assert.equal((await edit({ action: "save", year: 2026, expectedRevision: 1, products })).status, 409);
});

test("checkout uses database prices, integer paise and the active year; existing order snapshots never change", async () => {
  const old = buildOrder(payload(), now, base);
  await database.save(old);
  await copy(2027);
  const changed = catalogueProducts(products);
  changed[0].price = 19.99;
  await save(2027, 1, changed);
  await activate(2027, 2);
  const response = await submit({ ...payload(2, 2027, 2), price: 0, total: 0 });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.match(body.message, /\(2027\)/);
  assert.match(body.message, /2 packs x Rs.19.99 = Rs.39.98/);
  const rows = (await engine.query("select season, catalogue_revision, total_paise from order_requests order by order_id")).rows;
  assert.deepEqual(rows, [
    { season: 2026, catalogue_revision: 1, total_paise: 11900 },
    { season: 2027, catalogue_revision: 2, total_paise: 3398 },
  ]);
  const oldItem = (await engine.query("select unit_price_paise from order_items where order_id=$1", [old.orderId])).rows[0];
  assert.equal(oldItem.unit_price_paise, 7000);
});

test("new stale checkouts fail, but successful requests retry safely with their original prices after edits and year switches", async () => {
  const first = await submit(payload());
  assert.equal(first.status, 200);
  const saved = await first.json();
  await copy(2027);
  const changed = catalogueProducts(products);
  changed[0].price = 500;
  await save(2026, 1, changed);
  assert.equal((await submit(payload(1, 2026, 2))).status, 409);
  await activate(2027);
  const retry = await submit(payload());
  assert.equal(retry.status, 200);
  const retried = await retry.json();
  assert.equal(retried.message, saved.message);
  assert.equal((await engine.query("select count(*)::int as count from order_requests")).rows[0].count, 1);
  assert.equal((await submit({ ...payload(), customer: { ...payload().customer, notes: "changed" } })).status, 409);
  assert.equal((await submit(payload(1, 2027))).status, 409);
});

test("vendor catalogue requires approved login, origin and CSRF before opening the database", async () => {
  let calls = 0;
  const protectedOptions = { ...options, databaseFactory: async () => { calls++; return database; } };
  assert.equal((await handleVendorCatalogue(request("/api/vendor-catalogue", undefined, false), protectedOptions)).status, 401);
  const body = { action: "activate", year: 2026, expectedRevision: 1, expectedActiveYear: 2026 };
  for (const header of ["Origin", "X-Vendor-CSRF"]) {
    const req = request("/api/vendor-catalogue", body);
    req.headers.delete(header);
    assert.equal((await handleVendorCatalogue(req, protectedOptions)).status, 403);
  }
  assert.equal(calls, 0);
  assert.equal((await handleVendorCatalogue(request("/api/vendor-catalogue?year=2026&year=2027"), options)).status, 400);
  assert.equal((await handleVendorCatalogue(request("/api/vendor-catalogue"), {
    ...protectedOptions, now: () => now.getTime() + 9 * 3600000,
  })).status, 401);
  assert.equal(calls, 0);
});

test("invalid years, duplicate products, missing fields, fractional paise and oversized prices are rejected", async () => {
  for (const row of [
    { ...products[0], price: 1.001 }, { ...products[0], price: 100001 },
    { ...products[0], price: -1 }, { ...products[0], name: "" },
    { ...products[0], id: 0 }, { ...products[0], category: "bad\ncategory" },
  ]) {
    assert.equal(validCatalogue({ ...base, products: [row] }), false);
    assert.equal((await edit({ action: "save", year: 2026, expectedRevision: 1, products: [row] })).status, 400);
  }
  for (const rows of [[], [products[0], products[0]], Array.from({ length: 201 }, (_, index) => ({ ...products[0], id: index + 1 }))]) {
    assert.equal((await edit({ action: "save", year: 2026, expectedRevision: 1, products: rows })).status, 400);
  }
  assert.equal((await edit({ action: "create", year: 2027.5, sourceYear: 2026, expectedRevision: 1 })).status, 400);
  assert.equal((await submit({ ...payload(), catalogue: undefined })).status, 409);
});

test("database outages never serve the old static list as a success-shaped fallback", async () => {
  const failed = { ...options, databaseFactory: async () => { throw new Error("synthetic outage"); } };
  assert.equal((await handleCatalogue(request("/api/catalogue"), failed)).status, 503);
  assert.equal((await handleVendorCatalogue(request("/api/vendor-catalogue"), failed)).status, 503);
  assert.equal((await handleCatalogue(request("/api/catalogue"), {
    env: { GOOGLE_SHEETS_WEBHOOK_URL: "https://script.google.com/macros/s/test/exec", ORDER_TRACKING_SECRET: "synthetic-only-".repeat(3) },
  })).status, 200);
});

test("the full 200-product Unicode price list fits the update bound and snapshots every checkout line", async () => {
  const rows = Array.from({ length: 200 }, (_, index) => ({
    id: index + 1, name: "\u0915".repeat(120), brand: "\u0916".repeat(120),
    unit: "\u0917".repeat(120), category: "\u0918".repeat(120), price: 0.01,
  }));
  const update = { action: "save", year: 2026, expectedRevision: 1, products: rows };
  assert.ok(Buffer.byteLength(JSON.stringify(update)) > 256000);
  assert.equal((await edit(update)).status, 200);
  const response = await submit({ ...payload(2), cart: Object.fromEntries(rows.map(row => [row.id, 1])) });
  assert.equal(response.status, 200);
  assert.ok((await response.json()).message.length > 65536);
  assert.equal((await engine.query("select count(*)::int as count from order_items")).rows[0].count, 200);
});

test("a late database error rolls back both the new revision and current-version pointer", async () => {
  await engine.exec(`create function reject_revision_pointer() returns trigger language plpgsql as $$
    begin raise exception 'synthetic failure'; end; $$;
    create trigger reject_revision_pointer before update on catalogue_years
      for each row execute function reject_revision_pointer()`);
  try {
    await assert.rejects(save(2026, 1, products));
    assert.equal((await database.activeCatalogue()).revision, 1);
    assert.equal((await engine.query("select count(*)::int as count from catalogue_revisions")).rows[0].count, 1);
  } finally {
    await engine.exec("drop trigger reject_revision_pointer on catalogue_years; drop function reject_revision_pointer()");
  }
});
