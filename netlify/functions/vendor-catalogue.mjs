import { vendorSettings, vendorJson, vendorSession, sameOriginMutation } from "../lib/vendor-auth.mjs";
import { orderBackend } from "../lib/order-backend.mjs";
import { validCatalogue, validYear, catalogueProducts } from "../../vendor-app/catalogue-model.mjs";

export async function handleVendorCatalogue(request, {
  env = process.env, now = Date.now,
  databaseFactory = async () => (await import("../lib/order-database.mjs")).getOrderDatabase(),
} = {}) {
  const settings = vendorSettings(env);
  if (!settings || new URL(request.url).origin !== settings.origin) {
    return vendorJson({ error: "Vendor access is not configured for this site." }, 503);
  }
  const session = vendorSession(request, settings, now());
  if (!session) return vendorJson({ error: "Your vendor session has expired. Sign in again." }, 401);
  if (!["GET", "POST"].includes(request.method)) return vendorJson({ error: "Use GET or POST." }, 405);
  if (orderBackend(env)?.name !== "netlify-db") return vendorJson({ error: "Yearly price lists require Netlify Database." }, 503);
  let input;
  if (request.method === "GET") {
    const params = new URL(request.url).searchParams;
    if (params.size && (params.size !== 1 || !params.has("year") ||
        !/^\d{4}$/.test(params.get("year")) || !validYear(Number(params.get("year"))))) {
      return vendorJson({ error: "Choose a valid price-list year." }, 400);
    }
    input = params.size ? { year: Number(params.get("year")) } : {};
  } else {
    if (!sameOriginMutation(request, settings, session)) return vendorJson({ error: "Refresh the dashboard before editing prices." }, 403);
    if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
      return vendorJson({ error: "Send the price list as JSON." }, 415);
    }
    if (Number(request.headers.get("content-length")) > 512000) return vendorJson({ error: "Price list is too large." }, 413);
    try {
      const body = await request.text();
      if (Buffer.byteLength(body) > 512000) return vendorJson({ error: "Price list is too large." }, 413);
      input = JSON.parse(body);
      if (!input || !["create", "save", "activate"].includes(input.action) ||
          !validYear(input.year) || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1 ||
          (input.action === "create" && !validYear(input.sourceYear)) ||
          (input.action === "activate" && !validYear(input.expectedActiveYear)) ||
          (input.action === "save" && !validCatalogue({
            year: input.year, revision: input.expectedRevision, products: input.products,
          }))) return vendorJson({ error: "Use a valid year, version and product list (1-200 products; prices up to Rs.100,000 with at most two decimals)." }, 400);
    } catch {
      return vendorJson({ error: "The price-list update could not be read." }, 400);
    }
  }
  try {
    const result = await (await databaseFactory()).priceLists(input, session.email);
    if (!validCatalogue(result.catalogue) || !validYear(result.activeYear) || !Array.isArray(result.years) ||
        !result.years.some(year => year.year === result.activeYear) ||
        !result.years.every(year => validYear(year.year) && Number.isSafeInteger(year.revision) && year.revision > 0)) {
      throw new Error("Invalid price-list acknowledgement.");
    }
    return vendorJson({
      activeYear: result.activeYear,
      years: result.years.map(({ year, revision }) => ({ year, revision })),
      catalogue: { year: result.catalogue.year, revision: result.catalogue.revision,
        products: catalogueProducts(result.catalogue.products) },
    });
  } catch (error) {
    if (error.code === "CATALOGUE_CONFLICT") return vendorJson({ error: error.message }, 409);
    console.error("Vendor price-list operation could not be confirmed.");
    return vendorJson({ error: "The database could not confirm the price-list operation. Reload the list before repeating an update. Check database availability and migrations." }, 503);
  }
}

export default request => handleVendorCatalogue(request);
export const config = { path: "/api/vendor-catalogue",
  rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ["ip", "domain"] } };
