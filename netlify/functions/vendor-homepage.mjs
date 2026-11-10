import { vendorSettings, vendorJson, vendorSession, sameOriginMutation } from "../lib/vendor-auth.mjs";
import { readHomepageVideo, saveHomepageVideo } from "../lib/homepage-settings.mjs";
import { homepageVideoFromUrl, validHomepageVersion } from "../../vendor-app/homepage-model.mjs";

export async function handleVendorHomepage(request, { env = process.env, now = Date.now, store } = {}) {
  const settings = vendorSettings(env);
  if (!settings || new URL(request.url).origin !== settings.origin) {
    return vendorJson({ error: "Vendor access is not configured for this site." }, 503);
  }
  const session = vendorSession(request, settings, now());
  if (!session) return vendorJson({ error: "Your vendor session has expired. Sign in again." }, 401);
  if (!["GET", "POST"].includes(request.method)) return vendorJson({ error: "Use GET or POST." }, 405);
  if (new URL(request.url).search) return vendorJson({ error: "Homepage settings do not accept query parameters." }, 400);
  let video;
  let expectedVersion;
  if (request.method === "POST") {
    if (!sameOriginMutation(request, settings, session)) return vendorJson({ error: "Refresh the dashboard before editing the homepage." }, 403);
    if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
      return vendorJson({ error: "Send the homepage settings as JSON." }, 415);
    }
    if (Number(request.headers.get("content-length")) > 4096) return vendorJson({ error: "Homepage settings are too large." }, 413);
    try {
      const body = await request.text();
      if (Buffer.byteLength(body) > 4096) return vendorJson({ error: "Homepage settings are too large." }, 413);
      const input = JSON.parse(body);
      if (!input || typeof input !== "object" || Array.isArray(input) ||
          Object.keys(input).some(key => !["videoUrl", "expectedVersion"].includes(key)) ||
          !validHomepageVersion(input.expectedVersion)) {
        return vendorJson({ error: "Reload the saved homepage settings before editing." }, 400);
      }
      expectedVersion = input.expectedVersion;
      video = homepageVideoFromUrl(input.videoUrl);
    } catch (error) {
      return vendorJson({ error: error instanceof SyntaxError ?
        "The homepage settings could not be read." : error.message }, 400);
    }
  }
  try {
    return vendorJson(request.method === "GET" ? await readHomepageVideo({ store }) :
      await saveHomepageVideo(video, expectedVersion, { store }));
  } catch (error) {
    if (error.code === "HOMEPAGE_CONFLICT") return vendorJson({ error: error.message }, 409);
    console.error("Vendor homepage video operation could not be confirmed.");
    return vendorJson({ error: "The homepage video settings could not be confirmed. Reload the saved settings before repeating an update. Check Netlify Blobs availability." }, 503);
  }
}

export default request => handleVendorHomepage(request);
export const config = { path: "/api/vendor-homepage",
  rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ["ip", "domain"] } };
