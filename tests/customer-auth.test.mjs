import { test } from "node:test";
import assert from "node:assert/strict";
import { customerSettings, verifyCustomer } from "../netlify/lib/customer-auth.mjs";
import { handleCustomerConfig } from "../netlify/functions/customer-config.mjs";
import { handleCustomerOrders } from "../netlify/functions/customer-orders.mjs";

const origin = "https://shop.example";
const projectId = "synthetic-project";
const phone = "+919000000001";
const env = {
  CUSTOMER_AUTH_MODE: "test",
  CUSTOMER_FIREBASE_WEB_CONFIG: JSON.stringify({
    apiKey: "synthetic-public-web-key", projectId, authDomain: `${projectId}.firebaseapp.com`,
    appId: "1:123:web:abc123", privateKey: "must-not-be-published",
  }),
  CUSTOMER_AUTH_TEST_PHONES: phone,
  ORDER_BACKEND: "netlify-db", ORDER_PDF_SECRET: "synthetic-pdf-secret-".repeat(3),
};
const settings = customerSettings(env);
const claims = { uid: "synthetic-customer", aud: projectId, iss: `https://securetoken.google.com/${projectId}`,
  phone_number: phone, firebase: { sign_in_provider: "phone" } };
const request = (path = "/api/customer-orders", token = "synthetic-token") =>
  new Request(origin + path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });

test("customer configuration is explicitly off until enabled and test mode fails closed when incomplete", () => {
  assert.deepEqual(customerSettings({}), { mode: "off" });
  for (const change of [
    { CUSTOMER_AUTH_MODE: "live" }, { CUSTOMER_FIREBASE_WEB_CONFIG: "" }, { CUSTOMER_AUTH_TEST_PHONES: "" },
    { FIREBASE_AUTH_EMULATOR_HOST: "localhost:9099" },
    { CUSTOMER_AUTH_TEST_PHONES: "+16505554567" },
    { CUSTOMER_FIREBASE_WEB_CONFIG: JSON.stringify({ ...settings.firebase, authDomain: "other.example" }) },
  ]) assert.throws(() => customerSettings({ ...env, ...change }), error => error.status === 503);
});

test("public configuration exposes only web configuration and fictional numbers, never arbitrary environment fields", async () => {
  const response = handleCustomerConfig(request("/api/customer-config"), { env });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /no-store/);
  assert.deepEqual(await response.json(), { mode: "test", firebase: settings.firebase, testPhones: [phone] });
  assert.equal(handleCustomerConfig(new Request(origin, { method: "POST" }), { env }).status, 405);
});

test("verified Firebase phone identity is derived only from the verified token", async () => {
  const identity = await verifyCustomer(request(), settings, {
    verifyIdToken: async (token, project) => {
      assert.equal(token, "synthetic-token"); assert.equal(project, projectId);
      return claims;
    },
  });
  assert.deepEqual(identity, { projectId, uid: claims.uid, phone, isTest: true });
  for (const changed of [
    { aud: "different-project" }, { iss: "https://attacker.example" }, { uid: "" },
    { phone_number: "+919000000002" }, { firebase: { sign_in_provider: "password" } },
  ]) await assert.rejects(verifyCustomer(request(), settings, {
    verifyIdToken: async () => ({ ...claims, ...changed }),
  }), error => error.status === 403);
});

test("missing, forged and expired tokens cannot authenticate and verification outages are explicit", async () => {
  await assert.rejects(verifyCustomer(request("/api/customer-orders", ""), settings), error => error.status === 401);
  await assert.rejects(verifyCustomer(request("/api/customer-orders", "forged"), settings), error => error.status === 401);
  for (const code of ["auth/id-token-expired", "auth/invalid-id-token"]) {
    await assert.rejects(verifyCustomer(request(), settings, {
      verifyIdToken: async () => { throw Object.assign(new Error("synthetic"), { code }); },
    }), error => error.status === 401);
  }
  await assert.rejects(verifyCustomer(request(), settings, {
    verifyIdToken: async () => { throw new Error("synthetic network outage"); },
  }), error => error.status === 503);
});

test("history requires verified identity before opening the database and never accepts a customer ID or phone query", async () => {
  let touched = false;
  const options = { env, databaseFactory: async () => { touched = true; throw new Error("Unexpected database access"); } };
  assert.equal((await handleCustomerOrders(request("/api/customer-orders", ""), options)).status, 401);
  for (const query of ["?phone=9000000001", "?customerId=other", "?page=0", "?page=1&page=2", "?orderId=invalid"]) {
    assert.equal((await handleCustomerOrders(request(`/api/customer-orders${query}`), options)).status, 400);
  }
  assert.equal(touched, false);
  const response = await handleCustomerOrders(request("/api/customer-orders?page=2"), {
    env, authenticate: async () => ({ projectId, uid: claims.uid, phone, isTest: true }),
    databaseFactory: async () => ({
      customerOrders: async (identity, query) => {
        assert.equal(identity.uid, claims.uid);
        assert.deepEqual(query, { page: 2, orderId: null });
        return { ok: true, orders: [], total: 0 };
      },
    }),
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /private, no-store/);
  assert.equal((await handleCustomerOrders(request(), {
    env, authenticate: async () => ({ uid: claims.uid }),
    databaseFactory: async () => ({ customerOrders: async () => ({ ok: false }) }),
  })).status, 404);
});
