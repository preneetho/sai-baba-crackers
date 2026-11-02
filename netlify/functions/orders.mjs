import { createHash } from "node:crypto";
import { DISCOUNT_PERCENT, sanitizeCart, cartLines, pricing, validateCustomer, createRequirement } from "../../vendor-app/order.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 16384;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}

export function buildOrder(input, now = new Date()) {
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      typeof input.requestId !== "string" || !UUID.test(input.requestId)) {
    throw new Error("The order reference is invalid. Close the review and try again.");
  }
  if (input.consent !== true) throw new Error("Agree to save and share your requirement before continuing.");
  if (!input.customer || typeof input.customer !== "object" || Array.isArray(input.customer)) {
    throw new Error("Customer details are required.");
  }
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
  const cart = sanitizeCart(input.cart);
  const customer = validateCustomer(input.customer, today);
  const message = createRequirement(cart, customer, today);
  const items = cartLines(cart);
  const amounts = { ...pricing(cart), discountPercent: DISCOUNT_PERCENT, deliveryCharge: 0 };
  const orderId = `SBC-${input.requestId.toUpperCase()}`;
  const fingerprint = createHash("sha256").update(JSON.stringify({ customer, items, amounts })).digest("hex");
  return {
    orderId, fingerprint, createdAt: now.toISOString(), status: "New",
    customer, items, amounts,
    message: `Order ID: ${orderId}\n${message}`,
  };
}

function settings(env) {
  const url = env.GOOGLE_SHEETS_WEBHOOK_URL;
  const secret = env.ORDER_TRACKING_SECRET;
  if (typeof url !== "string" || typeof secret !== "string" || secret.length < 32) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.hostname !== "script.google.com" ||
        parsed.port || parsed.username || parsed.password || parsed.search || parsed.hash ||
        !/^\/macros\/s\/[a-zA-Z0-9_-]+\/exec$/.test(parsed.pathname)) return null;
    return { url, secret };
  } catch {
    return null;
  }
}

function orderTime(createdAt) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(createdAt).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second} IST`;
}

export async function handleOrderRequest(request, {
  env = process.env, fetchImpl = fetch, now = () => new Date(),
} = {}) {
  if (request.method !== "GET" && request.method !== "POST") {
    const response = json({ error: "Use POST to save a requirement." }, 405);
    response.headers.set("Allow", "GET, POST");
    return response;
  }
  const connection = settings(env);
  if (!connection) {
    return json({ error: "Order tracking is not configured yet. Contact the shop; no requirement has been recorded." }, 503);
  }
  if (request.method === "GET") return json({ available: true });
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    return json({ error: "Submit your requirement from this website." }, 403);
  }
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
    return json({ error: "The requirement must be sent as JSON." }, 415);
  }
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) {
    return json({ error: "The requirement is too large." }, 413);
  }
  let input;
  try {
    const body = await request.text();
    if (Buffer.byteLength(body, "utf8") > MAX_BODY_BYTES) {
      return json({ error: "The requirement is too large." }, 413);
    }
    input = JSON.parse(body);
  } catch {
    return json({ error: "The requirement could not be read. Please retry." }, 400);
  }
  let order;
  try {
    order = buildOrder(input, now());
  } catch (error) {
    return json({ error: error.message }, 400);
  }
  let upstream;
  try {
    upstream = await fetchImpl(connection.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: connection.secret, order }),
      signal: AbortSignal.timeout(20000),
      redirect: "follow",
    });
  } catch {
    console.error("Order tracking: upstream request failed or timed out.");
    return json({ error: "We could not confirm saving your requirement. Keep this review open and retry to avoid duplicate records." }, 503);
  }
  if (!upstream.ok) {
    console.error(`Order tracking: upstream HTTP ${upstream.status}.`);
    return json({ error: "The order tracker is unavailable. Keep this review open and retry." }, 503);
  }
  let result;
  try {
    const body = await upstream.text();
    if (body.length > 2048) throw new Error("Unexpected tracker response size");
    result = JSON.parse(body);
  } catch {
    console.error("Order tracking: invalid upstream acknowledgement.");
    return json({ error: "We could not confirm the sheet update. Keep this review open and retry." }, 502);
  }
  if (result?.ok !== true || result.orderId !== order.orderId) {
    if (result?.error === "CONFLICT") {
      return json({ error: "This reference already records different details. Close the review and submit a new requirement." }, 409);
    }
    console.error("Order tracking: sheet did not acknowledge the requirement.");
    return json({ error: "Your requirement has not been acknowledged by the tracker. Keep this review open and retry, or contact the shop." }, 503);
  }
  const savedAt = typeof result.createdAt === "string" ? new Date(result.createdAt) : new Date(NaN);
  if (!Number.isFinite(savedAt.getTime()) || savedAt.toISOString() !== result.createdAt) {
    console.error("Order tracking: missing or invalid saved order timestamp. Check the Apps Script deployment version.");
    return json({ error: "We could not confirm the recorded order time. Keep this review open and retry, or contact the shop." }, 503);
  }
  const message = order.message.replace("\n", `\nOrder date & time: ${orderTime(savedAt)}\n`);
  return json({ orderId: order.orderId, message });
}

export default async request => handleOrderRequest(request);

export const config = {
  path: "/api/orders",
  rateLimit: { windowLimit: 10, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
