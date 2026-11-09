import { products, vendor } from "../../vendor-app/catalog.mjs";
import { validCatalogue, catalogueProducts } from "../../vendor-app/catalogue-model.mjs";
import { orderBackend } from "../lib/order-backend.mjs";

export async function handleCatalogue(request, {
  env = process.env,
  databaseFactory = async () => (await import("../lib/order-database.mjs")).getOrderDatabase(),
} = {}) {
  const respond = (body, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff" },
  });
  if (request.method !== "GET") return respond({ error: "Use GET." }, 405);
  if (new URL(request.url).search) return respond({ error: "Only the active price list is public." }, 400);
  const backend = orderBackend(env);
  if (!backend) return respond({ error: "The catalogue backend is not configured. Contact the shop." }, 503);
  try {
    const catalogue = backend.name === "netlify-db" ? await (await databaseFactory()).activeCatalogue() :
      { year: vendor.year, revision: 0, products };
    if (!validCatalogue(catalogue)) throw new Error("Invalid catalogue response.");
    return respond({ year: catalogue.year, revision: catalogue.revision, products: catalogueProducts(catalogue.products, true) });
  } catch {
    console.error("Active catalogue could not be loaded. Check database availability and migrations.");
    return respond({ error: "The price list is unavailable. Retry loading it or contact the shop." }, 503);
  }
}

export default request => handleCatalogue(request);
export const config = { path: "/api/catalogue",
  rateLimit: { windowLimit: 120, windowSize: 60, aggregateBy: ["ip", "domain"] } };
