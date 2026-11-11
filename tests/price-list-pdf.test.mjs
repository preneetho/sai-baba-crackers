import { test } from "node:test";
import assert from "node:assert/strict";
import { handleVendorPriceListPdf } from "../netlify/functions/vendor-price-list-pdf.mjs";
import { generatePriceListPdf } from "../netlify/lib/pdf.mjs";
import { createSession, vendorSettings } from "../netlify/lib/vendor-auth.mjs";
import { products } from "../vendor-app/catalog.mjs";

const now = Date.parse("2026-11-12T06:30:00Z");
const origin = "https://vendor.example";
const env = {
  ORDER_BACKEND: "netlify-db", ORDER_PDF_SECRET: "synthetic-pdf-only-secret-".repeat(3),
  VENDOR_APP_ORIGIN: origin, VENDOR_ALLOWED_EMAILS: "owner@example.com",
  VENDOR_GOOGLE_CLIENT_ID: "synthetic.apps.googleusercontent.com",
  VENDOR_GOOGLE_CLIENT_SECRET: "synthetic-only",
  VENDOR_SESSION_SECRET: "synthetic-pdf-vendor-session-".repeat(3),
};
const settings = vendorSettings(env);
const cookie = createSession({ sub: "synthetic", email: "owner@example.com" }, settings, now);
const catalogue = { year: 2027, revision: 3, products: [
  { ...products[0], price: 123.45 },
  { ...products[1], hidden: true },
  { ...products[2], category: "Synthetic category" },
] };
const request = (query = "?year=2027&revision=3", authenticated = true, method = "GET") =>
  new Request(origin + "/api/vendor-price-list-pdf" + query, {
    method, headers: authenticated ? { Cookie: `${settings.sessionCookie}=${cookie}` } : {},
  });
const options = {
  env, now: () => now,
  databaseFactory: async () => ({ priceLists: async input => {
    assert.deepEqual(input, { year: 2027 });
    return { catalogue };
  } }),
};

test("vendor PDF downloads the exact saved year and version, omits hidden products and is not cached", async () => {
  const response = await handleVendorPriceListPdf(request(), {
    ...options, generatePdf: async (value, createdAt) => {
      assert.equal(value.year, 2027);
      assert.equal(value.revision, 3);
      assert.deepEqual(value.products.map(product => product.id), [products[0].id, products[2].id]);
      assert.equal(value.products[0].price, 123.45);
      assert.equal(createdAt, new Date(now).toISOString());
      return Buffer.from("%PDF-test");
    },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/pdf");
  assert.equal(response.headers.get("content-disposition"), 'attachment; filename="sai-baba-price-list-2027-v3.pdf"');
  assert.match(response.headers.get("cache-control"), /private, no-store/);
  assert.equal(await response.text(), "%PDF-test");
});

test("PDF access requires a current approved vendor session and strict year/version parameters", async () => {
  const locked = { ...options, databaseFactory: async () => { assert.fail("Invalid access must not read saved prices"); } };
  assert.equal((await handleVendorPriceListPdf(request("", false), locked)).status, 401);
  assert.equal((await handleVendorPriceListPdf(request(), { ...locked, now: () => now + 86400000 })).status, 401);
  assert.equal((await handleVendorPriceListPdf(request(), { ...locked, env: {} })).status, 503);
  assert.equal((await handleVendorPriceListPdf(request("?year=2027&revision=3", true, "POST"), locked)).status, 405);
  for (const query of ["", "?year=2027", "?year=2027&revision=0", "?year=2027&revision=1.5",
    "?year=2027&revision=3&year=2026", "?year=2027&revision=3&extra=1",
    "?year=0027&revision=3", "?year=2027&revision=9007199254740992"]) {
    assert.equal((await handleVendorPriceListPdf(request(query), locked)).status, 400, query);
  }
});

test("changed revisions, empty visible lists and unavailable data never produce a successful PDF", async () => {
  const guarded = { ...options, generatePdf: async () => { assert.fail("Do not generate misleading PDFs"); } };
  assert.equal((await handleVendorPriceListPdf(request("?year=2027&revision=2"), guarded)).status, 409);
  const database = value => ({ databaseFactory: async () => ({ priceLists: async () => ({ catalogue: value }) }) });
  assert.equal((await handleVendorPriceListPdf(request(), {
    ...guarded, ...database({ ...catalogue, products: catalogue.products.map(product => ({ ...product, hidden: true })) }),
  })).status, 400);
  for (const value of [{ ...catalogue, year: 2028 }, { ...catalogue, products: [] }]) {
    assert.equal((await handleVendorPriceListPdf(request(), { ...guarded, ...database(value) })).status, 503);
  }
  assert.equal((await handleVendorPriceListPdf(request(), {
    ...guarded, databaseFactory: async () => { throw new Error("Synthetic outage"); },
  })).status, 503);
  const failed = await handleVendorPriceListPdf(request(), {
    ...options, generatePdf: async () => { throw Object.assign(new Error("Unsupported glyph"), { code: "PDF_UNSUPPORTED_TEXT" }); },
  });
  assert.equal(failed.status, 503);
  assert.match((await failed.json()).error, /no text was silently removed/);
});

test("real price-list PDFs retain Unicode and paginate the maximum catalogue without blank footer pages", async () => {
  const items = Array.from({ length: 200 }, (_, index) => ({
    ...products[0], id: index + 1, name: `Product ${index + 1} - రంగు दीप`,
    category: `Category ${Math.floor(index / 20) + 1}`, price: 123.45,
  }));
  const bytes = await generatePriceListPdf({ year: 2027, revision: 3, products: items }, new Date(now).toISOString());
  assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
  assert.ok(bytes.subarray(-20).toString().includes("%%EOF"));
  const pages = bytes.toString("latin1").match(/\/Type \/Page\b/g)?.length ?? 0;
  assert.ok(pages > 1 && pages < 12, `A complete 200-product price list should paginate compactly: ${pages}`);
  assert.ok(bytes.length < 1024 * 1024);
});
