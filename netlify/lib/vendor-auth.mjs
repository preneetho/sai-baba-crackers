import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const SESSION_SECONDS = 8 * 60 * 60;
const token = () => randomBytes(32).toString("base64url");

export function vendorSettings(env) {
  try {
    const origin = new URL(env.VENDOR_APP_ORIGIN);
    const local = origin.protocol === "http:" && ["127.0.0.1", "localhost"].includes(origin.hostname);
    if ((!local && origin.protocol !== "https:") || origin.username || origin.password ||
        origin.pathname !== "/" || origin.search || origin.hash) return null;
    const emails = (env.VENDOR_ALLOWED_EMAILS ?? "").split(",").map(value => value.trim().toLowerCase());
    if (!emails.length || emails.some(email => !/^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(email)) ||
        !env.VENDOR_GOOGLE_CLIENT_ID || !env.VENDOR_GOOGLE_CLIENT_SECRET ||
        typeof env.VENDOR_SESSION_SECRET !== "string" || env.VENDOR_SESSION_SECRET.length < 32) return null;
    return {
      origin: origin.origin, local, emails, secret: env.VENDOR_SESSION_SECRET,
      clientId: env.VENDOR_GOOGLE_CLIENT_ID, clientSecret: env.VENDOR_GOOGLE_CLIENT_SECRET,
      sessionCookie: local ? "vendor-session" : "__Host-vendor-session",
      stateCookie: local ? "vendor-oauth" : "__Host-vendor-oauth",
    };
  } catch {
    return null;
  }
}

export function privateHeaders() {
  return {
    "Cache-Control": "private, no-store, max-age=0", "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex, nofollow, noarchive",
  };
}

export function vendorJson(body, status = 200) {
  return Response.json(body, { status, headers: privateHeaders() });
}

export function seal(value, kind, settings) {
  const payload = Buffer.from(JSON.stringify({ ...value, kind })).toString("base64url");
  const signature = createHmac("sha256", settings.secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function unseal(value, kind, settings, now = Date.now()) {
  if (typeof value !== "string" || value.length > 4096) return null;
  const parts = value.split(".");
  if (parts.length !== 2 || !parts.every(part => /^[A-Za-z0-9_-]+$/.test(part))) return null;
  const expected = createHmac("sha256", settings.secret).update(parts[0]).digest();
  const actual = Buffer.from(parts[1], "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[0], "base64url").toString());
    return payload.kind === kind && Number.isSafeInteger(payload.exp) && payload.exp > now ? payload : null;
  } catch {
    return null;
  }
}

export function readCookie(request, name) {
  const matches = (request.headers.get("cookie") ?? "").split(";")
    .map(part => part.trim()).filter(part => part.startsWith(`${name}=`));
  return matches.length === 1 ? matches[0].slice(name.length + 1) : null;
}

export function cookie(name, value, seconds, settings) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${settings.local ? "" : "; Secure"}`;
}

export function vendorSession(request, settings, now = Date.now()) {
  const session = unseal(readCookie(request, settings.sessionCookie), "session", settings, now);
  return session && typeof session.sub === "string" && typeof session.email === "string" &&
    settings.emails.includes(session.email) && /^[A-Za-z0-9_-]{43}$/.test(session.csrf ?? "") ? session : null;
}

export function sameOriginMutation(request, settings, session) {
  return request.headers.get("origin") === settings.origin &&
    request.headers.get("x-vendor-csrf") === session.csrf;
}

export function startOAuth(settings, now = Date.now()) {
  const state = token();
  const verifier = token();
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: settings.clientId, redirect_uri: `${settings.origin}/api/vendor-auth/callback`,
    response_type: "code", scope: "openid email", state, prompt: "select_account",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  });
  return { url: url.href, value: seal({ state, verifier, exp: now + 600000 }, "oauth", settings) };
}

export function createSession(identity, settings, now = Date.now()) {
  return seal({ sub: identity.sub, email: identity.email.toLowerCase(), csrf: token(),
    exp: now + SESSION_SECONDS * 1000 }, "session", settings);
}
