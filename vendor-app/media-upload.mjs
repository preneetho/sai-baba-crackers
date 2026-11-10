import { MEDIA_LIMITS } from "./media-model.mjs";

export async function inspectMediaFile(file) {
  const image = /\.(jpe?g|png|webp)$/i.test(file?.name ?? "");
  const video = /\.(mp4|webm|mov)$/i.test(file?.name ?? "");
  if ((!image && !video) || (file.type && !(image ?
    ["image/jpeg", "image/png", "image/webp"] : ["video/mp4", "video/webm", "video/quicktime"]).includes(file.type))) {
    throw new Error("Choose a JPG, PNG or WebP photo, or an MP4, WebM or MOV video.");
  }
  const limit = image ? MEDIA_LIMITS.imageBytes : MEDIA_LIMITS.videoBytes;
  if (!file.size || file.size > limit) throw new Error(`Choose a file no larger than ${limit / 1000000} MB.`);
  if (image) return "image";
  const preview = document.createElement("video");
  const url = URL.createObjectURL(file);
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Video details could not be read. Try a standard MP4 or WebM file.")), 15000);
      preview.preload = "metadata";
      preview.addEventListener("loadedmetadata", () => {
        clearTimeout(timer);
        if (!Number.isFinite(preview.duration) || preview.duration <= 0 || preview.duration > MEDIA_LIMITS.seconds) {
          reject(new Error(`Choose a video no longer than ${MEDIA_LIMITS.seconds} seconds.`));
        } else resolve();
      }, { once: true });
      preview.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error("This browser cannot read that video. Try an MP4 or WebM file."));
      }, { once: true });
      preview.src = url;
    });
  } finally {
    preview.removeAttribute("src");
    preview.load();
    URL.revokeObjectURL(url);
  }
  return "video";
}

export async function transferMedia(file, authorization, { signal, fetchImpl = fetch } = {}) {
  const { cloudName, resourceType, params, apiKey, signature, ticket } = authorization ?? {};
  if (!/^[a-z0-9_-]{1,64}$/i.test(cloudName ?? "") || !["image", "video"].includes(resourceType) ||
      !/^\d{5,30}$/.test(apiKey ?? "") || !/^[a-f0-9]{64}$/.test(signature ?? "") ||
      typeof ticket !== "string" || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(ticket) ||
      !params || typeof params !== "object" || Array.isArray(params) ||
      !/^sai-baba-crackers\/products\/[a-f0-9-]{36}$/.test(params.public_id ?? "") ||
      Object.keys(params).some(key => !["allowed_formats", "overwrite", "public_id", "timestamp", "type", "upload_preset"].includes(key))) {
    throw new Error("Upload authorization could not be verified. Reload the vendor dashboard.");
  }
  const body = new FormData();
  for (const [key, value] of Object.entries(params)) body.append(key, value);
  body.append("api_key", apiKey);
  body.append("signature", signature);
  body.append("file", file);
  const response = await fetchImpl(`https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/upload`, {
    method: "POST", body, credentials: "omit", signal, redirect: "error",
  });
  if (!response.ok) {
    let detail;
    try {
      const result = await response.json();
      if (typeof result?.error?.message === "string" && result.error.message.trim()) {
        detail = result.error.message.replace(/[\u0000-\u001f\u007f]/g, " ");
        for (const value of [apiKey, signature, ticket]) detail = detail.replaceAll(value, "[redacted]");
        detail = detail.trim().slice(0, 400);
      } else {
        detail = "Cloudinary did not provide an error message.";
      }
    } catch {
      detail = "Cloudinary's error response could not be read.";
    }
    throw new Error(`Cloudinary rejected the upload (HTTP ${response.status}): ${detail} Your saved list is unchanged.`);
  }
}
