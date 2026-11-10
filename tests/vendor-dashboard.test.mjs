import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { vendorSettings, createSession, unseal, startOAuth, seal, readCookie } from "../netlify/lib/vendor-auth.mjs";
import { handleVendorAuth, config as authConfig } from "../netlify/functions/vendor-auth.mjs";
import { handleVendorOrders, config as ordersConfig } from "../netlify/functions/vendor-orders.mjs";
import { ORDER_STATUSES, PAGE_SIZE } from "../vendor-app/vendor-model.mjs";

const origin = "https://vendor.example";
const now = Date.parse("2026-11-02T10:00:00.000Z");
const env = {
  VENDOR_APP_ORIGIN: origin, VENDOR_ALLOWED_EMAILS: "owner@example.com,staff@example.com",
  VENDOR_GOOGLE_CLIENT_ID: "test-client.apps.googleusercontent.com",
  VENDOR_GOOGLE_CLIENT_SECRET: "test-only-google-secret",
  VENDOR_SESSION_SECRET: "test-only-session-secret-".repeat(2),
  ORDER_TRACKING_SECRET: "test-only-sheet-secret-".repeat(2),
  GOOGLE_SHEETS_WEBHOOK_URL: "https://script.google.com/macros/s/test-deployment/exec",
};
const settings = vendorSettings(env);
const sessionValue = createSession({ sub: "test-sub", email: "owner@example.com" }, settings, now);
const session = unseal(sessionValue, "session", settings, now);
const orderId = "SBC-12345678-1234-4234-8234-123456789ABC";
const order = {
  orderId, createdAt: new Date(now).toISOString(), status: "New", name: "<script>fake</script>",
  phone: "+91 9876543210", fulfilment: "Store pickup", total: 85,
  address: "Test address\nHyderabad", preferredDate: "", items: "#1 Test pack | Qty 1 x Rs.100.00 = Rs.100.00",
  subtotal: 100, discountPercent: 15, discount: 15, deliveryCharge: 0, notes: "=1+1",
};
const stats = { requestValue: 85, ...Object.fromEntries(ORDER_STATUSES.map(status => [status, status === "New" ? 1 : 0])) };
function req(path, { method = "GET", authenticated = true, body, headers = {} } = {}) {
  return new Request(`${origin}${path}`, {
    method, headers: { ...(authenticated ? { Cookie: `${settings.sessionCookie}=${sessionValue}` } : {}), ...headers },
    ...(body !== undefined ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
  });
}
const forbiddenFetch = async () => { throw new Error("Unexpected network access in this test"); };
const auth = (request, overrides = {}) => handleVendorAuth(request, { env, now: () => now, fetchImpl: forbiddenFetch, ...overrides });
const orders = (request, overrides = {}) => handleVendorOrders(request, {
  env, now: () => now,
  fetchImpl: async () => Response.json({ ok: true, orders: [order], total: 1, page: 1, stats }),
  ...overrides,
});

test("vendor configuration rejects missing secrets, unsafe origins and invalid allowlists", () => {
  for (const override of [
    { VENDOR_APP_ORIGIN: "http://vendor.example" }, { VENDOR_APP_ORIGIN: `${origin}/elsewhere` },
    { VENDOR_APP_ORIGIN: `${origin}?query=x` }, { VENDOR_APP_ORIGIN: "https://user:pass@vendor.example" },
    { VENDOR_SESSION_SECRET: "short" }, { VENDOR_GOOGLE_CLIENT_ID: "" },
    { VENDOR_GOOGLE_CLIENT_SECRET: "" }, { VENDOR_ALLOWED_EMAILS: "" }, { VENDOR_ALLOWED_EMAILS: "not-an-email" },
  ]) assert.equal(vendorSettings({ ...env, ...override }), null);
  assert.equal(vendorSettings({ ...env, VENDOR_APP_ORIGIN: "http://127.0.0.1:4173" }).local, true);
  assert.deepEqual(vendorSettings({ ...env, VENDOR_ALLOWED_EMAILS: " OWNER@EXAMPLE.COM " }).emails, ["owner@example.com"]);
});

test("sessions are signed, purpose-bound, expire at eight hours and never expose server secrets", async () => {
  assert.equal(unseal(sessionValue, "oauth", settings, now), null);
  assert.equal(unseal(`${sessionValue.slice(0, -2)}xx`, "session", settings, now), null);
  assert.equal(unseal(sessionValue, "session", settings, now + 8 * 60 * 60 * 1000), null);
  assert.equal(unseal("invalid.invalid", "session", settings, now), null);
  const response = await auth(req("/api/vendor-auth/session"));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body, { email: "owner@example.com", csrf: session.csrf, expiresAt: session.exp });
  assert.match(response.headers.get("cache-control"), /no-store/);
  assert.ok(!JSON.stringify(body).includes(env.VENDOR_SESSION_SECRET));
  assert.equal(readCookie(req("/api/vendor-auth/session", {
    headers: { Cookie: `${settings.sessionCookie}=x; ${settings.sessionCookie}=y` },
  }), settings.sessionCookie), null);
});

test("unapproved, removed, forged and expired accounts cannot read private orders", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return Response.json({}); };
  for (const request of [
    req("/api/vendor-orders", { authenticated: false }),
    req("/api/vendor-orders", { headers: { Cookie: `${settings.sessionCookie}=forged` } }),
    req("/api/vendor-orders", { headers: { Cookie: `${settings.sessionCookie}=${createSession({ sub: "bad", email: "stranger@example.com" }, settings, now)}` } }),
  ]) assert.equal((await orders(request, { fetchImpl })).status, 401);
  assert.equal((await orders(req("/api/vendor-orders"), { env: { ...env, VENDOR_ALLOWED_EMAILS: "staff@example.com" }, fetchImpl })).status, 401);
  assert.equal((await orders(req("/api/vendor-orders"), { now: () => session.exp, fetchImpl })).status, 401);
  assert.equal(calls, 0);
});

test("Google login uses PKCE, state, minimal scopes and a Secure HttpOnly host cookie", async () => {
  const response = await auth(req("/api/vendor-auth/login", { authenticated: false }));
  const url = new URL(response.headers.get("location"));
  assert.equal(response.status, 303);
  assert.equal(url.origin, "https://accounts.google.com");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("scope"), "openid email");
  assert.equal(url.searchParams.get("redirect_uri"), `${origin}/api/vendor-auth/callback`);
  assert.equal(url.searchParams.get("state").length, 43);
  const header = response.headers.get("set-cookie");
  for (const part of ["__Host-vendor-oauth=", "HttpOnly", "Secure", "SameSite=Lax", "Max-Age=600", "Path=/"]) assert.ok(header.includes(part));
  assert.ok(!url.href.includes(env.VENDOR_GOOGLE_CLIENT_SECRET));
});

function callbackRequest(oauth, suffix = "") {
  const state = new URL(oauth.url).searchParams.get("state");
  return req(`/api/vendor-auth/callback?state=${state}&code=test-code${suffix}`, {
    authenticated: false, headers: { Cookie: `${settings.stateCookie}=${oauth.value}` },
  });
}

test("Google callback verifies state and approval before creating a session", async () => {
  const oauth = startOAuth(settings, now);
  const calls = [];
  const response = await auth(callbackRequest(oauth), {
    fetchImpl: async (url, options) => {
      calls.push(url);
      if (calls.length === 1) {
        assert.equal(url, "https://oauth2.googleapis.com/token");
        assert.equal(options.body.get("code_verifier"), unseal(oauth.value, "oauth", settings, now).verifier);
        assert.equal(options.body.get("client_secret"), env.VENDOR_GOOGLE_CLIENT_SECRET);
        assert.equal(options.redirect, "error");
        return Response.json({ access_token: "test-only-access-token", token_type: "Bearer" });
      }
      assert.equal(url, "https://openidconnect.googleapis.com/v1/userinfo");
      assert.equal(options.headers.Authorization, "Bearer test-only-access-token");
      return Response.json({ sub: "google-sub", email: "OWNER@example.com", email_verified: true });
    },
  });
  assert.equal(calls.length, 2);
  assert.equal(response.headers.get("location"), `${origin}/vendor/`);
  const cookies = response.headers.getSetCookie();
  assert.equal(cookies.length, 2);
  assert.match(cookies[0], /Max-Age=0/);
  assert.match(cookies[1], /Max-Age=28800/);
  const value = cookies[1].split(";")[0].split("=")[1];
  assert.equal(unseal(value, "session", settings, now).email, "owner@example.com");
  assert.ok(!cookies.join("").includes("test-only-access-token"));
});

test("invalid, reused, expired or missing OAuth state and duplicate codes cannot call Google", async () => {
  const oauth = startOAuth(settings, now);
  for (const request of [
    req("/api/vendor-auth/callback?state=bad&code=test", { authenticated: false }),
    callbackRequest(oauth, "&state=duplicate"), callbackRequest(oauth, "&code=duplicate"),
    req("/api/vendor-auth/callback?state=bad&code=test", { headers: { Cookie: `${settings.stateCookie}=${oauth.value}` } }),
  ]) {
    const response = await auth(request);
    assert.equal(response.headers.get("location"), `${origin}/vendor/?auth=invalid`);
  }
  assert.equal((await auth(callbackRequest(oauth), { now: () => now + 600000 })).headers.get("location"), `${origin}/vendor/?auth=invalid`);
});

test("Google failures and unverified/unapproved accounts produce no session", async () => {
  for (const identity of [
    { sub: "sub", email: "stranger@example.com", email_verified: true },
    { sub: "sub", email: "owner@example.com", email_verified: false },
    { email: "owner@example.com", email_verified: true },
  ]) {
    let calls = 0;
    const response = await auth(callbackRequest(startOAuth(settings, now)), {
      fetchImpl: async () => ++calls === 1 ? Response.json({ access_token: "test", token_type: "Bearer" }) : Response.json(identity),
    });
    assert.equal(response.headers.get("location"), `${origin}/vendor/?auth=denied`);
    assert.ok(response.headers.getSetCookie().every(value => value.includes("Max-Age=0")));
  }
  const failed = await auth(callbackRequest(startOAuth(settings, now)), { fetchImpl: async () => { throw new Error("offline"); } });
  assert.equal(failed.headers.get("location"), `${origin}/vendor/?auth=failed`);
  assert.ok(failed.headers.getSetCookie().every(value => value.includes("Max-Age=0")));
});

test("logout requires a same-origin POST with session CSRF and clears the cookie", async () => {
  for (const headers of [{}, { Origin: "https://attacker.example", "X-Vendor-CSRF": session.csrf },
    { Origin: origin, "X-Vendor-CSRF": "invalid" }]) {
    assert.equal((await auth(req("/api/vendor-auth/logout", { method: "POST", headers }))).status, 403);
  }
  const result = await auth(req("/api/vendor-auth/logout", { method: "POST", headers: { Origin: origin, "X-Vendor-CSRF": session.csrf } }));
  assert.equal(result.status, 200);
  assert.match(result.headers.get("set-cookie"), /Max-Age=0/);
  assert.equal((await auth(req("/api/vendor-auth/logout"))).status, 405);
});

test("dashboard listing sends only bounded validated queries and strips private row fields", async () => {
  const response = await orders(req("/api/vendor-orders?query=98765&status=New&page=1"), {
    fetchImpl: async (url, options) => {
      assert.equal(url, env.GOOGLE_SHEETS_WEBHOOK_URL);
      assert.deepEqual(JSON.parse(options.body), {
        action: "vendor-list", query: "98765", status: "New", page: 1, secret: env.ORDER_TRACKING_SECRET,
      });
      return Response.json({ ok: true, orders: [{ ...order, fingerprint: "private" }], total: 1, page: 1, stats });
    },
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.orders[0].name, order.name);
  for (const key of ["fingerprint", "address", "notes", "items"]) assert.equal(body.orders[0][key], undefined);
  assert.match(response.headers.get("cache-control"), /no-store/);
});

test("malformed searches, statuses, IDs, bodies and unsafe mutations never reach the Sheet", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return Response.json({}); };
  const update = { orderId, status: "Confirmed", expectedStatus: "New" };
  for (const [request, expected] of [
    [req("/api/vendor-orders?page=0"), 400], [req("/api/vendor-orders?page=401"), 400],
    [req("/api/vendor-orders?page=1.5"), 400], [req("/api/vendor-orders?status=Paid"), 400],
    [req(`/api/vendor-orders?query=${"a".repeat(81)}`), 400],
    [req("/api/vendor-orders?query=x&query=y"), 400], [req("/api/vendor-orders?secret=bad"), 400],
    [req("/api/vendor-orders?orderId=bad"), 400], [req(`/api/vendor-orders?orderId=${orderId}&page=1`), 400],
    [req("/api/vendor-orders", { method: "POST", body: update }), 403],
    [req("/api/vendor-orders", { method: "POST", body: update, headers: { Origin: "https://bad.example", "X-Vendor-CSRF": session.csrf } }), 403],
    [req("/api/vendor-orders", { method: "POST", body: update, headers: { Origin: origin, "X-Vendor-CSRF": session.csrf } }), 415],
    [req("/api/vendor-orders", { method: "PUT" }), 405],
    [req("/api/vendor-orders", { method: "POST", body: "x".repeat(1025), headers: { Origin: origin, "X-Vendor-CSRF": session.csrf, "Content-Type": "application/json" } }), 413],
    [req("/api/vendor-orders", { method: "POST", body: { ...update, status: "Paid" }, headers: { Origin: origin, "X-Vendor-CSRF": session.csrf, "Content-Type": "application/json" } }), 400],
  ]) assert.equal((await orders(request, { fetchImpl })).status, expected);
  assert.equal(calls, 0);
});

test("details and optimistic status writes require matching authoritative acknowledgements", async () => {
  const detail = await orders(req(`/api/vendor-orders?orderId=${orderId}`), {
    fetchImpl: async () => Response.json({ ok: true, order: { ...order, fingerprint: "private-hash", secret: "private" } }),
  });
  assert.deepEqual((await detail.json()).order, order);
  const response = await orders(req("/api/vendor-orders", {
    method: "POST", body: { orderId, status: "Confirmed", expectedStatus: "New" },
    headers: { Origin: origin, "X-Vendor-CSRF": session.csrf, "Content-Type": "application/json" },
  }), {
    fetchImpl: async (_, options) => {
      const input = JSON.parse(options.body);
      assert.deepEqual(input, { action: "vendor-status", orderId, status: "Confirmed", expectedStatus: "New", secret: env.ORDER_TRACKING_SECRET });
      return Response.json({ ok: true, order: { ...order, status: "Confirmed" } });
    },
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).order.status, "Confirmed");
});

test("Sheet timeouts, unknown action deployments, malformed rows and conflicts are explicit failures", async () => {
  for (const [result, status] of [
    [{ ok: false, error: "STATUS_CONFLICT" }, 409], [{ ok: false, error: "NOT_FOUND" }, 404],
    [{ ok: false, error: "BUSY" }, 503], [{ ok: false, error: "REGISTER_TOO_LARGE" }, 503],
    [{ ok: false, error: "INVALID_ORDER" }, 503], [{ ok: true, orders: [], total: 1, page: 1, stats: {} }, 503],
    [{ ok: true, orders: [{ ...order, total: -1 }], total: 1, page: 1, stats }, 503],
    [{ ok: true, orders: [order], total: 99, page: 1, stats }, 503],
  ]) {
    const response = await orders(req("/api/vendor-orders"), { fetchImpl: async () => Response.json(result) });
    assert.equal(response.status, status);
    assert.ok((await response.json()).error);
  }
  for (const fetchImpl of [
    async () => { throw new Error("timeout"); }, async () => new Response("bad", { status: 500 }),
    async () => new Response("<html>Sign in</html>"),
  ]) assert.equal((await orders(req("/api/vendor-orders"), { fetchImpl })).status, 503);
  assert.equal((await orders(req(`/api/vendor-orders?orderId=${orderId}`), {
    fetchImpl: async () => Response.json({ ok: true, order: { ...order, orderId: "bad" } }),
  })).status, 503);
});

const source = await readFile(new URL("../integrations/google-sheets/Code.gs", import.meta.url), "utf8");
function sheetHarness(count = 51) {
  const rows = [];
  const writes = [];
  let opened = 0;
  let lockAvailable = true;
  const range = (row, column, height = 1, width = 1) => ({
    getValues: () => Array.from({ length: height }, (_, i) => rows[row - 1 + i].slice(column - 1, column - 1 + width)),
    getValue: () => rows[row - 1]?.[column - 1] ?? "",
    getRow: () => row,
    setValue(value) { rows[row - 1][column - 1] = value; writes.push({ row, column, value }); return this; },
    createTextFinder(text) {
      return {
        matchEntireCell() { return this; }, useRegularExpression() { return this; },
        findNext() {
          const index = rows.findIndex((values, i) => i >= row - 1 && i < row - 1 + height && values[column - 1] === text);
          return index < 0 ? null : range(index + 1, column);
        },
      };
    },
  });
  const sheet = { getLastRow: () => rows.length, getMaxColumns: () => 26, getRange: range };
  const context = vm.createContext({
    PropertiesService: { getScriptProperties: () => ({ getProperty: key => key === "SPREADSHEET_ID" ? "test-sheet" : env.ORDER_TRACKING_SECRET }) },
    SpreadsheetApp: { openById: () => { opened++; return { getSheetByName: () => sheet }; }, flush() {} },
    LockService: { getScriptLock: () => ({ tryLock: () => lockAvailable, releaseLock() {} }) },
    ContentService: { MimeType: { JSON: "json" }, createTextOutput: value => ({ setMimeType() { return this; }, getContent: () => value }) },
    console: { error() {} },
  });
  vm.runInContext(source, context);
  rows.push(Array.from(context.ORDER_HEADERS));
  for (let i = 0; i < count; i++) rows.push([
    `SBC-12345678-1234-4234-8234-${i.toString(16).padStart(12, "0").toUpperCase()}`,
    "'" + new Date(now + i * 1000).toISOString(), ORDER_STATUSES[i % ORDER_STATUSES.length],
    "'Customer " + i, "'+91 9876543210", "'Test address\nHyderabad", "Store pickup",
    "'", "'#1 Pack | Qty 1", 100, 15, 15, 0, 85, "'=1+1", "private-hash", "'2026-11-02 15:30:00 IST",
  ]);
  const post = (input, secret = env.ORDER_TRACKING_SECRET) => JSON.parse(context.doPost({
    postData: { contents: JSON.stringify({ ...input, secret }) },
  }).getContent());
  return { rows, writes, context, post, get opened() { return opened; }, set lockAvailable(value) { lockAvailable = value; } };
}
const list = { action: "vendor-list", query: "", status: "", page: 1 };

test("Apps Script dashboard is secret-protected and shares the existing statuses", () => {
  const harness = sheetHarness();
  assert.deepEqual(Array.from(harness.context.ORDER_STATUSES), ORDER_STATUSES);
  assert.equal(harness.post(list, "wrong").error, "UNAUTHORIZED");
  assert.equal(harness.opened, 0);
  assert.equal(harness.post({ action: "vendor-unknown" }).error, "INVALID_REQUEST");
  assert.equal(harness.post({ ...list, page: 0 }).error, "INVALID_REQUEST");
  harness.lockAvailable = false;
  assert.equal(harness.post(list).error, "BUSY");
  assert.equal(harness.opened, 0);
});

test("Apps Script lists newest first with bounded pages, global filters and safe summaries", () => {
  const harness = sheetHarness();
  const result = harness.post(list);
  assert.equal(result.total, 51);
  assert.equal(result.orders.length, PAGE_SIZE);
  assert.equal(result.orders[0].name, "Customer 50");
  assert.equal(result.orders[0].address, undefined);
  assert.equal(result.orders[0].fingerprint, undefined);
  assert.equal(harness.post({ ...list, page: 3 }).orders.length, 1);
  assert.equal(harness.post({ ...list, page: 3 }).orders[0].name, "Customer 0");
  const search = harness.post({ ...list, query: "customer 50" });
  assert.equal(search.total, 1);
  assert.equal(search.orders[0].name, "Customer 50");
  assert.equal(harness.post({ ...list, query: "+91 98765" }).total, 51);
  const filtered = harness.post({ ...list, status: "Cancelled" });
  assert.equal(filtered.total, 6);
  assert.equal(filtered.stats.Cancelled, 6);
  assert.equal(filtered.stats.requestValue, 0);
  assert.equal(harness.post({ ...list, query: "not present" }).total, 0);
  assert.deepEqual(harness.writes, []);
});

test("Apps Script details preserve literal customer content without exposing hashes", () => {
  const harness = sheetHarness(1);
  const result = harness.post({ action: "vendor-detail", orderId: harness.rows[1][0] });
  assert.equal(result.ok, true);
  assert.equal(result.order.notes, "=1+1");
  assert.equal(result.order.items, "#1 Pack | Qty 1");
  assert.equal(result.order.address, "Test address\nHyderabad");
  assert.equal(result.order.fingerprint, undefined);
  assert.equal(harness.post({ action: "vendor-detail", orderId }).error, "NOT_FOUND");
});

test("Apps Script status updates change only column C and detect concurrent edits", () => {
  const harness = sheetHarness(1);
  const snapshot = [...harness.rows[1]];
  const update = { action: "vendor-status", orderId: snapshot[0], expectedStatus: "New", status: "Confirmed" };
  const result = harness.post(update);
  assert.equal(result.order.status, "Confirmed");
  assert.deepEqual(harness.writes, [{ row: 2, column: 3, value: "Confirmed" }]);
  assert.deepEqual(harness.rows[1], snapshot.map((value, index) => index === 2 ? "Confirmed" : value));
  assert.equal(harness.post({ ...update, status: "Cancelled" }).error, "STATUS_CONFLICT");
  assert.equal(harness.writes.length, 1);
  assert.equal(harness.post({ ...update, expectedStatus: "Confirmed", status: "Paid" }).error, "INVALID_REQUEST");
});

test("Apps Script empty, oversized and corrupt registers return honest states", () => {
  assert.equal(sheetHarness(0).post(list).total, 0);
  const huge = sheetHarness(10001);
  assert.equal(huge.post(list).error, "REGISTER_TOO_LARGE");
  const corrupt = sheetHarness(1);
  corrupt.rows[1][2] = "Paid";
  assert.equal(corrupt.post(list).error, "DASHBOARD_FAILED");
  const badTotal = sheetHarness(1);
  badTotal.rows[1][13] = "not-numeric";
  assert.equal(badTotal.post(list).error, "DASHBOARD_FAILED");
  assert.equal(badTotal.post({ action: "vendor-status", orderId: badTotal.rows[1][0],
    status: "Confirmed", expectedStatus: "New" }).error, "DASHBOARD_FAILED");
  assert.deepEqual(badTotal.writes, []);
});

test("dashboard uses safe text rendering, no browser persistence and independent protected routes", async () => {
  const html = await readFile(new URL("../vendor-app/vendor/index.html", import.meta.url), "utf8");
  const app = await readFile(new URL("../vendor-app/vendor.mjs", import.meta.url), "utf8");
  assert.match(html, /Sign in with Google/);
  assert.match(html, /role="status"/);
  assert.match(html, /<dialog[^>]+aria-labelledby="detail-title"/);
  const table = html.match(/<table class="vendor-order-table">([\s\S]*?)<\/table>/)?.[1];
  assert.ok(table);
  assert.match(table, /<caption class="sr-only">Order requests/);
  assert.equal((table.match(/scope="col"/g) ?? []).length, 5);
  assert.match(table, /<tbody id="order-list" aria-busy="false"><\/tbody>/);
  assert.doesNotMatch(app, /innerHTML|localStorage|sessionStorage/);
  assert.match(app, /textContent/);
  assert.match(app, /expectedStatus: selected.status/);
  assert.match(app, /AbortController/);
  assert.match(app, /pagehide/);
  assert.equal(authConfig.path, "/api/vendor-auth/*");
  assert.equal(ordersConfig.path, "/api/vendor-orders");
  assert.deepEqual(ordersConfig.rateLimit.aggregateBy, ["ip", "domain"]);
  assert.equal(unseal(seal({ exp: now + 1000 }, "oauth", settings), "session", settings, now), null);
});
