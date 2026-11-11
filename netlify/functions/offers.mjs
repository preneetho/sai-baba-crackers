import { readOffers } from "../lib/offer-settings.mjs";

export async function handleOffers(request, options = {}) {
  const respond = (body, status = 200) => Response.json(body, {
    status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
  if (request.method !== "GET") return respond({ error: "Use GET." }, 405);
  if (new URL(request.url).search) return respond({ error: "Offers do not accept query parameters." }, 400);
  try { return respond(await readOffers(options)); }
  catch {
    console.error("Public offer settings could not be loaded.");
    return respond({ error: "Offers and delivery charges could not be loaded. Retry before checking out." }, 503);
  }
}
export default request => handleOffers(request);
export const config = { path: "/api/offers",
  rateLimit: { windowLimit: 120, windowSize: 60, aggregateBy: ["ip", "domain"] } };
