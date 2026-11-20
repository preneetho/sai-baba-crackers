import { vendorSettings, vendorJson, vendorSession, sameOriginMutation } from "../lib/vendor-auth.mjs";
import { orderBackend } from "../lib/order-backend.mjs";
import { ORDER_ID, ORDER_STATUSES, validOrder } from "../../vendor-app/vendor-model.mjs";
import { revisionInputError, revisionFields, revisionAcknowledged } from "../../vendor-app/order-revision-model.mjs";
import { validPacking, validPackingInput } from "../../vendor-app/order-packing-model.mjs";

export async function handleVendorOrderRevisions(request, {
  env = process.env, now = Date.now,
  databaseFactory = async () => (await import("../lib/order-database.mjs")).getOrderDatabase(),
} = {}) {
  const settings = vendorSettings(env);
  if (!settings || new URL(request.url).origin !== settings.origin) return vendorJson({ error: "Vendor access is not configured for this site." }, 503);
  const session = vendorSession(request, settings, now());
  if (!session) return vendorJson({ error: "Your vendor session has expired. Sign in again." }, 401);
  if (request.method !== "POST") return vendorJson({ error: "Use POST." }, 405);
  if (!sameOriginMutation(request, settings, session)) return vendorJson({ error: "Refresh the dashboard before editing an order." }, 403);
  if (orderBackend(env)?.name !== "netlify-db") return vendorJson({ error: "Order editing requires the Netlify Database backend." }, 503);
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return vendorJson({ error: "Send the order revision as JSON." }, 415);
  if (Number(request.headers.get("content-length")) > 32768) return vendorJson({ error: "Order revision is too large." }, 413);
  const text = await request.text();
  if (Buffer.byteLength(text) > 32768) return vendorJson({ error: "Order revision is too large." }, 413);
  let input;
  try { input = JSON.parse(text); }
  catch { return vendorJson({ error: "The order revision could not be read." }, 400); }
  if (!input || typeof input.orderId !== "string" || !ORDER_ID.test(input.orderId) || !ORDER_STATUSES.includes(input.expectedStatus)) {
    return vendorJson({ error: "Use a valid request ID and saved status." }, 400);
  }
  const packingUpdate = input.action === "packing";
  const invalid = packingUpdate ? (validPackingInput(input) ? null : "Invalid packing update.") : revisionInputError(input);
  if (invalid) return vendorJson({ error: invalid }, 400);
  try {
    const result = await (await databaseFactory()).dashboard({ ...input, action: packingUpdate ? "vendor-pack" : "vendor-revise" }, session.email);
    if (result?.error === "NOT_FOUND") return vendorJson({ error: "This order was not found. Refresh the register." }, 404);
    if (result?.error === "REVISION_CONFLICT") return vendorJson({ error: "The order or replacement catalogue changed. Reload the order before editing again." }, 409);
    if (result?.error === "INVALID_REVISION") return vendorJson({ error: result.message }, 400);
    if (result?.error === "INVALID_PACKING") return vendorJson({ error: "Choose a saved order product and valid packing state." }, 400);
    if (packingUpdate) {
      if (result?.ok !== true || !validPacking(result.packing) ||
          result.packing.version !== input.expectedPackingVersion + 1 ||
          (result.packing.items.find(item => item.id === input.productId)?.state ?? "Not started") !== input.state) {
        throw new Error("Packing update was not acknowledged.");
      }
      return vendorJson({ packing: result.packing });
    }
    if (result?.ok !== true || !validOrder(result.order, true) ||
        (result.order.packing !== undefined && !validPacking(result.order.packing)) ||
        !revisionAcknowledged(result.order, input)) throw new Error("Order revision was not acknowledged.");
    const keys = ["orderId", "createdAt", "status", "name", "phone", "fulfilment", "total",
      "address", "preferredDate", "items", "subtotal", "discountPercent", "discount", "deliveryCharge", "notes", "couponCode"];
    return vendorJson({ order: {
      ...Object.fromEntries(keys.map(key => [key, result.order[key]])), ...revisionFields(result.order),
      ...(result.order.packing !== undefined && validPacking(result.order.packing) ? { packing: result.order.packing } : {}),
    } });
  } catch {
    console.error("Vendor order revision failed or returned an invalid acknowledgement.");
    return vendorJson({ error: "The database could not confirm the revision. Reload the order before retrying; check database availability and migrations." }, 503);
  }
}

export default async request => handleVendorOrderRevisions(request);
export const config = {
  path: "/api/vendor-order-revisions",
  rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
