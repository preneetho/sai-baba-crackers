import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { validMedia, MEDIA_FORMATS, MEDIA_LIMITS } from "../../vendor-app/media-model.mjs";

export function cloudinarySettings(env) {
  if (!/^[a-z0-9_-]{1,64}$/i.test(env.CLOUDINARY_CLOUD_NAME ?? "") ||
      /^CLOUDINARY_CLOUD_NAME$/i.test(env.CLOUDINARY_CLOUD_NAME ?? "") ||
      !/^\d{5,30}$/.test(env.CLOUDINARY_API_KEY ?? "") ||
      typeof env.CLOUDINARY_API_SECRET !== "string" || env.CLOUDINARY_API_SECRET.length < 16 ||
      !/^[a-z0-9_-]{1,100}$/i.test(env.CLOUDINARY_UPLOAD_PRESET ?? "")) return null;
  return { cloudName: env.CLOUDINARY_CLOUD_NAME, apiKey: env.CLOUDINARY_API_KEY,
    apiSecret: env.CLOUDINARY_API_SECRET, preset: env.CLOUDINARY_UPLOAD_PRESET };
}

// Cloudinary's REST signature is a sorted parameter digest, not an HMAC.
export function uploadSignature(params, secret) {
  const serialized = Object.keys(params).sort().map(key => `${key}=${params[key]}`).join("&");
  return createHash("sha256").update(serialized + secret).digest("hex");
}

export function mediaIdentity(asset) {
  return JSON.stringify(["product-media-v1", asset.cloudName, asset.publicId, asset.resourceType, asset.version,
    asset.format, asset.bytes, asset.width, asset.height, asset.duration]);
}

export function mediaProof(asset, secret) {
  return createHmac("sha256", secret).update(mediaIdentity(asset)).digest("base64url");
}

export function verifiedMedia(asset, settings, secret) {
  if (!settings || !validMedia(asset) || asset.cloudName !== settings.cloudName ||
      typeof asset.proof !== "string") return false;
  const expected = Buffer.from(mediaProof(asset, secret));
  const actual = Buffer.from(asset.proof);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function resourceMedia(resource, ticket, cloudName) {
  const asset = {
    cloudName, publicId: resource.public_id, resourceType: resource.resource_type,
    version: resource.version, format: resource.format, bytes: resource.bytes,
    width: resource.width, height: resource.height,
    duration: resource.resource_type === "image" ? 0 : resource.duration,
    alt: ticket.alt, credit: "",
  };
  if (resource.public_id !== ticket.publicId || resource.resource_type !== ticket.resourceType ||
      resource.type !== "upload" || !validMedia(asset)) {
    throw new Error("The uploaded media does not meet the supported format, dimensions, size or duration limits.");
  }
  return asset;
}

export function uploadParams(settings, publicId, resourceType, now) {
  return {
    allowed_formats: MEDIA_FORMATS[resourceType].join(","), overwrite: "false",
    public_id: publicId, timestamp: String(Math.floor(now / 1000)), type: "upload", upload_preset: settings.preset,
  };
}

export const mediaLimitMessage = `Use JPG, PNG or WebP photos up to ${MEDIA_LIMITS.imageBytes / 1000000} MB, or MP4, WebM or MOV videos up to ${MEDIA_LIMITS.videoBytes / 1000000} MB and ${MEDIA_LIMITS.seconds} seconds.`;
