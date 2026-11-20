import { normalizeBrowserPhone } from "../../vendor-app/browser-customer-model.mjs";
import { orderBackend } from "../lib/order-backend.mjs";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}

export async function handleCustomerOrders(request, {
  env = process.env,
  databaseFactory = async () => (await import("../lib/order-database.mjs")).getOrderDatabase(),
} = {}) {
  const mode = env.CUSTOMER_PHONE_ACCESS_MODE ?? "off";
  if (!["off", "demo"].includes(mode)) {
    console.error("Customer phone-access mode is invalid.");
    return json({ error: "Customer history configuration is invalid. Contact the shop." }, 503);
  }
  if (!["GET", "POST"].includes(request.method)) {
    const response = json({ error: "Use POST to view order history." }, 405);
    response.headers.set("Allow", "GET, POST");
    return response;
  }
  if (request.method === "GET") return json({ enabled: mode === "demo", mode });
  if (mode !== "demo") return json({ error: "Phone-only server history is disabled. Verified access is required for real customer data." }, 403);
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    return json({ error: "View order history from this website." }, 403);
  }
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
    return json({ error: "Send the phone entry as JSON." }, 415);
  }
  if (Number(request.headers.get("content-length")) > 1024) return json({ error: "The request is too large." }, 413);
  let input;
  let phone;
  try {
    const body = await request.text();
    if (Buffer.byteLength(body, "utf8") > 1024) return json({ error: "The request is too large." }, 413);
    input = JSON.parse(body);
    if (!input || typeof input !== "object" || Array.isArray(input) || typeof input.phone !== "string") {
      return json({ error: "Enter a valid Indian mobile number." }, 400);
    }
    phone = normalizeBrowserPhone(input.phone);
    if (input.orderId !== undefined) {
      if (typeof input.orderId !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(input.orderId)) {
        return json({ error: "The requested order reference is invalid." }, 400);
      }
    } else if (!Number.isSafeInteger(input.page) || input.page < 1 || input.page > 100000) {
      return json({ error: "The requested page is invalid." }, 400);
    }
  } catch {
    return json({ error: "The phone entry could not be read. Enter a valid Indian mobile number." }, 400);
  }
  if (orderBackend(env)?.name !== "netlify-db") {
    return json({ error: "Order history requires the Netlify Database backend." }, 503);
  }
  try {
    const database = await databaseFactory();
    if (input.orderId !== undefined) {
      const result = await database.demoPhoneOrder(phone, input.orderId);
      if (!result.ok) return json({ error: "This order was not found for your mobile number." }, 404);
      return json({ order: result.order, mode: "demo", verified: false });
    }
    const result = await database.demoPhoneHistory(phone, input.page);
    return json({ ...result, mode: "demo", verified: false });
  } catch {
    console.error("Demo customer request history could not be loaded.");
    return json({ error: "Previous requests could not be loaded. Retry or contact the shop." }, 503);
  }
}

export default handleCustomerOrders;
export const config = { path: "/api/customer-orders" };
