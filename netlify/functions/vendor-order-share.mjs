import { vendorSettings, vendorJson, vendorSession, sameOriginMutation } from "../lib/vendor-auth.mjs";
import { ORDER_ID } from "../../vendor-app/vendor-model.mjs";
import { handleVendorOrders } from "./vendor-orders.mjs";
import { saveOrderShare } from "../lib/order-shares.mjs";

export async function handleVendorOrderShare(request, {
  env = process.env, now = Date.now, createShare = saveOrderShare, ...backendOptions
} = {}) {
  const settings = vendorSettings(env);
  if (!settings || new URL(request.url).origin !== settings.origin) {
    return vendorJson({ error: "Vendor access is not configured for this site." }, 503);
  }
  const session = vendorSession(request, settings, now());
  if (!session) return vendorJson({ error: "Your vendor session has expired or access was removed. Sign in again." }, 401);
  if (request.method !== "POST") return vendorJson({ error: "Use POST to create a request link." }, 405);
  if (!sameOriginMutation(request, settings, session)) {
    return vendorJson({ error: "Refresh the dashboard before sharing a request." }, 403);
  }
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
    return vendorJson({ error: "Send the request ID as JSON." }, 415);
  }
  let orderId;
  try {
    if (Number(request.headers.get("content-length")) > 1024) return vendorJson({ error: "The share request is too large." }, 413);
    const body = await request.text();
    if (Buffer.byteLength(body) > 1024) return vendorJson({ error: "The share request is too large." }, 413);
    const input = JSON.parse(body);
    if (!input || Object.keys(input).length !== 1 || typeof input.orderId !== "string" || !ORDER_ID.test(input.orderId)) {
      return vendorJson({ error: "Use a valid request ID." }, 400);
    }
    orderId = input.orderId;
  } catch {
    return vendorJson({ error: "The share request could not be read." }, 400);
  }
  try {
    const url = new URL("/api/vendor-orders", settings.origin);
    url.searchParams.set("orderId", orderId);
    const details = await handleVendorOrders(new Request(url, {
      headers: { Cookie: request.headers.get("cookie") },
    }), { ...backendOptions, env, now });
    if (!details.ok) return details;
    const { order } = await details.json();
    const link = await createShare({ order, origin: settings.origin }, { now: () => new Date(now()) });
    return vendorJson(link);
  } catch {
    console.error("Shared request creation was not confirmed.");
    return vendorJson({ error: "The request link could not be saved. Retry when private link storage is available." }, 503);
  }
}

export default async request => handleVendorOrderShare(request);
export const config = {
  path: "/api/vendor-order-share",
  rateLimit: { windowLimit: 20, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
