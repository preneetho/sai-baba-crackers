import { randomUUID } from "node:crypto";
import { vendorSettings, vendorJson, vendorSession, sameOriginMutation, seal, unseal } from "../lib/vendor-auth.mjs";
import { orderBackend } from "../lib/order-backend.mjs";
import { cloudinarySettings, uploadParams, uploadSignature, resourceMedia, mediaProof, mediaLimitMessage } from "../lib/product-media.mjs";
import { validYear } from "../../vendor-app/catalogue-model.mjs";
import { MEDIA_LIMITS } from "../../vendor-app/media-model.mjs";

export async function handleVendorMedia(request, {
  env = process.env, now = Date.now, fetchImpl = fetch,
  databaseFactory = async () => (await import("../lib/order-database.mjs")).getOrderDatabase(),
} = {}) {
  const settings = vendorSettings(env);
  if (!settings || new URL(request.url).origin !== settings.origin) {
    return vendorJson({ error: "Vendor access is not configured for this site." }, 503);
  }
  const session = vendorSession(request, settings, now());
  if (!session) return vendorJson({ error: "Your vendor session has expired. Sign in again." }, 401);
  if (request.method !== "POST") return vendorJson({ error: "Use POST." }, 405);
  if (!sameOriginMutation(request, settings, session)) return vendorJson({ error: "Refresh the dashboard before uploading media." }, 403);
  if (orderBackend(env)?.name !== "netlify-db") return vendorJson({ error: "Product media requires Netlify Database." }, 503);
  const cloud = cloudinarySettings(env);
  if (!cloud) return vendorJson({ error: "Cloudinary is not configured. Check all four CLOUDINARY variables for production Functions and redeploy." }, 503);
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
    return vendorJson({ error: "Send upload details as JSON, not the file." }, 415);
  }
  let input;
  try {
    if (Number(request.headers.get("content-length")) > 8192) return vendorJson({ error: "Upload details are too large." }, 413);
    const body = await request.text();
    if (Buffer.byteLength(body) > 8192) return vendorJson({ error: "Upload details are too large." }, 413);
    input = JSON.parse(body);
    if (!input || !["sign", "verify"].includes(input.action)) throw new Error("Invalid action.");
  } catch {
    return vendorJson({ error: "The upload details could not be read." }, 400);
  }
  if (input.action === "sign") {
    if (!validYear(input.year) || !Number.isSafeInteger(input.revision) || input.revision < 1 ||
        !Number.isSafeInteger(input.productId) || !["image", "video"].includes(input.resourceType) ||
        !Number.isSafeInteger(input.bytes) || input.bytes < 1 ||
        input.bytes > (input.resourceType === "image" ? MEDIA_LIMITS.imageBytes : MEDIA_LIMITS.videoBytes)) {
      return vendorJson({ error: mediaLimitMessage }, 400);
    }
    try {
      const { catalogue } = await (await databaseFactory()).priceLists({ year: input.year });
      if (catalogue.revision !== input.revision) return vendorJson({ error: "The saved list changed. Reload it before uploading." }, 409);
      const product = catalogue.products.find(item => item.id === input.productId);
      if (!product) return vendorJson({ error: "Save this new product before uploading its media." }, 409);
      const publicId = `sai-baba-crackers/products/${randomUUID()}`;
      const params = uploadParams(cloud, publicId, input.resourceType, now());
      const ticket = seal({ publicId, resourceType: input.resourceType, alt: product.name,
        sub: session.sub, csrf: session.csrf, cloudName: cloud.cloudName, exp: now() + 15 * 60000 }, "media-upload", settings);
      return vendorJson({ ticket, params, apiKey: cloud.apiKey, cloudName: cloud.cloudName,
        resourceType: input.resourceType, signature: uploadSignature(params, cloud.apiSecret) });
    } catch {
      console.error("Product media upload could not read the saved catalogue.");
      return vendorJson({ error: "The saved product could not be checked. Retry when the database is available." }, 503);
    }
  }
  const ticket = unseal(input.ticket, "media-upload", settings, now());
  if (!ticket || ticket.sub !== session.sub || ticket.csrf !== session.csrf ||
      ticket.cloudName !== cloud.cloudName) {
    return vendorJson({ error: "Upload authorization expired or is invalid. Select the file and upload again." }, 400);
  }
  try {
    const response = await fetchImpl(`https://api.cloudinary.com/v1_1/${cloud.cloudName}/resources/${ticket.resourceType}/upload/${encodeURIComponent(ticket.publicId)}`, {
      headers: { Authorization: `Basic ${Buffer.from(`${cloud.apiKey}:${cloud.apiSecret}`).toString("base64")}` },
      signal: AbortSignal.timeout(15000), redirect: "error",
    });
    if (!response.ok) {
      console.error(`Cloudinary media verification failed with status ${response.status}.`);
      return vendorJson({ error: "Cloudinary could not verify the upload. Check its Media Library before uploading again; the file may already exist there." }, 503);
    }
    const resource = await response.json();
    let asset;
    try { asset = resourceMedia(resource, ticket, cloud.cloudName); }
    catch {
      return vendorJson({ error: `${mediaLimitMessage} This file was not attached. Remove any rejected upload from Cloudinary's Media Library if it is not needed.` }, 400);
    }
    return vendorJson({ media: { ...asset, proof: mediaProof(asset, settings.secret) } });
  } catch {
    console.error("Cloudinary media verification could not be completed.");
    return vendorJson({ error: "Media verification was not confirmed. Your saved list is unchanged. Check Cloudinary's Media Library before retrying." }, 503);
  }
}

export default request => handleVendorMedia(request);
export const config = { path: "/api/vendor-media",
  rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ["ip", "domain"] } };
