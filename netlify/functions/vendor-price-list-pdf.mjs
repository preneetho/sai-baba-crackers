import { vendorSettings, vendorJson, vendorSession } from "../lib/vendor-auth.mjs";
import { orderBackend } from "../lib/order-backend.mjs";
import { validCatalogue, validYear, catalogueProducts } from "../../vendor-app/catalogue-model.mjs";
import { generatePriceListPdf } from "../lib/pdf.mjs";

export async function handleVendorPriceListPdf(request, {
  env = process.env, now = Date.now, generatePdf = generatePriceListPdf,
  databaseFactory = async () => (await import("../lib/order-database.mjs")).getOrderDatabase(),
} = {}) {
  const settings = vendorSettings(env);
  if (!settings || new URL(request.url).origin !== settings.origin) {
    return vendorJson({ error: "Vendor access is not configured for this site." }, 503);
  }
  if (!vendorSession(request, settings, now())) {
    return vendorJson({ error: "Your vendor session has expired. Sign in again." }, 401);
  }
  if (request.method !== "GET") return vendorJson({ error: "Use GET to download a price list." }, 405);
  const params = new URL(request.url).searchParams;
  const year = Number(params.get("year"));
  const revision = Number(params.get("revision"));
  if (params.size !== 2 || !/^\d{4}$/.test(params.get("year") ?? "") || !validYear(year) ||
      !/^[1-9]\d*$/.test(params.get("revision") ?? "") || !Number.isSafeInteger(revision)) {
    return vendorJson({ error: "Choose a saved price-list year and version." }, 400);
  }
  if (orderBackend(env)?.name !== "netlify-db") {
    return vendorJson({ error: "Yearly price lists require Netlify Database." }, 503);
  }
  try {
    const database = await databaseFactory();
    const { catalogue } = await database.priceLists({ year });
    if (!validCatalogue(catalogue) || catalogue.year !== year) throw new Error("Invalid saved price list.");
    if (catalogue.revision !== revision) {
      return vendorJson({ error: "This price list changed. Reload the saved list before downloading." }, 409);
    }
    const products = catalogueProducts(catalogue.products, true);
    if (!products.length) return vendorJson({ error: "This saved price list has no customer-visible products." }, 400);
    const data = await generatePdf({ year, revision, products }, new Date(now()).toISOString());
    return new Response(data, { headers: {
      "Content-Type": "application/pdf", "Content-Length": String(data.length),
      "Content-Disposition": `attachment; filename="sai-baba-price-list-${year}-v${revision}.pdf"`,
      "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow, noarchive", "Referrer-Policy": "no-referrer",
    } });
  } catch (error) {
    console.error("Vendor price-list PDF could not be generated.");
    return vendorJson({ error: error.code === "PDF_UNSUPPORTED_TEXT" ?
      "Some product text cannot be displayed in the PDF. Review the saved names and descriptions; no text was silently removed." :
      "The price-list PDF is temporarily unavailable. Retry the download; your saved prices are unchanged." }, 503);
  }
}

export default request => handleVendorPriceListPdf(request);
export const config = { path: "/api/vendor-price-list-pdf",
  rateLimit: { windowLimit: 10, windowSize: 60, aggregateBy: ["ip", "domain"] } };
