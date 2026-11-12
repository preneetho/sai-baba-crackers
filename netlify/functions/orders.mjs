import { createHash } from "node:crypto";
import { MAX_WHATSAPP_URL_LENGTH, sanitizeCart, cartLines, pricing, validateCustomer, createRequirement, whatsappUrl } from "../../vendor-app/order.mjs";
import { DEFAULT_OFFERS } from "../../vendor-app/offers-model.mjs";
import { readOffers } from "../lib/offer-settings.mjs";
import { saveOrderPdf } from "../lib/order-pdfs.mjs";
import { saveOrderShare } from "../lib/order-shares.mjs";
import { orderBackend } from "../lib/order-backend.mjs";
import { validYear } from "../../vendor-app/catalogue-model.mjs";

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

export function buildOrder(input, now = new Date(), catalogue, offers = DEFAULT_OFFERS) {
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      typeof input.requestId !== "string" || !UUID.test(input.requestId)) {
    throw new Error("The order request ID is invalid. Close checkout and try again.");
  }
  if (input.consent !== true) throw new Error("Agree to save and share your order request before continuing.");
  if (!input.customer || typeof input.customer !== "object" || Array.isArray(input.customer)) {
    throw new Error("Customer details are required.");
  }
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
  const cart = sanitizeCart(input.cart, catalogue?.products);
  const customer = validateCustomer(input.customer, today);
  const couponCode = input.couponCode ?? "";
  const message = createRequirement(cart, customer, today, catalogue, offers, couponCode);
  const items = cartLines(cart, catalogue?.products);
  const calculated = pricing(cart, catalogue?.products, offers, couponCode, customer.fulfilment);
  const amounts = Object.fromEntries(["subtotal", "discount", "total", "discountPercent", "deliveryCharge", "couponCode"]
    .map(key => [key, calculated[key]]));
  const orderId = `SBC-${input.requestId.toUpperCase()}`;
  const fingerprint = createHash("sha256").update(JSON.stringify({
    customer, items, amounts, ...(catalogue ? { season: catalogue.year } : {}),
  })).digest("hex");
  return {
    orderId, fingerprint, createdAt: now.toISOString(), status: "New",
    customer, items, amounts,
    ...(catalogue ? { season: catalogue.year, catalogueRevision: catalogue.revision } : {}),
    message: `Order ID: ${orderId}\n${message}`,
  };
}

function orderTime(createdAt) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(createdAt).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second} IST`;
}

function submittedDetails(order, savedAt) {
  return {
    orderId: order.orderId, createdAt: savedAt.toISOString(), status: "New",
    ...order.customer, ...order.amounts,
    phone: `+91 ${order.customer.phone}`,
    fulfilment: order.customer.fulfilment === "delivery" ? (order.amounts.deliveryCharge === 0 ? "Free home delivery" : "Home delivery") : "Store pickup",
    items: order.items.map(item => `#${item.id} ${item.name} | ${item.brand}\nPack: ${item.unit}\n${item.quantity} pack${item.quantity === 1 ? "" : "s"} x Rs.${item.price.toFixed(2)} = Rs.${item.amount.toFixed(2)}`).join("\n\n"),
  };
}

function orderSummary(order, savedAt, pdf, backend, share) {
  if (share) return [
    `Order ID: ${order.orderId}`,
    `Order date & time: ${orderTime(savedAt)}`,
    `Customer: ${order.customer.name}`,
    `Mobile: +91 ${order.customer.phone}`,
    `Estimated total: Rs.${order.amounts.total.toFixed(2)}`,
    "",
    `Full order details (read-only): ${share.url}`,
    `Link expires: ${orderTime(new Date(share.expiresAt))}`,
    "Request only, not a confirmed order. No payment made.",
  ].join("\n");
  const register = backend === "netlify-db" ? "private order register" : "Google Sheet";
  const packs = order.items.reduce((sum, item) => sum + item.quantity, 0);
  const lines = [
    `Order ID: ${order.orderId}`,
    `Order date & time: ${orderTime(savedAt)}`,
    "Order request summary",
    `Customer: ${order.customer.name}`,
    `Mobile: +91 ${order.customer.phone}`,
    `Items: ${order.items.length} product${order.items.length === 1 ? "" : "s"} (${packs} pack${packs === 1 ? "" : "s"})`,
    `Delivery option: ${order.customer.fulfilment === "delivery" ? (order.amounts.deliveryCharge === 0 ? "Free home delivery" : "Home delivery") : "Store pickup"}`,
    `Estimated total: Rs.${order.amounts.total.toFixed(2)}`,
    "",
    ...(pdf ? [
      `Full order PDF (expires ${orderTime(new Date(pdf.expiresAt))}): ${pdf.url}`,
      `All details are in the PDF and the shop's ${register}.`,
    ] : [
      `Full item list and customer details are saved in the shop's ${register} under this ID.`,
      "Please confirm stock, final price and arrangements.",
    ]),
    "Request only, not a confirmed order. No payment made.",
  ];
  if (pdf && new URL(whatsappUrl(lines.join("\n"))).href.length > MAX_WHATSAPP_URL_LENGTH) {
    lines.splice(3, 1);
  }
  return lines.join("\n");
}

export async function handleOrderRequest(request, {
  env = process.env, fetchImpl = fetch, now = () => new Date(), savePdf = saveOrderPdf,
  saveShare = saveOrderShare,
  readOfferSettings = readOffers,
  databaseFactory = async () => (await import("../lib/order-database.mjs")).getOrderDatabase(),
} = {}) {
  if (request.method !== "GET" && request.method !== "POST") {
    const response = json({ error: "Use POST to save an order request." }, 405);
    response.headers.set("Allow", "GET, POST");
    return response;
  }
  const backend = orderBackend(env);
  if (!backend) {
    return json({ error: "Order tracking is not configured yet. Contact the shop; no order request has been recorded." }, 503);
  }
  if (request.method === "GET") {
    if (backend.name === "netlify-db") {
      try {
        await (await databaseFactory()).ready();
      } catch {
        console.error("Order database readiness could not be confirmed.");
        return json({ error: "The order database is unavailable or its schema is not deployed. No order request has been recorded." }, 503);
      }
    }
    return json({ available: true });
  }
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    return json({ error: "Submit your order request from this website." }, 403);
  }
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
    return json({ error: "The order request must be sent as JSON." }, 415);
  }
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) {
    return json({ error: "The order request is too large." }, 413);
  }
  let input;
  try {
    const body = await request.text();
    if (Buffer.byteLength(body, "utf8") > MAX_BODY_BYTES) {
      return json({ error: "The order request is too large." }, 413);
    }
    input = JSON.parse(body);
  } catch {
    return json({ error: "The order request could not be read. Please retry." }, 400);
  }
  let order;
  let database;
  let catalogue;
  if (backend.name === "netlify-db") {
    if (!validYear(input?.catalogue?.year) || !Number.isSafeInteger(input?.catalogue?.revision) ||
        input.catalogue.revision < 1) {
      return json({ error: "Refresh the catalogue and review current prices before submitting." }, 409);
    }
    try {
      database = await databaseFactory();
      catalogue = await database.catalogueVersion(input.catalogue.year, input.catalogue.revision);
    } catch (error) {
      if (error.code === "CATALOGUE_CONFLICT") return json({ error: error.message }, 409);
      console.error("Checkout price list could not be loaded.");
      return json({ error: "The price list could not be confirmed. Keep checkout open and retry." }, 503);
    }
  }
  let offerSettings;
  try { offerSettings = await readOfferSettings(); }
  catch {
    console.error("Checkout offers and delivery rules could not be loaded.");
    return json({ error: "Discounts and delivery charges could not be confirmed. Keep checkout open and retry." }, 503);
  }
  if (!Object.hasOwn(input ?? {}, "offerVersion") || input.offerVersion !== offerSettings.version) {
    return json({ error: "Offers or delivery charges changed. Return to your cart and reload offers before submitting.", offersChanged: true }, 409);
  }
  try {
    order = buildOrder(input, now(), catalogue, offerSettings.offers);
  } catch (error) {
    return json({ error: error.message }, 400);
  }
  let result;
  if (backend.name === "netlify-db") {
    try {
      result = await database.save(order);
    } catch (error) {
      if (error.code === "CATALOGUE_CONFLICT") return json({ error: error.message }, 409);
      console.error("Order database transaction failed or its acknowledgement was lost.");
      return json({ error: "We could not confirm saving your order request. Keep checkout open and retry with the same details to avoid duplicate records." }, 503);
    }
  } else {
    const connection = backend.connection;
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
      return json({ error: "We could not confirm saving your order request. Keep checkout open and retry to avoid duplicate records." }, 503);
    }
    if (!upstream.ok) {
      console.error(`Order tracking: upstream HTTP ${upstream.status}.`);
      return json({ error: "The order tracker is unavailable. Keep checkout open and retry." }, 503);
    }
    try {
      const body = await upstream.text();
      if (body.length > 2048) throw new Error("Unexpected tracker response size");
      result = JSON.parse(body);
    } catch {
      console.error("Order tracking: invalid upstream acknowledgement.");
      return json({ error: "We could not confirm the order tracker update. Keep checkout open and retry." }, 502);
    }
  }
  if (result?.ok !== true || result.orderId !== order.orderId) {
    if (result?.error === "CONFLICT") {
      return json({ error: `This request ID already records different details or prices. Check saved request ${order.orderId} with the shop before starting another request.` }, 409);
    }
    console.error("Order tracking: backend did not acknowledge the requirement.");
    return json({ error: "The tracker has not acknowledged your order request. Keep checkout open and retry, or contact the shop." }, 503);
  }
  const savedAt = typeof result.createdAt === "string" ? new Date(result.createdAt) : new Date(NaN);
  if (!Number.isFinite(savedAt.getTime()) || savedAt.toISOString() !== result.createdAt) {
    console.error("Order tracking: missing or invalid saved order timestamp.");
    return json({ error: "We could not confirm the recorded order request time. Keep checkout open and retry, or contact the shop." }, 503);
  }
  const message = order.message.replace("\n", `\nOrder date & time: ${orderTime(savedAt)}\n`);
  let share;
  if (input.shareConsent === true) {
    try {
      share = await saveShare({
        order: submittedDetails(order, savedAt), origin: new URL(request.url).origin, source: "submission",
      }, { now });
    } catch {
      console.error("Order detail link storage failed after the order was recorded.");
      return json({ error: `Your order request ${order.orderId} is saved, but its details link could not be prepared. Keep checkout open and retry with the same details to avoid duplicate records.` }, 503);
    }
  }
  let pdf;
  if (!share && input.pdfConsent === true && new URL(whatsappUrl(message)).href.length > MAX_WHATSAPP_URL_LENGTH) {
    try {
      pdf = await savePdf({ order, message, savedAt, origin: new URL(request.url).origin, secret: backend.secret });
    } catch (error) {
      console.error("Order PDF generation or storage failed after the order was recorded.");
      const detail = error.code === "PDF_UNSUPPORTED_TEXT" ?
        "Some characters could not be displayed in the PDF. Contact the shop with this ID; your complete details are still saved." :
        error.code === "PDF_EXPIRED" ? "Its seven-day PDF link has expired. Contact the shop with this ID." :
          "The PDF could not be prepared. Keep checkout open and retry with the same details.";
      return json({ error: `Your order request ${order.orderId} is saved. ${detail}` }, 503);
    }
  }
  return json({
    orderId: order.orderId, message, summary: orderSummary(order, savedAt, pdf, backend.name, share),
    ...(share ? { share } : {}), ...(pdf ? { pdf } : {}),
  });
}

export default async request => handleOrderRequest(request);

export const config = {
  path: "/api/orders",
  rateLimit: { windowLimit: 10, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
