import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { createOrderDatabase, getOrderDatabase } from "../netlify/lib/order-database.mjs";
import { orderBackend } from "../netlify/lib/order-backend.mjs";
import { buildOrder, handleOrderRequest } from "../netlify/functions/orders.mjs";
import { handleVendorOrders } from "../netlify/functions/vendor-orders.mjs";
import { createSession, unseal, vendorSettings } from "../netlify/lib/vendor-auth.mjs";
import { products, vendor } from "../vendor-app/catalog.mjs";

const engine = new PGlite();
const database = createOrderDatabase(drizzle({ client: engine }));
const now = new Date("2026-11-09T06:30:00.000Z");
const origin = "https://vendor.example";
const env = {
  ORDER_BACKEND: "netlify-db", ORDER_PDF_SECRET: "test-only-pdf-secret-".repeat(3),
  VENDOR_APP_ORIGIN: origin, VENDOR_ALLOWED_EMAILS: "owner@example.com",
  VENDOR_GOOGLE_CLIENT_ID: "test.apps.googleusercontent.com",
  VENDOR_GOOGLE_CLIENT_SECRET: "test-only-google-secret",
  VENDOR_SESSION_SECRET: "test-only-session-secret-".repeat(3),
};
const settings = vendorSettings(env);
const cookie = createSession({ sub: "test-vendor", email: "owner@example.com" }, settings, now.getTime());
const csrf = unseal(cookie, "session", settings, now.getTime()).csrf;
const id = number => `00000000-0000-4000-8000-${number.toString(16).padStart(12, "0")}`;
const input = (number = 1) => ({
  requestId: id(number), consent: true, cart: { 1: 2 }, catalogue: { year: 2026, revision: 1 },
  customer: {
    name: "Synthetic Customer", phone: "9876543210", address: "Synthetic test address only",
    fulfilment: "pickup", preferredDate: "", notes: "<script>test only</script>",
  },
});
const build = (number = 1, time = now) => buildOrder(input(number), time);
const forbiddenFetch = async () => { throw new Error("Unexpected Sheets or external network access"); };
const factory = async () => database;
function request(path = "/api/orders", body, authenticated = false) {
  return new Request(`${origin}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Origin: origin, "Content-Type": "application/json",
      ...(authenticated ? { Cookie: `${settings.sessionCookie}=${cookie}`, "X-Vendor-CSRF": csrf } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const submit = (body, overrides = {}) => handleOrderRequest(request("/api/orders", body), {
  env, now: () => now, fetchImpl: forbiddenFetch, databaseFactory: factory, ...overrides,
});
const dashboard = (path = "/api/vendor-orders", body, overrides = {}) => handleVendorOrders(request(path, body, true), {
  env, now: () => now.getTime(), fetchImpl: forbiddenFetch, databaseFactory: factory, ...overrides,
});
const count = async table => Number((await engine.query(`select count(*) as count from ${table}`)).rows[0].count);

test("database initialization retries failed configuration and shares one adapter across concurrent calls", async () => {
  const previousUrl = process.env.NETLIFY_DB_URL;
  const previousDriver = process.env.NETLIFY_DB_DRIVER;
  try {
    delete process.env.NETLIFY_DB_URL;
    await assert.rejects(getOrderDatabase(), { name: "MissingDatabaseConnectionError" });
    process.env.NETLIFY_DB_URL = "postgresql://synthetic:synthetic@db.example.invalid/synthetic";
    process.env.NETLIFY_DB_DRIVER = "server";
    const repositories = await Promise.all(Array.from({ length: 6 }, () => getOrderDatabase()));
    assert.ok(repositories.every(repository => repository === repositories[0]));
    for (const method of ["ready", "save", "dashboard"]) assert.equal(typeof repositories[0][method], "function");
  } finally {
    if (previousUrl === undefined) delete process.env.NETLIFY_DB_URL;
    else process.env.NETLIFY_DB_URL = previousUrl;
    if (previousDriver === undefined) delete process.env.NETLIFY_DB_DRIVER;
    else process.env.NETLIFY_DB_DRIVER = previousDriver;
  }
});

before(async () => {
  const root = new URL("../netlify/database/migrations/", import.meta.url);
  for (const directory of (await readdir(root)).sort()) {
    await engine.exec(await readFile(new URL(`${directory}/migration.sql`, root), "utf8"));
  }
});
beforeEach(async () => {
  await engine.exec("truncate order_items, order_status_history, order_requests");
});
after(async () => { await engine.close(); });

test("backend selection is explicit, defaults to Sheets and never silently falls back", () => {
  assert.equal(orderBackend({}), null);
  assert.equal(orderBackend({ ...env, ORDER_BACKEND: "typo" }), null);
  assert.equal(orderBackend({ ...env, ORDER_PDF_SECRET: "short" }), null);
  assert.equal(orderBackend(env).name, "netlify-db");
  const sheet = {
    GOOGLE_SHEETS_WEBHOOK_URL: "https://script.google.com/macros/s/test/exec",
    ORDER_TRACKING_SECRET: "test-only-sheet-secret-".repeat(2),
  };
  assert.equal(orderBackend(sheet).name, "sheets");
  assert.equal(orderBackend({ ...sheet, ...env }).name, "netlify-db");
});

test("tracked SQL migrations add order tables without altering existing telemetry", async () => {
  await database.ready();
  assert.equal(await count("telemetry_events"), 0);
  const tables = (await engine.query("select tablename from pg_tables where schemaname = 'public'")).rows.map(row => row.tablename);
  for (const name of ["order_requests", "order_items", "order_status_history", "telemetry_events"]) assert.ok(tables.includes(name));
});

test("submission atomically snapshots line items, season, literal text and integer-paise amounts", async () => {
  const order = build();
  assert.deepEqual(await database.save(order), { ok: true, orderId: order.orderId, createdAt: order.createdAt });
  const row = (await engine.query("select * from order_requests")).rows[0];
  assert.equal(row.season, Number(vendor.year));
  assert.equal(row.notes, order.customer.notes);
  assert.equal(row.total_paise, Math.round(order.amounts.total * 100));
  assert.equal(row.fingerprint, order.fingerprint);
  const item = (await engine.query("select * from order_items")).rows[0];
  assert.equal(item.name, products[0].name);
  assert.equal(item.unit_price_paise, products[0].price * 100);
  assert.equal(item.quantity, 2);
  const detail = await database.dashboard({ action: "vendor-detail", orderId: order.orderId });
  assert.equal(detail.order.createdAt, order.createdAt);
  assert.equal(detail.order.total, order.amounts.total);
  assert.equal(detail.order.notes, order.customer.notes);
  assert.ok(detail.order.items.includes(products[0].name));
  assert.equal(await count("order_status_history"), 1);
});

test("retries keep the original timestamp and vendor status without duplicate rows or audit entries", async () => {
  const order = build();
  await database.save(order);
  await database.dashboard({
    action: "vendor-status", orderId: order.orderId, expectedStatus: "New", status: "Confirmed",
  }, "owner@example.com");
  const result = await database.save(build(1, new Date(now.getTime() + 86400000)));
  assert.equal(result.createdAt, order.createdAt);
  assert.equal((await database.dashboard({ action: "vendor-detail", orderId: order.orderId })).order.status, "Confirmed");
  assert.equal(await count("order_requests"), 1);
  assert.equal(await count("order_items"), 1);
  assert.equal(await count("order_status_history"), 2);
});

test("different details with the same request ID are a conflict and never overwrite the order", async () => {
  const order = build();
  await database.save(order);
  const changed = input();
  changed.cart = { 1: 3 };
  assert.deepEqual(await database.save(buildOrder(changed, now)), { ok: false, error: "CONFLICT" });
  assert.equal((await engine.query("select quantity from order_items")).rows[0].quantity, 2);
});

test("simultaneous identical submissions record one request and one set of items", async () => {
  const order = build();
  const results = await Promise.all(Array.from({ length: 6 }, () => database.save(order)));
  assert.ok(results.every(result => result.ok && result.createdAt === order.createdAt));
  assert.equal(await count("order_requests"), 1);
  assert.equal(await count("order_items"), 1);
  assert.equal(await count("order_status_history"), 1);
});

test("a failed item write rolls back the parent request and initial audit entry", async () => {
  const order = build();
  order.items[0].quantity = 0;
  await assert.rejects(() => database.save(order));
  for (const table of ["order_requests", "order_items", "order_status_history"]) assert.equal(await count(table), 0);
  assert.equal((await database.save(build())).ok, true);
});

test("competing status changes have one winner and record the authenticated actor", async () => {
  const order = build();
  await database.save(order);
  const results = await Promise.all(["Confirmed", "Cancelled"].map(status => database.dashboard({
    action: "vendor-status", orderId: order.orderId, status, expectedStatus: "New",
  }, "owner@example.com")));
  assert.equal(results.filter(result => result.ok).length, 1);
  assert.equal(results.filter(result => result.error === "STATUS_CONFLICT").length, 1);
  const audit = (await engine.query("select * from order_status_history where from_status is not null")).rows;
  assert.equal(audit.length, 1);
  assert.equal(audit[0].actor, "owner@example.com");
  assert.equal(audit[0].from_status, "New");
});

test("status and audit writes roll back together if the audit cannot be saved", async () => {
  const order = build();
  await database.save(order);
  await engine.exec("alter table order_status_history add constraint test_actor check (actor <> 'blocked@example.com')");
  try {
    await assert.rejects(() => database.dashboard({
      action: "vendor-status", orderId: order.orderId, status: "Confirmed", expectedStatus: "New",
    }, "blocked@example.com"));
    assert.equal((await database.dashboard({ action: "vendor-detail", orderId: order.orderId })).order.status, "New");
    assert.equal(await count("order_status_history"), 1);
  } finally {
    await engine.exec("alter table order_status_history drop constraint test_actor");
  }
});

test("paginated lists use newest-first ordering and filter-wide counts/value excluding cancelled requests", async () => {
  for (let number = 1; number <= 51; number++) await database.save(build(number, new Date(now.getTime() + number * 1000)));
  await database.dashboard({
    action: "vendor-status", orderId: build(51).orderId, status: "Cancelled", expectedStatus: "New",
  }, "owner@example.com");
  const list = await database.dashboard({ action: "vendor-list", query: "", status: "", page: 2 });
  assert.equal(list.total, 51);
  assert.equal(list.orders.length, 25);
  assert.equal(list.orders[0].orderId, build(26).orderId);
  assert.equal(list.stats.Cancelled, 1);
  assert.equal(list.stats.New, 50);
  assert.equal(list.stats.requestValue, build().amounts.total * 50);
  const filtered = await database.dashboard({ action: "vendor-list", query: "+91 98765 43210", status: "New", page: 3 });
  assert.equal(filtered.total, 50);
  assert.equal(filtered.orders.length, 0);
  assert.equal(filtered.stats.Cancelled, 0);
});

test("search treats SQL metacharacters literally and never interprets customer text as SQL", async () => {
  const customer = input();
  customer.customer.name = "Synthetic_% O'Reilly";
  await database.save(buildOrder(customer, now));
  const find = query => database.dashboard({ action: "vendor-list", query, status: "", page: 1 });
  assert.equal((await find("_%")).total, 1);
  assert.equal((await find("O'Reilly")).total, 1);
  assert.equal((await find("' OR 1=1 --")).total, 0);
  assert.equal((await find("\\")).total, 0);
});

test("database pagination and API counts continue beyond the old 10,000-row Sheet cap", async () => {
  await engine.exec(`insert into order_requests
    (order_id, fingerprint, season, created_at, status, name, phone, address, fulfilment,
     preferred_date, notes, subtotal_paise, discount_percent, discount_paise, delivery_charge_paise, total_paise)
    select 'SBC-00000000-0000-4000-8000-' || upper(lpad(to_hex(n), 12, '0')),
      repeat('a',64), 2026, '2026-11-09T06:30:00Z', 'New', 'Synthetic fixture', '9876543210',
      'Synthetic address', 'pickup', '', '', 10000, 15, 1500, 0, 8500
    from generate_series(1, 10001) n`);
  const response = await dashboard("/api/vendor-orders?page=401");
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.total, 10001);
  assert.equal(result.orders.length, 1);
  assert.equal(result.stats.requestValue, 850085);
  assert.equal((await dashboard("/api/vendor-orders?page=100001")).status, 400);
});

test("database API works without Sheet credentials and only returns acknowledged order data", async () => {
  assert.equal((await submit(undefined)).status, 200);
  const response = await submit(input());
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.match(body.summary, /private order register/);
  assert.doesNotMatch(body.summary, /Google Sheet/);
  assert.ok(!JSON.stringify(body).includes(env.ORDER_PDF_SECRET));
  const list = await (await dashboard()).json();
  for (const field of ["fingerprint", "address", "notes", "items", "actor", "season"]) assert.equal(list.orders[0][field], undefined);
  const orderId = body.orderId;
  const updated = await dashboard("/api/vendor-orders", { orderId, status: "Confirmed", expectedStatus: "New" });
  assert.equal(updated.status, 200);
  assert.equal((await updated.json()).order.status, "Confirmed");
  assert.equal((await dashboard("/api/vendor-orders", { orderId, status: "Cancelled", expectedStatus: "New" })).status, 409);
  assert.equal((await dashboard(`/api/vendor-orders?orderId=${build(2).orderId}`)).status, 404);
});

test("database access still requires an approved session and CSRF before invoking the store", async () => {
  let calls = 0;
  const databaseFactory = async () => { calls++; return database; };
  assert.equal((await handleVendorOrders(request("/api/vendor-orders"), {
    env, now: () => now.getTime(), databaseFactory,
  })).status, 401);
  const bad = request("/api/vendor-orders", {
    orderId: build().orderId, status: "Confirmed", expectedStatus: "New",
  }, true);
  bad.headers.delete("X-Vendor-CSRF");
  assert.equal((await handleVendorOrders(bad, { env, now: () => now.getTime(), databaseFactory })).status, 403);
  assert.equal(calls, 0);
});

test("database outages fail explicitly without falling back to Sheets or returning WhatsApp success", async () => {
  const databaseFactory = async () => { throw new Error("Synthetic connection failure"); };
  for (const body of [undefined, input()]) {
    const response = await submit(body, { databaseFactory });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).message, undefined);
  }
  assert.equal((await dashboard("/api/vendor-orders", undefined, { databaseFactory })).status, 503);
  const response = await submit(input(), { env: { ...env, ORDER_BACKEND: "typo" }, databaseFactory: factory });
  assert.equal(response.status, 503);
  assert.equal(await count("order_requests"), 0);
});

test("long-order PDF retries retain the database acknowledgement time and use an independent PDF secret", async () => {
  const long = { ...input(), pdfConsent: true, cart: Object.fromEntries(products.map(product => [product.id, 1])) };
  const failed = await submit(long, { savePdf: async () => { throw new Error("Synthetic PDF failure"); } });
  assert.equal(failed.status, 503);
  assert.match((await failed.json()).error, /is saved/);
  let calls = 0;
  const response = await submit(long, {
    now: () => new Date(now.getTime() + 10000),
    savePdf: async args => {
      calls++;
      assert.equal(args.secret, env.ORDER_PDF_SECRET);
      assert.equal(args.savedAt.toISOString(), now.toISOString());
      return { url: `${origin}/api/order-pdf?token=20261116.${"a".repeat(43)}`, expiresAt: "2026-11-16T06:30:00.000Z" };
    },
  });
  assert.equal(response.status, 200);
  assert.equal(calls, 1);
  assert.equal(await count("order_requests"), 1);
  assert.equal(await count("order_items"), products.length);
  assert.equal(await count("order_status_history"), 1);
});
