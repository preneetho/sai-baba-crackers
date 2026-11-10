import { getStore } from "@netlify/blobs";
import { DEFAULT_HOMEPAGE_VIDEO, validHomepageVideo, validHomepageVersion } from "../../vendor-app/homepage-model.mjs";

const KEY = "homepage-video";
const homepageStore = () => getStore({ name: "site-settings", consistency: "strong" });

export async function readHomepageVideo({ store = homepageStore() } = {}) {
  const entry = await store.getWithMetadata(KEY, { type: "json", consistency: "strong" });
  if (!entry) return { video: { ...DEFAULT_HOMEPAGE_VIDEO }, version: null };
  if (!validHomepageVideo(entry.data) || entry.etag === null || !validHomepageVersion(entry.etag)) {
    throw new Error("Invalid saved homepage video settings.");
  }
  return { video: { videoId: entry.data.videoId }, version: entry.etag };
}

export async function saveHomepageVideo(video, expectedVersion, { store = homepageStore() } = {}) {
  if (!validHomepageVideo(video) || !validHomepageVersion(expectedVersion)) throw new Error("Invalid homepage video update.");
  const result = await store.setJSON(KEY, { videoId: video.videoId },
    expectedVersion === null ? { onlyIfNew: true } : { onlyIfMatch: expectedVersion });
  if (result?.modified === false) {
    const error = new Error("The homepage video changed in another session. Reload the saved settings before trying again.");
    error.code = "HOMEPAGE_CONFLICT";
    throw error;
  }
  if (result?.modified !== true || result.etag === null || !validHomepageVersion(result.etag)) {
    throw new Error("The homepage video write was not acknowledged.");
  }
  return { video: { videoId: video.videoId }, version: result.etag };
}
