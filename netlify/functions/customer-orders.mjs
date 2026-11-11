import { customerSettings, verifyCustomer, customerJson } from "../lib/customer-auth.mjs";
import { orderBackend } from "../lib/order-backend.mjs";

export async function handleCustomerOrders(request, {
  env = process.env, authenticate = verifyCustomer,
  databaseFactory = async () => (await import("../lib/order-database.mjs")).getOrderDatabase(),
} = {}) {
  if (request.method !== "GET") return customerJson({ error: "Use GET." }, 405);
  const query = new URL(request.url).searchParams;
  if ([...query.keys()].some(key => !["page", "orderId"].includes(key)) ||
      [...query.keys()].some(key => query.getAll(key).length !== 1) ||
      (query.has("page") && query.has("orderId")) ||
      (query.has("page") && !/^[1-9]\d{0,3}$/.test(query.get("page"))) ||
      (query.has("orderId") && !/^SBC-[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/.test(query.get("orderId")))) {
    return customerJson({ error: "Invalid order history request." }, 400);
  }
  let identity;
  try { identity = await authenticate(request, customerSettings(env)); }
  catch (error) { return customerJson({ error: error.message }, error.status ?? 503); }
  if (orderBackend(env)?.name !== "netlify-db") {
    return customerJson({ error: "Customer history requires the Netlify order database." }, 503);
  }
  try {
    const database = await databaseFactory();
    const result = await database.customerOrders(identity, {
      page: Number(query.get("page") ?? 1), orderId: query.get("orderId"),
    });
    return result.ok ? customerJson(result) : customerJson({ error: "Order request not found." }, 404);
  } catch {
    console.error("Customer order history could not be loaded.");
    return customerJson({ error: "Your history could not be loaded. Retry; no orders have been removed." }, 503);
  }
}
export default request => handleCustomerOrders(request);
export const config = { path: "/api/customer-orders",
  rateLimit: { windowLimit: 60, windowSize: 60, aggregateBy: ["ip", "domain"] } };
