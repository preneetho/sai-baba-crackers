import { vendorSettings, vendorJson, vendorSession, sameOriginMutation } from "../lib/vendor-auth.mjs";
import { orderBackend } from "../lib/order-backend.mjs";
import { ORDER_STATUSES, ORDER_ID, PAGE_SIZE, validOrder } from "../../vendor-app/vendor-model.mjs";

export async function handleVendorOrders(request, {
  env = process.env, fetchImpl = fetch, now = Date.now,
  databaseFactory = async () => (await import("../lib/order-database.mjs")).getOrderDatabase(),
} = {}) {
  const settings = vendorSettings(env);
  if (!settings || new URL(request.url).origin !== settings.origin) {
    return vendorJson({ error: "Vendor access is not configured for this site." }, 503);
  }
  const session = vendorSession(request, settings, now());
  if (!session) return vendorJson({ error: "Your vendor session has expired or access was removed. Sign in again." }, 401);
  if (!["GET", "POST"].includes(request.method)) return vendorJson({ error: "Use GET or POST." }, 405);
  const backend = orderBackend(env);
  if (!backend) return vendorJson({ error: "The order backend is not configured. Check ORDER_BACKEND and its required settings." }, 503);
  let input;
  if (request.method === "GET") {
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some(key => !["orderId", "query", "status", "page"].includes(key)) ||
        [...new Set(params.keys())].some(key => params.getAll(key).length !== 1)) {
      return vendorJson({ error: "Invalid dashboard query." }, 400);
    }
    if (params.has("orderId")) {
      if (params.size !== 1 || !ORDER_ID.test(params.get("orderId"))) return vendorJson({ error: "Invalid request ID." }, 400);
      input = { action: "vendor-detail", orderId: params.get("orderId") };
    } else {
      const query = (params.get("query") ?? "").trim();
      const status = params.get("status") ?? "";
      const pageText = params.get("page") ?? "1";
      const page = Number(pageText);
      if (query.length > 80 || /[\u0000-\u001f\u007f]/.test(query) ||
          (status && !ORDER_STATUSES.includes(status)) ||
          !/^[1-9]\d{0,5}$/.test(pageText) || page > backend.maxPage) {
        return vendorJson({ error: "Use a valid search, status and page." }, 400);
      }
      input = { action: "vendor-list", query, status, page };
    }
  } else {
    if (!sameOriginMutation(request, settings, session)) return vendorJson({ error: "Refresh the dashboard before changing an order." }, 403);
    if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
      return vendorJson({ error: "Send the status update as JSON." }, 415);
    }
    if (Number(request.headers.get("content-length")) > 1024) return vendorJson({ error: "Status update is too large." }, 413);
    try {
      const body = await request.text();
      if (Buffer.byteLength(body) > 1024) return vendorJson({ error: "Status update is too large." }, 413);
      const update = JSON.parse(body);
      if (!update || !ORDER_ID.test(update.orderId ?? "") || !ORDER_STATUSES.includes(update.status) ||
          !ORDER_STATUSES.includes(update.expectedStatus)) return vendorJson({ error: "Invalid order status update." }, 400);
      input = { action: "vendor-status", orderId: update.orderId, status: update.status, expectedStatus: update.expectedStatus };
    } catch {
      return vendorJson({ error: "The status update could not be read." }, 400);
    }
  }
  try {
    let result;
    if (backend.name === "netlify-db") {
      result = await (await databaseFactory()).dashboard(input, session.email);
    } else {
      const connection = backend.connection;
      const upstream = await fetchImpl(connection.url, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...input, secret: connection.secret }),
        signal: AbortSignal.timeout(20000), redirect: "follow",
      });
      if (!upstream.ok) throw new Error("Sheet HTTP failure");
      const text = await upstream.text();
      if (text.length > 1000000) throw new Error("Sheet response too large");
      result = JSON.parse(text);
    }
    if (result?.ok !== true) {
      if (result?.error === "NOT_FOUND") return vendorJson({ error: "This request is no longer in the order register. Refresh the list." }, 404);
      if (result?.error === "STATUS_CONFLICT") return vendorJson({ error: "Another vendor changed this status. Reload the request before updating it." }, 409);
      if (result?.error === "REGISTER_TOO_LARGE") return vendorJson({ error: "The register exceeds 10,000 data rows. Contact the site owner to expand dashboard capacity; do not delete order records." }, 503);
      throw new Error("Order action not acknowledged");
    }
    if (input.action !== "vendor-list") {
      if (!validOrder(result.order, true) || result.order.orderId !== input.orderId ||
          (input.action === "vendor-status" && result.order.status !== input.status)) {
        throw new Error("Order response invalid");
      }
      const keys = ["orderId", "createdAt", "status", "name", "phone", "fulfilment", "total",
        "address", "preferredDate", "items", "subtotal", "discountPercent", "discount", "deliveryCharge", "notes", "couponCode"];
      return vendorJson({ order: Object.fromEntries(keys.map(key => [key, result.order[key]])) });
    }
    if (!Array.isArray(result.orders) || result.orders.length > PAGE_SIZE || !result.orders.every(order => validOrder(order)) ||
        !Number.isSafeInteger(result.total) || result.total < 0 || (backend.name === "sheets" && result.total > 10000) ||
        result.page !== input.page || !result.stats ||
        !Number.isFinite(result.stats.requestValue) || result.stats.requestValue < 0 ||
        !ORDER_STATUSES.every(status => Number.isInteger(result.stats[status]) && result.stats[status] >= 0) ||
        ORDER_STATUSES.reduce((sum, status) => sum + result.stats[status], 0) !== result.total) {
      throw new Error("Order list response invalid");
    }
    // Never expose fingerprints, connection details or audit identities to list responses.
    const orders = result.orders.map(({ orderId, createdAt, status, name, phone, fulfilment, total }) =>
      ({ orderId, createdAt, status, name, phone, fulfilment, total }));
    const stats = Object.fromEntries(["requestValue", ...ORDER_STATUSES].map(key => [key, result.stats[key]]));
    return vendorJson({ orders, total: result.total, page: result.page, stats });
  } catch {
    console.error("Vendor order backend failed or returned an invalid acknowledgement.");
    return vendorJson({ error: backend.name === "netlify-db" ?
      "The database could not confirm this operation. Reload the request before repeating a status change. Check database availability and migrations." :
      "The Sheet could not confirm this operation. Retry or check the Sheet before repeating a status change. Verify the latest Apps Script is deployed." }, 503);
  }
}

export default async request => handleVendorOrders(request);
export const config = {
  path: "/api/vendor-orders",
  rateLimit: { windowLimit: 60, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
