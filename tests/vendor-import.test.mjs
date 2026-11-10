import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { handleVendorImport, config } from "../netlify/functions/vendor-import.mjs";
import { approvedImportMetadata, ImportValidationError } from "../netlify/lib/approved-import.mjs";
import { vendorSettings, createSession, unseal, seal } from "../netlify/lib/vendor-auth.mjs";

const origin = "https://vendor.example";
const now = Date.parse("2026-11-09T12:00:00.000Z");
const source = [{
  order_id: "SBC-00000000-0000-4000-8000-000000000001", fingerprint: "a".repeat(64),
  created_at: "2026-11-01T10:00:00.000Z", status: "Completed", total_paise: 8500, items: [{}],
  original_payload_hash_verified: false,
}];
const sql = `DO $test$ DECLARE source jsonb := convert_from(decode('${Buffer.from(JSON.stringify(source)).toString("hex")}', 'hex'), 'UTF8')::jsonb; BEGIN NULL; END $test$;`;
const hash = value => createHash("sha256").update(value).digest("hex");
const env = {
  ORDER_BACKEND: "netlify-db", ORDER_PDF_SECRET: "synthetic-pdf-secret-".repeat(3),
  VENDOR_APP_ORIGIN: origin, VENDOR_ALLOWED_EMAILS: "owner@example.com",
  VENDOR_GOOGLE_CLIENT_ID: "synthetic.apps.googleusercontent.com",
  VENDOR_GOOGLE_CLIENT_SECRET: "synthetic-google-secret",
  VENDOR_SESSION_SECRET: "synthetic-session-secret-".repeat(3),
  VENDOR_IMPORT_SQL_SHA256: hash(sql),
};
const settings = vendorSettings(env);
const cookie = createSession({ sub: "synthetic-vendor", email: "owner@example.com" }, settings, now);
const session = unseal(cookie, "session", settings, now);
const summary = {
  requests: 1, items: 1, totalPaise: 8500, newRequests: 1, newItems: 1,
  existingRequestsUnchanged: 0, statusDifferencesPreserved: 0,
  statusCounts: { Completed: 1 }, unverifiedSourceHashes: 1,
};
function request(body, headers = {}, method = body ? "POST" : "GET") {
  return new Request(`${origin}/api/vendor-import`, {
    method, headers: { Cookie: `${settings.sessionCookie}=${cookie}`, Origin: origin,
      "Content-Type": "application/json", "X-Vendor-CSRF": session.csrf, ...headers },
    ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
}
const handle = (req, overrides = {}) => handleVendorImport(req, {
  env, now: () => now,
  databaseFactory: async () => ({ importApprovedSql: async () => summary }), ...overrides,
});

test("approved import accepts only the exact owner-reviewed file and exposes no customer fields", () => {
  const metadata = approvedImportMetadata(sql, hash(sql));
  assert.equal(metadata.requests, 1);
  assert.equal(metadata.items, 1);
  assert.equal(metadata.totalPaise, 8500);
  assert.equal(metadata.unverifiedSourceHashes, 1);
  for (const statement of [undefined, "", `${sql}\n`, "DROP TABLE order_requests;"]) {
    assert.throws(() => approvedImportMetadata(statement, hash(sql)), ImportValidationError);
  }
  assert.throws(() => approvedImportMetadata(sql, "short"), ImportValidationError);
  assert.throws(() => approvedImportMetadata("SELECT 1", hash("SELECT 1")), ImportValidationError);
});

test("import requires approved authentication, current allowlist and CSRF before opening a database", async () => {
  let calls = 0;
  const databaseFactory = async () => { calls++; throw new Error("Must not open"); };
  for (const req of [
    request({ action: "preview", sql }, { Cookie: "" }),
    request({ action: "preview", sql }, { Cookie: `${settings.sessionCookie}=forged` }),
  ]) assert.equal((await handle(req, { databaseFactory })).status, 401);
  assert.equal((await handle(request(), { env: { ...env, VENDOR_ALLOWED_EMAILS: "staff@example.com" }, databaseFactory })).status, 401);
  assert.equal((await handle(request(), { now: () => session.exp, databaseFactory })).status, 401);
  for (const headers of [{ Origin: "https://attacker.example" }, { "X-Vendor-CSRF": "wrong" }]) {
    assert.equal((await handle(request({ action: "preview", sql }, headers), { databaseFactory })).status, 403);
  }
  assert.equal(calls, 0);
});

test("missing approval, Sheets backend, wrong method and oversized or malformed requests fail explicitly", async () => {
  assert.equal((await (await handle(request(), { env: { ...env, VENDOR_IMPORT_SQL_SHA256: "" } })).json()).enabled, false);
  assert.equal((await handle(request({ action: "preview", sql }), { env: { ...env, VENDOR_IMPORT_SQL_SHA256: "" } })).status, 503);
  assert.equal((await handle(request({ action: "preview", sql }), { env: { ...env, ORDER_BACKEND: "sheets" } })).status, 503);
  assert.equal((await handle(request(undefined, {}, "DELETE"))).status, 405);
  assert.equal((await handle(request({ action: "preview", sql }, { "Content-Type": "text/plain" }))).status, 415);
  assert.equal((await handle(request({ action: "preview", sql }, { "Content-Length": "524289" }))).status, 413);
  assert.equal((await handle(request("x".repeat(524289)))).status, 413);
  assert.equal((await handle(request("{"))).status, 400);
  assert.equal((await handle(request({ action: "unknown", sql }))).status, 400);
  assert.equal((await handle(request({ action: "preview", sql: `${sql}\n` }))).status, 400);
});

test("rollback-only preview and commit are bound to the exact file and signed-in session", async () => {
  const calls = [];
  const databaseFactory = async () => ({
    importApprovedSql: async (...args) => { calls.push(args); return summary; },
  });
  const preview = await handle(request({ action: "preview", sql }), { databaseFactory });
  assert.equal(preview.status, 200);
  assert.match(preview.headers.get("cache-control"), /no-store/);
  const body = await preview.json();
  assert.equal(body.rolledBack, true);
  assert.equal(body.previewed, true);
  assert.equal(body.imported, undefined);
  assert.deepEqual(calls[0], [sql, hash(sql), "owner@example.com", true]);
  const receipt = body.receipt;
  const committed = await handle(request({ action: "import", sql, receipt, acknowledge: true }), { databaseFactory });
  assert.equal(committed.status, 200);
  assert.equal((await committed.json()).imported, true);
  assert.deepEqual(calls[1], [sql, hash(sql), "owner@example.com", false]);
  assert.equal(JSON.stringify(body).includes(source[0].fingerprint), false);
});

test("missing, forged, expired, different-login and different-purpose preview approvals cannot commit", async () => {
  const receipt = (await (await handle(request({ action: "preview", sql }))).json()).receipt;
  const input = { action: "import", sql, receipt, acknowledge: true };
  for (const update of [
    { receipt: undefined }, { receipt: "forged" }, { acknowledge: false },
    { receipt: seal({ hash: hash(sql), sub: session.sub, csrf: session.csrf, exp: now + 1000 }, "session", settings) },
  ]) assert.equal((await handle(request({ ...input, ...update }))).status, 403);
  assert.equal((await handle(request(input), { now: () => now + 15 * 60 * 1000 })).status, 403);
  const another = createSession({ sub: session.sub, email: "owner@example.com" }, settings, now);
  const csrf = unseal(another, "session", settings, now).csrf;
  assert.equal((await handle(request(input, {
    Cookie: `${settings.sessionCookie}=${another}`, "X-Vendor-CSRF": csrf,
  }))).status, 403);
});

test("database failures never disclose SQL, customer data, credentials or claim an acknowledged import", async () => {
  const databaseFactory = async () => ({ importApprovedSql: async () => {
    throw Object.assign(new Error("private SQL and credentials must stay out of logs"), { code: "42501" });
  } });
  const response = await handle(request({ action: "preview", sql }), { databaseFactory });
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.imported, undefined);
  assert.doesNotMatch(JSON.stringify(body), /private SQL|credentials|DO \$test\$/);
  assert.equal(config.path, "/api/vendor-import");
  assert.deepEqual(config.rateLimit.aggregateBy, ["ip", "domain"]);
});

test("malformed acknowledgements fail and private adapter fields are excluded", async () => {
  for (const result of [undefined, {}, { ...summary, requests: 2 }, { ...summary, totalPaise: 1 },
    { ...summary, statusCounts: { Invented: 1 } }]) {
    const response = await handle(request({ action: "preview", sql }), {
      databaseFactory: async () => ({ importApprovedSql: async () => result }),
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).receipt, undefined);
  }
  const response = await handle(request({ action: "preview", sql }), {
    databaseFactory: async () => ({ importApprovedSql: async () => ({ ...summary, source: "private" }) }),
  });
  assert.equal((await response.json()).source, undefined);
  const conflict = await handle(request({ action: "preview", sql }), {
    databaseFactory: async () => ({ importApprovedSql: async () => {
      throw new Error("Private query", { cause: { code: "P0001" } });
    } }),
  });
  assert.equal(conflict.status, 409);
});

test("vendor page has no historical-import controls or client requests while retaining normal dashboard actions", async () => {
  const html = await readFile(new URL("../vendor-app/vendor/index.html", import.meta.url), "utf8");
  const app = await readFile(new URL("../vendor-app/vendor.mjs", import.meta.url), "utf8");
  const css = await readFile(new URL("../vendor-app/vendor.css", import.meta.url), "utf8");
  assert.doesNotMatch(html, /historical import|Import historical|id="(?:open-import|close-import|import-[^"]+|preview-import|commit-import)"|accept="\.sql"/);
  assert.doesNotMatch(app, /vendor-import|clearImport|setImportBusy|submitImport|importBusy|importController|importReceipt|importSql|validImportSummary/);
  assert.doesNotMatch(css, /vendor-import-/);
  assert.match(html, /id="open-prices"/);
  assert.match(html, /id="refresh-orders"/);
  assert.match(html, /id="order-list"/);
  assert.match(css, /\.vendor-page \.vendor-price-visibility input/);
  assert.doesNotMatch(app, /innerHTML|localStorage|sessionStorage/);
});
