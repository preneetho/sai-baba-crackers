import { readHomepageVideo } from "../lib/homepage-settings.mjs";

export async function handleHomepage(request, options = {}) {
  const respond = (body, status = 200) => Response.json(body, {
    status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
  if (request.method !== "GET") return respond({ error: "Use GET." }, 405);
  if (new URL(request.url).search) return respond({ error: "Homepage settings do not accept query parameters." }, 400);
  try {
    const { video } = await readHomepageVideo(options);
    return respond({ video });
  } catch {
    console.error("Public homepage video settings could not be loaded.");
    return respond({ error: "The shop video is unavailable. Retry loading it or contact the shop." }, 503);
  }
}

export default request => handleHomepage(request);
export const config = { path: "/api/homepage",
  rateLimit: { windowLimit: 120, windowSize: 60, aggregateBy: ["ip", "domain"] } };
