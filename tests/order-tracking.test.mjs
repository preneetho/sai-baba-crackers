import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { buildOrder, handleOrderRequest, config } from "../netlify/functions/orders.mjs";
import { products } from "../vendor-app/catalog.mjs";
import { prepareOrderMessage, whatsappUrl, MAX_WHATSAPP_URL_LENGTH } from "../vendor-app/order.mjs";

const now = new Date("2026-11-02T10:00:00.000Z");
const input = {
  requestId: "12345678-1234-4234-8234-123456789abc",
  cart: { 1: 2, 12: 1 },
  consent: true,
  customer: {
    name: "Example Customer", phone: "9876543210",
    address: "Flat 12, Example Street\nHyderabad 500018",
    fulfilment: "delivery", preferredDate: "2026-11-05", notes: "Please call first.",
  },
};
const env = {
  GOOGLE_SHEETS_WEBHOOK_URL: "https://script.google.com/macros/s/test-deployment/exec",
  ORDER_TRACKING_SECRET: "test-only-not-a-real-credential-".repeat(2),
};
const site = "https://saibabacrackers.netlify.app";
function request(body = input, headers = {}, method = "POST") {
  return new Request(`${site}/api/orders`, {
    method,
    headers: { Origin: site, "Content-Type": "application/json", ...headers },
    ...(method === "GET" ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
}
function handle(req, fetchImpl = async () => {
  const order = buildOrder(input, now);
  return Response.json({ ok: true, orderId: order.orderId, createdAt: order.createdAt });
}, overrides = {}) {
  return handleOrderRequest(req, { env, now: () => now, fetchImpl, ...overrides });
}

test("server recalculates catalogue amounts, ignores client totals and creates a stable reference", () => {
  const order = buildOrder({ ...input, total: 1, status: "Completed", createdAt: "yesterday" }, now);
  assert.equal(order.orderId, "SBC-12345678-1234-4234-8234-123456789ABC");
  assert.equal(order.status, "New");
  assert.equal(order.createdAt, now.toISOString());
  assert.deepEqual(order.amounts, {
    subtotal: 370, discount: 55.5, total: 314.5, discountPercent: 15, deliveryCharge: 0,
  });
  assert.equal(order.items[0].price, 70);
  assert.ok(order.message.startsWith(`Order ID: ${order.orderId}\n`));
  assert.ok(order.message.includes("Free home delivery"));
  assert.ok(order.message.includes("Delivery fee: Rs.0.00 (FREE)"));
  assert.ok(order.message.includes("Estimated total: Rs.314.50"));
  assert.equal(buildOrder(input, new Date("2026-11-03T10:00:00Z")).fingerprint, order.fingerprint);
  assert.notEqual(buildOrder({ ...input, customer: { ...input.customer, notes: "New notes" } }, now).fingerprint,
    order.fingerprint);
});

test("server rejects invalid references, missing consent, invalid selections and customer details", () => {
  for (const change of [
    { requestId: "not-an-id" }, { consent: false }, { consent: undefined },
    { cart: {} }, { cart: { 1: 100 } }, { cart: { 999: 1 } }, { customer: null },
    { customer: { ...input.customer, fulfilment: "" } },
    { customer: { ...input.customer, address: "" } },
  ]) assert.throws(() => buildOrder({ ...input, ...change }, now));
  assert.throws(() => buildOrder(null, now));
  assert.throws(() => buildOrder([], now));
});

test("Google Sheet acknowledgement is required before exposing WhatsApp message", async () => {
  let recorded;
  const response = await handle(request(), async (url, options) => {
    assert.equal(url, env.GOOGLE_SHEETS_WEBHOOK_URL);
    assert.equal(options.method, "POST");
    assert.ok(options.signal instanceof AbortSignal);
    const body = JSON.parse(options.body);
    assert.equal(body.secret, env.ORDER_TRACKING_SECRET);
    recorded = body.order;
    return Response.json({ ok: true, orderId: recorded.orderId, createdAt: recorded.createdAt });
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.orderId, recorded.orderId);
  assert.equal(body.message, recorded.message.replace("\n", "\nOrder date & time: 2026-11-02 15:30:00 IST\n"));
  assert.ok(body.summary.startsWith(`Order ID: ${recorded.orderId}\n`));
  assert.ok(body.summary.includes("Order date & time: 2026-11-02 15:30:00 IST"));
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.ok(!JSON.stringify(body).includes(env.ORDER_TRACKING_SECRET));
});

test("long orders send one bounded server-generated summary while retaining every saved item and customer detail", async () => {
  for (const fulfilment of ["delivery", "pickup"]) {
    const payload = {
      ...input, cart: Object.fromEntries(products.map(product => [product.id, 99])),
      total: 0, summary: "Do not trust client summaries",
      customer: {
        ...input.customer, fulfilment, name: String.fromCharCode(0x800).repeat(80),
        address: "A".repeat(500), notes: "N".repeat(500),
      },
    };
    let recorded;
    const response = await handle(request(payload), async (_, options) => {
      recorded = JSON.parse(options.body).order;
      return Response.json({ ok: true, orderId: recorded.orderId, createdAt: recorded.createdAt });
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(recorded.items.length, 68);
    assert.equal(recorded.customer.address, payload.customer.address);
    assert.equal(recorded.customer.notes, payload.customer.notes);
    assert.equal(result.message, recorded.message.replace("\n", "\nOrder date & time: 2026-11-02 15:30:00 IST\n"));
    for (const product of products) assert.ok(result.message.includes(`#${product.id} ${product.name}`));
    for (const content of [
      `Order ID: ${recorded.orderId}`, `Customer: ${payload.customer.name}`,
      "Mobile: +91 9876543210", "Items: 68 products (6732 packs)",
      `Delivery option: ${fulfilment === "delivery" ? "Free home delivery" : "Store pickup"}`,
      `Estimated total: Rs.${recorded.amounts.total.toFixed(2)}`,
      "shop's Google Sheet under this ID", "not a confirmed order", "No payment made.",
    ]) assert.ok(result.summary.includes(content), content);
    assert.ok(!result.summary.includes(payload.summary));
    assert.ok(!result.summary.includes(payload.customer.address));
    assert.ok(!result.summary.includes(payload.customer.notes));
    assert.ok(!result.summary.includes("#1 Ground Chakkar Big"));
    assert.ok(whatsappUrl(result.summary).length <= MAX_WHATSAPP_URL_LENGTH,
      `summary must fit even with the longest Unicode name: ${whatsappUrl(result.summary).length}`);
    const prepared = prepareOrderMessage(result.message, result.summary);
    assert.equal(prepared.isSummary, true);
    assert.equal(prepared.text, result.summary);
    assert.ok(prepared.url.length <= MAX_WHATSAPP_URL_LENGTH);
    assert.equal(new URL(prepared.url).searchParams.get("text"), result.summary);
  }
});

test("short acknowledged orders retain the full WhatsApp text instead of the summary", async () => {
  const response = await handle(request({ ...input, cart: { 1: 1 }, customer: { ...input.customer, notes: "" } }));
  assert.equal(response.status, 200);
  const result = await response.json();
  const prepared = prepareOrderMessage(result.message, result.summary);
  assert.equal(prepared.isSummary, false);
  assert.equal(prepared.text, result.message);
  assert.ok(prepared.text.includes("#1 Ground Chakkar Big"));
});

test("summary and full message retain the original acknowledged timestamp on retry", async () => {
  const later = new Date("2026-11-03T10:00:00.000Z");
  const response = await handle(request(), async () =>
    Response.json({ ok: true, orderId: buildOrder(input, now).orderId, createdAt: now.toISOString() }),
  { now: () => later });
  assert.equal(response.status, 200);
  const result = await response.json();
  for (const text of [result.message, result.summary]) {
    assert.ok(text.includes("Order date & time: 2026-11-02 15:30:00 IST"));
    assert.ok(!text.includes("2026-11-03"));
  }
});

test("endpoint rejects wrong origin, wrong content type, malformed and oversized bodies", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; throw new Error("Must not call upstream"); };
  for (const [req, status] of [
    [request(input, { Origin: "https://another.example" }), 403],
    [request(input, { Origin: "" }), 403],
    [request(input, { "Content-Type": "text/plain" }), 415],
    [request("not JSON"), 400],
    [request("x".repeat(17000)), 413],
    [request("🎉".repeat(5000)), 413],
    [request({ ...input, consent: false }), 400],
    [request(input, {}, "PUT"), 405],
  ]) {
    const response = await handle(req, fetchImpl);
    assert.equal(response.status, status);
    assert.ok((await response.json()).error);
  }
  assert.equal(calls, 0);
});

test("missing and invalid saved timestamps never produce a successful WhatsApp handoff", async () => {
  for (const createdAt of [undefined, null, "", "not-a-date", "2026-02-30T10:00:00.000Z", "2026-11-02T10:00:00Z"]) {
    const response = await handle(request(), async () =>
      Response.json({ ok: true, orderId: buildOrder(input, now).orderId, createdAt }));
    assert.equal(response.status, 503);
    const result = await response.json();
    assert.ok(result.error.includes("recorded order request time"));
    assert.equal(result.message, undefined);
    assert.equal(result.summary, undefined);
  }
});

test("configuration is server-only and restricted to a deployed Google Apps Script URL", async () => {
  for (const overrides of [
    {}, { ...env, ORDER_TRACKING_SECRET: "short" },
    { ...env, GOOGLE_SHEETS_WEBHOOK_URL: "https://another.example/exec" },
    { ...env, GOOGLE_SHEETS_WEBHOOK_URL: "http://script.google.com/macros/s/x/exec" },
    { ...env, GOOGLE_SHEETS_WEBHOOK_URL: `${env.GOOGLE_SHEETS_WEBHOOK_URL}?secret=x` },
    { ...env, GOOGLE_SHEETS_WEBHOOK_URL: "https://script.google.com/macros/s/x/dev" },
  ]) {
    const response = await handle(request(), undefined, { env: overrides });
    assert.equal(response.status, 503);
    assert.ok(!(await response.text()).includes(env.ORDER_TRACKING_SECRET));
  }
  const health = await handle(request(undefined, {}, "GET"));
  assert.deepEqual(await health.json(), { available: true });
  assert.equal(config.path, "/api/orders");
  assert.deepEqual(config.rateLimit.aggregateBy, ["ip", "domain"]);
});

test("timeouts, failed writes, conflicts and invalid acknowledgements never report success", async () => {
  for (const [fetchImpl, status] of [
    [async () => { throw new Error("Network timeout"); }, 503],
    [async () => new Response("Failure", { status: 500 }), 503],
    [async () => new Response("<html>Sign in</html>"), 502],
    [async () => Response.json({ ok: false, error: "WRITE_FAILED" }), 503],
    [async () => Response.json({ ok: true, orderId: "another-order" }), 503],
    [async () => Response.json({ ok: false, error: "CONFLICT" }), 409],
  ]) {
    const response = await handle(request(), fetchImpl);
    assert.equal(response.status, status);
    const result = await response.json();
    assert.ok(result.error);
    assert.equal(result.message, undefined);
    assert.equal(result.summary, undefined);
    assert.equal(result.orderId, undefined);
  }
});

const source = await readFile(new URL("../integrations/google-sheets/Code.gs", import.meta.url), "utf8");
function sheetHarness() {
  const rows = [];
  let sheetExists = false;
  let maxRows = 2;
  let maxColumns = 26;
  let openCount = 0;
  let lockAvailable = true;
  let releases = 0;
  const validations = [];
  const warnings = [];
  function range(row, column, height = 1, width = 1) {
    return {
      getValues: () => Array.from({ length: height }, (_, i) =>
        Array.from({ length: width }, (_, j) => rows[row + i - 1]?.[column + j - 1] ?? "")),
      setValues(values) {
        values.forEach((value, i) => {
          rows[row + i - 1] ??= [];
          value.forEach((cell, j) => { rows[row + i - 1][column + j - 1] = cell; });
        });
        return this;
      },
      getValue: () => rows[row - 1]?.[column - 1] ?? "",
      getRow: () => row,
      setFontWeight() { return this; },
      setNumberFormat() { return this; },
      setDataValidation(value) { validations.push({ row, column, value }); return this; },
      createTextFinder(text) {
        return {
          matchEntireCell() { return this; },
          useRegularExpression() { return this; },
          findNext() {
            const index = rows.findIndex((value, i) => i >= row - 1 &&
              i < row - 1 + height && value[column - 1] === text);
            return index < 0 ? null : range(index + 1, column);
          },
        };
      },
    };
  }
  const sheet = {
    getRange: range, getLastRow: () => rows.length, getMaxRows: () => maxRows,
    insertRowsAfter: (_, count) => { maxRows += count; },
    getMaxColumns: () => maxColumns,
    insertColumnsAfter: (_, count) => { maxColumns += count; },
    setFrozenRows() {}, setColumnWidth() {}, hideColumns() {},
  };
  const properties = new Map([
    ["SPREADSHEET_ID", "test-sheet-not-a-real-id"], ["ORDER_TRACKING_SECRET", env.ORDER_TRACKING_SECRET],
  ]);
  const context = vm.createContext({
    PropertiesService: { getScriptProperties: () => ({ getProperty: key => properties.get(key) }) },
    SpreadsheetApp: {
      openById() {
        openCount++;
        return {
          getSheetByName: () => sheetExists ? sheet : null,
          insertSheet: () => { sheetExists = true; return sheet; },
        };
      },
      flush() {},
      newDataValidation: () => ({
        requireValueInList(values) { this.values = values; return this; },
        setAllowInvalid(value) { this.allowInvalid = value; return this; },
        build() { return this; },
      }),
    },
    LockService: { getScriptLock: () => ({
      tryLock: () => lockAvailable, waitLock() {},
      releaseLock: () => { releases++; },
    }) },
    ContentService: {
      MimeType: { JSON: "application/json" },
      createTextOutput: text => ({ setMimeType() { return this; }, getContent: () => text }),
    },
    Utilities: {
      formatDate(date, timeZone, format) {
        assert.equal(timeZone, "Asia/Kolkata");
        assert.equal(format, "yyyy-MM-dd HH:mm:ss 'IST'");
        return new Date(date.getTime() + 330 * 60000).toISOString().slice(0, 19).replace("T", " ") + " IST";
      },
    },
    console: { error() {}, warn(message) { warnings.push(message); } },
  });
  vm.runInContext(source, context);
  function post(order, secret = env.ORDER_TRACKING_SECRET) {
    return JSON.parse(context.doPost({ postData: { contents: JSON.stringify({ order, secret }) } }).getContent());
  }
  return {
    rows, validations, warnings, context, post, properties,
    get openCount() { return openCount; },
    get releases() { return releases; },
    set lockAvailable(value) { lockAvailable = value; },
    get maxColumns() { return maxColumns; },
    set maxColumns(value) { maxColumns = value; },
  };
}

test("Apps Script writes one row, preserves numeric totals and gives the vendor a status dropdown", () => {
  const harness = sheetHarness();
  const order = buildOrder(input, now);
  assert.deepEqual(harness.post(order), { ok: true, orderId: order.orderId, createdAt: order.createdAt });
  assert.equal(harness.rows.length, 2);
  const row = harness.rows[1];
  assert.equal(row[0], order.orderId);
  assert.equal(row[2], "New");
  assert.equal(row[6], "Free home delivery");
  assert.equal(row[9], 370);
  assert.equal(row[10], 15);
  assert.equal(row[11], 55.5);
  assert.equal(row[12], 0);
  assert.equal(row[13], 314.5);
  assert.equal(row[1], "'" + order.createdAt);
  assert.equal(row[16], "'2026-11-02 15:30:00 IST");
  assert.equal(harness.rows[0][16], "Order date & time (IST)");
  assert.ok(row[8].includes("#12 Flower Pot Special"));
  assert.equal(harness.validations[0].column, 3);
  assert.ok(harness.validations[0].value.values.includes("Completed"));
  assert.equal(harness.validations[0].value.allowInvalid, false);
  assert.equal(harness.releases, 1);
});

test("sheet and WhatsApp use the original IST timestamp across midnight and later retries", async () => {
  const harness = sheetHarness();
  const fetchImpl = async (_, options) => {
    const payload = JSON.parse(options.body);
    return Response.json(harness.post(payload.order, payload.secret));
  };
  const firstTime = new Date("2026-11-02T18:35:12.000Z");
  const first = await handle(request(), fetchImpl, { now: () => firstTime });
  assert.equal(first.status, 200);
  const saved = await first.json();
  assert.ok(saved.message.includes("Order date & time: 2026-11-03 00:05:12 IST"));
  assert.equal(harness.rows[1][16], "'2026-11-03 00:05:12 IST");
  harness.rows[1][2] = "Confirmed";
  const retry = await handle(request(), fetchImpl, { now: () => new Date("2026-11-03T18:35:12.000Z") });
  assert.equal(retry.status, 200);
  assert.equal((await retry.json()).message, saved.message);
  assert.equal(harness.rows.length, 2);
  assert.equal(harness.rows[1][1], "'" + firstTime.toISOString());
  assert.equal(harness.rows[1][16], "'2026-11-03 00:05:12 IST");
  assert.equal(harness.rows[1][2], "Confirmed");
});

test("setup upgrades the original 16-column sheet without moving order data or statuses", () => {
  const harness = sheetHarness();
  const order = buildOrder(input, now);
  harness.post(order);
  harness.rows[0].pop();
  harness.rows[1].pop();
  harness.rows[1][2] = "Completed";
  harness.maxColumns = 16;
  const existing = structuredClone(harness.rows);
  harness.context.setupOrdersSheet();
  assert.deepEqual(harness.rows.map(row => row.slice(0, 16)), existing);
  assert.equal(harness.rows[0][16], "Order date & time (IST)");
  assert.equal(harness.rows[1][16], "'2026-11-02 15:30:00 IST");
  assert.equal(harness.maxColumns, 17);
  harness.context.setupOrdersSheet();
  assert.equal(harness.rows.length, 2);
  assert.equal(harness.rows[1][2], "Completed");
});

test("IST dates remain correct at midnight, month and year boundaries", async () => {
  for (const [instant, expected] of [
    ["2026-11-02T18:29:59.999Z", "2026-11-02 23:59:59 IST"],
    ["2026-11-02T18:30:00.000Z", "2026-11-03 00:00:00 IST"],
    ["2026-11-30T18:30:00.000Z", "2026-12-01 00:00:00 IST"],
    ["2026-12-31T18:30:00.000Z", "2027-01-01 00:00:00 IST"],
  ]) {
    const harness = sheetHarness();
    const payload = { ...input, customer: { ...input.customer, preferredDate: "" } };
    const response = await handle(request(payload), async (_, options) => {
      const body = JSON.parse(options.body);
      return Response.json(harness.post(body.order, body.secret));
    }, { now: () => new Date(instant) });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.ok(result.message.includes(`Order date & time: ${expected}`));
    assert.ok(result.summary.includes(`Order date & time: ${expected}`));
    assert.equal(harness.rows[1][16], "'" + expected);
  }
});

test("legacy Google date cells convert to IST without changing the original stored instant", () => {
  const harness = sheetHarness();
  harness.post(buildOrder(input, now));
  harness.rows[0].pop();
  harness.rows[1].pop();
  const stored = new Date("2026-11-02T18:30:00.000Z");
  harness.rows[1][1] = stored;
  harness.context.setupOrdersSheet();
  assert.equal(harness.rows[1][1], stored);
  assert.equal(harness.rows[1][16], "'2026-11-03 00:00:00 IST");
  assert.equal(harness.post(buildOrder(input, now)).createdAt, stored.toISOString());
});

test("migration never invents missing historical timestamps or overwrites custom columns", () => {
  const missing = sheetHarness();
  missing.post(buildOrder(input, now));
  missing.rows[0].pop();
  missing.rows[1].pop();
  missing.rows[1][1] = "";
  missing.context.setupOrdersSheet();
  assert.equal(missing.rows[1][16], "");
  assert.equal(missing.warnings.length, 1);
  const invalid = sheetHarness();
  invalid.post(buildOrder(input, now));
  invalid.rows[0].pop();
  invalid.rows[1].pop();
  invalid.rows[1][1] = "Unrecoverable timestamp";
  assert.throws(() => invalid.context.setupOrdersSheet(), /timestamp is invalid/);
  assert.equal(invalid.rows[0][16], undefined);
  const custom = sheetHarness();
  custom.post(buildOrder(input, now));
  custom.rows[0][16] = "Vendor memo";
  custom.rows[1][16] = "Keep this";
  assert.throws(() => custom.context.setupOrdersSheet(), /Column Q is already in use/);
  assert.equal(custom.rows[1][16], "Keep this");
});

test("Apps Script retries do not duplicate records or overwrite vendor-maintained statuses", () => {
  const harness = sheetHarness();
  const order = buildOrder(input, now);
  harness.post(order);
  harness.rows[1][2] = "Confirmed";
  assert.equal(harness.post(order).ok, true);
  assert.equal(harness.rows.length, 2);
  assert.equal(harness.rows[1][2], "Confirmed");
  const changed = buildOrder({ ...input, customer: { ...input.customer, notes: "Revised" } }, now);
  assert.deepEqual(harness.post(changed), { ok: false, error: "CONFLICT" });
  assert.equal(harness.rows.length, 2);
  assert.equal(harness.rows[1][2], "Confirmed");
});

test("Apps Script neutralizes spreadsheet formulas in customer-controlled cells", () => {
  const harness = sheetHarness();
  const order = buildOrder({
    ...input, customer: {
      ...input.customer, name: "=Example Name", address: "=IMPORTXML(\"https://example.invalid\", \"//x\")",
      notes: "+SUM(1,2)",
    },
  }, now);
  assert.equal(harness.post(order).ok, true);
  const row = harness.rows[1];
  for (const index of [3, 4, 5, 7, 8, 14]) assert.ok(row[index].startsWith("'"));
  assert.equal(row[3], "'=Example Name");
  assert.equal(row[14], "'+SUM(1,2)");
});

test("Apps Script rejects unauthorized, invalid and busy requests without sheet access", () => {
  const harness = sheetHarness();
  const order = buildOrder(input, now);
  assert.equal(harness.post(order, "wrong").error, "UNAUTHORIZED");
  for (const contents of ["null", "[]", "not-json"]) {
    const result = harness.context.doPost({ postData: { contents } });
    assert.equal(JSON.parse(result.getContent()).ok, false);
  }
  assert.equal(harness.post({ ...order, orderId: "bad" }).error, "INVALID_ORDER");
  for (const createdAt of [null, "", "not-a-date", "2026-02-30T10:00:00.000Z"]) {
    assert.equal(harness.post({ ...order, createdAt }).error, "INVALID_ORDER");
  }
  harness.lockAvailable = false;
  assert.equal(harness.post(order).error, "BUSY");
  assert.equal(harness.openCount, 0);
  assert.equal(harness.rows.length, 0);
});

test("Apps Script fails explicitly if the vendor changes required column headers", () => {
  const harness = sheetHarness();
  const order = buildOrder(input, now);
  harness.post(order);
  harness.rows[0][0] = "Renamed";
  const other = { ...order, orderId: "SBC-22345678-1234-4234-8234-123456789ABC" };
  assert.deepEqual(harness.post(other), { ok: false, error: "WRITE_FAILED" });
  assert.equal(harness.rows.length, 2);
});
