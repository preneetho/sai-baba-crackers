import { getStore } from "@netlify/blobs";
import { DEFAULT_OFFERS, checkOffers, validOfferVersion } from "../../vendor-app/offers-model.mjs";

const KEY = "checkout-offers";
const offerStore = () => getStore({ name: "site-settings", consistency: "strong" });
export async function readOffers({ store = offerStore() } = {}) {
  const entry = await store.getWithMetadata(KEY, { type: "json", consistency: "strong" });
  if (!entry) return { offers: structuredClone(DEFAULT_OFFERS), version: null };
  checkOffers(entry.data);
  if (entry.etag === null || !validOfferVersion(entry.etag)) throw new Error("Invalid saved offer version.");
  return { offers: entry.data, version: entry.etag };
}
export async function saveOffers(offers, version, { store = offerStore() } = {}) {
  checkOffers(offers);
  if (!validOfferVersion(version)) throw new Error("Reload the saved offers before editing.");
  const result = await store.setJSON(KEY, offers, version === null ? { onlyIfNew: true } : { onlyIfMatch: version });
  if (result?.modified === false) {
    const error = new Error("Offers changed in another session. Reload the saved settings before trying again.");
    error.code = "OFFERS_CONFLICT";
    throw error;
  }
  if (result?.modified !== true || result.etag === null || !validOfferVersion(result.etag)) {
    throw new Error("The offer settings write was not acknowledged.");
  }
  return { offers, version: result.etag };
}
