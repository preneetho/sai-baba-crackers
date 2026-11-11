import { readOffers } from "../lib/offer-settings.mjs";
import { couponOffer, isPublicCoupon, normalizeCoupon, validOfferVersion } from "../../vendor-app/offers-model.mjs";

export async function handleOffers(request, options = {}) {
  const respond = (body, status = 200) => Response.json(body, {
    status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
  if (!["GET", "POST"].includes(request.method)) return respond({ error: "Use GET or POST." }, 405);
  if (new URL(request.url).search) return respond({ error: "Offers do not accept query parameters." }, 400);
  let input;
  if (request.method === "POST") {
    if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
      return respond({ error: "Send the coupon code as JSON." }, 415);
    }
    if (Number(request.headers.get("content-length")) > 1024) return respond({ error: "Coupon request is too large." }, 413);
    try {
      const body = await request.text();
      if (Buffer.byteLength(body) > 1024) return respond({ error: "Coupon request is too large." }, 413);
      input = JSON.parse(body);
      if (!input || Object.keys(input).length !== 2 || !validOfferVersion(input.version) ||
        typeof input.code !== "string" || input.code.length > 24 ||
        !/^[A-Z0-9][A-Z0-9_-]{1,23}$/.test(normalizeCoupon(input.code))) {
        return respond({ error: "Enter a valid coupon code and reload current offers." }, 400);
      }
    } catch { return respond({ error: "Coupon request could not be read." }, 400); }
  }
  let settings;
  try { settings = await readOffers(options); }
  catch {
    console.error("Public offer settings could not be loaded.");
    return respond({ error: "Offers and delivery charges could not be loaded. Retry before checking out." }, 503);
  }
  if (request.method === "GET") {
    return respond({ ...settings, offers: { ...settings.offers, coupons: settings.offers.coupons.filter(isPublicCoupon) } });
  }
  if (input.version !== settings.version) {
    return respond({ error: "Offers changed. Reload offers before applying this code.", offersChanged: true }, 409);
  }
  try { return respond({ coupon: couponOffer(settings.offers, input.code), version: settings.version }); }
  catch (error) { return respond({ error: error.message }, 400); }
}
export default request => handleOffers(request);
export const config = { path: "/api/offers",
  rateLimit: { windowLimit: 120, windowSize: 60, aggregateBy: ["ip", "domain"] } };
