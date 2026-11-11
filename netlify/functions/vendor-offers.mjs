import { vendorSettings, vendorJson, vendorSession, sameOriginMutation } from "../lib/vendor-auth.mjs";
import { readOffers, saveOffers } from "../lib/offer-settings.mjs";
import { checkOffers, validOfferVersion } from "../../vendor-app/offers-model.mjs";

export async function handleVendorOffers(request, { env = process.env, now = Date.now, store } = {}) {
  const settings = vendorSettings(env);
  if (!settings || new URL(request.url).origin !== settings.origin) return vendorJson({ error: "Vendor access is not configured for this site." }, 503);
  const session = vendorSession(request, settings, now());
  if (!session) return vendorJson({ error: "Your vendor session has expired. Sign in again." }, 401);
  if (!["GET", "POST"].includes(request.method)) return vendorJson({ error: "Use GET or POST." }, 405);
  if (new URL(request.url).search) return vendorJson({ error: "Offer settings do not accept query parameters." }, 400);
  let input;
  if (request.method === "POST") {
    if (!sameOriginMutation(request, settings, session)) return vendorJson({ error: "Refresh the dashboard before editing offers." }, 403);
    if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return vendorJson({ error: "Send offer settings as JSON." }, 415);
    if (Number(request.headers.get("content-length")) > 8192) return vendorJson({ error: "Offer settings are too large." }, 413);
    try {
      const body = await request.text();
      if (Buffer.byteLength(body) > 8192) return vendorJson({ error: "Offer settings are too large." }, 413);
      input = JSON.parse(body);
      if (!input || Object.keys(input).length !== 2 || !validOfferVersion(input.expectedVersion)) throw new Error("Reload the saved offers before editing.");
      checkOffers(input.offers);
    } catch (error) {
      return vendorJson({ error: error instanceof SyntaxError ? "Offer settings could not be read." : error.message }, 400);
    }
  }
  try {
    return vendorJson(request.method === "GET" ? await readOffers({ store }) :
      await saveOffers(input.offers, input.expectedVersion, { store }));
  } catch (error) {
    if (error.code === "OFFERS_CONFLICT") return vendorJson({ error: error.message }, 409);
    console.error("Vendor offer settings operation could not be confirmed.");
    return vendorJson({ error: "Offer settings could not be confirmed. Reload saved settings before repeating an update. Check Netlify Blobs availability." }, 503);
  }
}
export default request => handleVendorOffers(request);
export const config = { path: "/api/vendor-offers",
  rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ["ip", "domain"] } };
