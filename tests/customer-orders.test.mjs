import { test } from "node:test";
import assert from "node:assert/strict";
import { handleCustomerOrders } from "../netlify/functions/customer-orders.mjs";

const origin = "https://shop.example";
const env = { CUSTOMER_PHONE_ACCESS_MODE: "demo", ORDER_BACKEND: "netlify-db", ORDER_PDF_SECRET: "synthetic-test-secret-".repeat(3) };
function request(body, overrides = {}) {
  return new Request(`${origin}/api/customer-orders`, {
    method: body === undefined ? "GET" : "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), ...overrides,
  });
}

test("phone history is disabled by default and rejects non-demo modes without reading records", async () => {
  const databaseFactory = async () => { throw new Error("Database must not be accessed"); };
  assert.deepEqual(await (await handleCustomerOrders(request(), { env: {}, databaseFactory })).json(), { enabled: false, mode: "off" });
  assert.equal((await handleCustomerOrders(request({ phone: "9876543210", page: 1 }), { env: {}, databaseFactory })).status, 403);
  assert.equal((await handleCustomerOrders(request(), { env: { ...env, CUSTOMER_PHONE_ACCESS_MODE: "live" }, databaseFactory })).status, 503);
});

test("demo history normalizes the exact phone number and passes a bounded page to the database", async () => {
  let lookup;
  const response = await handleCustomerOrders(request({ phone: "+91 98765 43210", page: 2 }), {
    env, databaseFactory: async () => ({
      async demoPhoneHistory(phone, page) { lookup = { phone, page }; return { orders: [], total: 0, page, pageSize: 20 }; },
    }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(lookup, { phone: "9876543210", page: 2 });
  assert.deepEqual(await response.json(), { orders: [], total: 0, page: 2, pageSize: 20, mode: "demo", verified: false });
  assert.match(response.headers.get("cache-control"), /no-store/);
});

test("invalid input and cross-origin requests never reach the demo database", async () => {
  const options = { env, databaseFactory: async () => { throw new Error("Must not read database"); } };
  for (const phone of ["1234", "987654321", "9876543210 OR 1=1"]) {
    assert.equal((await handleCustomerOrders(request({ phone, page: 1 }), options)).status, 400);
  }
  for (const page of [0, 1.1, 100001, "1"]) {
    assert.equal((await handleCustomerOrders(request({ phone: "9876543210", page }), options)).status, 400);
  }
  assert.equal((await handleCustomerOrders(request({ phone: "9876543210", page: 1 }, {
    headers: { Origin: "https://attacker.example", "Content-Type": "application/json" },
  }), options)).status, 403);
  assert.equal((await handleCustomerOrders(request({ phone: "9876543210", page: 1 }, {
    headers: { Origin: origin, "Content-Type": "text/plain" },
  }), options)).status, 415);
  assert.equal((await handleCustomerOrders(request({ phone: "9876543210", page: 1, extra: "x".repeat(1100) }), options)).status, 413);
});

test("database failure and unsupported backends are explicit failures, not empty successful histories", async () => {
  const body = { phone: "9876543210", page: 1 };
  assert.equal((await handleCustomerOrders(request(body), {
    env, databaseFactory: async () => { throw new Error("offline"); },
  })).status, 503);
  assert.equal((await handleCustomerOrders(request(body), { env: { ...env, ORDER_BACKEND: "sheets" } })).status, 503);
});

test("selected order is fetched by exact phone and reference, with inaccessible orders returning 404", async () => {
  let lookup;
  const response = await handleCustomerOrders(request({ phone: "+91 98765 43210", orderId: "SBC-LEGACY-ORDER" }), {
    env, databaseFactory: async () => ({
      async demoPhoneOrder(phone, orderId) {
        lookup = { phone, orderId };
        return { ok: true, order: { orderId, status: "Confirmed", statusHistory: [] } };
      },
    }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(lookup, { phone: "9876543210", orderId: "SBC-LEGACY-ORDER" });
  assert.equal((await response.json()).order.status, "Confirmed");
  const missing = await handleCustomerOrders(request({ phone: "9876543211", orderId: "SBC-LEGACY-ORDER" }), {
    env, databaseFactory: async () => ({ async demoPhoneOrder() { return { ok: false, error: "NOT_FOUND" }; } }),
  });
  assert.equal(missing.status, 404);
  assert.equal((await handleCustomerOrders(request({ phone: "9876543210", orderId: "x' OR 1=1" }), { env })).status, 400);
});

test("saved-details lookup returns only the latest profile fields for the exact normalized phone", async () => {
  let lookup;
  const response = await handleCustomerOrders(request({ phone: "+91 98765 43210", profile: true }), {
    env, databaseFactory: async () => ({
      async demoPhoneProfile(phone) {
        lookup = phone;
        return { name: "Synthetic customer", fulfilment: "delivery", address: "Synthetic delivery address",
          orderId: "must-not-expose", items: "must-not-expose" };
      },
    }),
  });
  assert.equal(response.status, 200);
  assert.equal(lookup, "9876543210");
  assert.deepEqual(await response.json(), {
    profile: { name: "Synthetic customer", fulfilment: "delivery", address: "Synthetic delivery address" },
    phone: "9876543210", mode: "demo", verified: false,
  });
  assert.match(response.headers.get("cache-control"), /private, no-store/);
});

test("new customers have no saved profile; outages and invalid requests are not treated as missing profiles", async () => {
  const body = { phone: "9876543210", profile: true };
  const missing = await handleCustomerOrders(request(body), {
    env, databaseFactory: async () => ({ demoPhoneProfile: async () => null }),
  });
  assert.equal(missing.status, 200);
  assert.equal((await missing.json()).profile, null);
  for (const saved of [{ name: 5, address: "", fulfilment: "pickup" }, undefined]) {
    assert.equal((await handleCustomerOrders(request(body), {
      env, databaseFactory: async () => ({ demoPhoneProfile: async () => saved }),
    })).status, 503);
  }
  assert.equal((await handleCustomerOrders(request(body), {
    env, databaseFactory: async () => { throw new Error("offline"); },
  })).status, 503);
  const blocked = { env, databaseFactory: async () => { throw new Error("Must not access database"); } };
  for (const extra of [{ profile: false }, { profile: "true" }, { page: 1 }, { orderId: "SBC-TEST" }]) {
    assert.equal((await handleCustomerOrders(request({ ...body, ...extra }), blocked)).status, 400);
  }
  assert.equal((await handleCustomerOrders(request(body), { ...blocked, env: {} })).status, 403);
  assert.equal((await handleCustomerOrders(request(body, {
    headers: { Origin: "https://elsewhere.example", "Content-Type": "application/json" },
  }), blocked)).status, 403);
});
