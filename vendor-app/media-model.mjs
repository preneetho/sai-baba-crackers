export const MEDIA_LIMITS = Object.freeze({ images: 3, videos: 1, imageBytes: 5000000, videoBytes: 20000000, seconds: 30 });
export const MEDIA_FORMATS = Object.freeze({ image: ["jpg", "jpeg", "png", "webp"], video: ["mp4", "webm", "mov"] });
const text = (value, max, multiline = false) => typeof value === "string" && value === value.trim() &&
  value.length <= max && !(multiline ? /[\u0000-\u0009\u000b-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/).test(value);

export function validMedia(asset) {
  return Boolean(asset && /^[a-z0-9_-]{1,64}$/i.test(asset.cloudName ?? "") &&
    /^sai-baba-crackers\/products\/[a-f0-9-]{36}$/.test(asset.publicId ?? "") &&
    ["image", "video"].includes(asset.resourceType) && MEDIA_FORMATS[asset.resourceType].includes(asset.format) &&
    Number.isSafeInteger(asset.version) && asset.version > 0 &&
    Number.isSafeInteger(asset.bytes) && asset.bytes > 0 &&
    asset.bytes <= (asset.resourceType === "image" ? MEDIA_LIMITS.imageBytes : MEDIA_LIMITS.videoBytes) &&
    ["width", "height"].every(key => Number.isSafeInteger(asset[key]) && asset[key] > 0 && asset[key] <= 20000) &&
    (asset.resourceType === "image" ? asset.duration === 0 :
      Number.isFinite(asset.duration) && asset.duration > 0 && asset.duration <= MEDIA_LIMITS.seconds) &&
    text(asset.alt, 240) && asset.alt.length > 0 && text(asset.credit, 1200, true) &&
    (asset.proof === undefined || /^[A-Za-z0-9_-]{43}$/.test(asset.proof)));
}

export function validProductMedia(media) {
  if (media === undefined) return true;
  if (!Array.isArray(media) || media.length > MEDIA_LIMITS.images + MEDIA_LIMITS.videos || !media.every(validMedia)) return false;
  return media.filter(asset => asset.resourceType === "image").length <= MEDIA_LIMITS.images &&
    media.filter(asset => asset.resourceType === "video").length <= MEDIA_LIMITS.videos &&
    new Set(media.map(asset => `${asset.cloudName}/${asset.resourceType}/${asset.publicId}`)).size === media.length;
}

export function copyMedia(asset, publicView = false) {
  const { cloudName, publicId, resourceType, format, version, bytes, width, height, duration, alt, credit, proof } = asset;
  return { cloudName, publicId, resourceType, format, version, bytes, width, height, duration, alt, credit,
    ...(!publicView && proof !== undefined ? { proof } : {}) };
}

export function mediaUrl(asset, view = "thumbnail") {
  if (!validMedia(asset)) throw new Error("Invalid product media.");
  const poster = asset.resourceType === "video" && view !== "play";
  const transform = poster ? "so_0,c_limit,w_640,h_400,q_auto,f_jpg" :
    view === "play" ? "c_limit,w_960,h_960,q_auto,f_mp4" :
      view === "full" ? "c_limit,w_1600,h_1600,q_auto,f_auto" : "c_limit,w_640,h_400,q_auto,f_auto";
  const format = poster ? "jpg" : view === "play" ? "mp4" : asset.format;
  return `https://res.cloudinary.com/${asset.cloudName}/${asset.resourceType}/upload/${transform}/v${asset.version}/${asset.publicId}.${format}`;
}
