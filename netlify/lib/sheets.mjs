export function sheetSettings(env) {
  const url = env.GOOGLE_SHEETS_WEBHOOK_URL;
  const secret = env.ORDER_TRACKING_SECRET;
  if (typeof url !== "string" || typeof secret !== "string" || secret.length < 32) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.hostname !== "script.google.com" ||
        parsed.port || parsed.username || parsed.password || parsed.search || parsed.hash ||
        !/^\/macros\/s\/[a-zA-Z0-9_-]+\/exec$/.test(parsed.pathname)) return null;
    return { url, secret };
  } catch {
    return null;
  }
}
