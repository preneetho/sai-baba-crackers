import {
  vendorSettings, privateHeaders, vendorJson, readCookie, cookie, unseal, vendorSession,
  sameOriginMutation, startOAuth, createSession, SESSION_SECONDS,
} from "../lib/vendor-auth.mjs";

function redirect(path, settings, cookies = []) {
  const headers = new Headers({ ...privateHeaders(), Location: new URL(path, settings.origin).href });
  for (const value of cookies) headers.append("Set-Cookie", value);
  return new Response(null, { status: 303, headers });
}

export async function handleVendorAuth(request, { env = process.env, fetchImpl = fetch, now = Date.now } = {}) {
  const settings = vendorSettings(env);
  if (!settings || new URL(request.url).origin !== settings.origin) {
    return vendorJson({ error: "Vendor Google sign-in is not configured for this site. Follow the dashboard setup guide." }, 503);
  }
  const path = new URL(request.url).pathname;
  if (request.method === "GET" && path === "/api/vendor-auth/session") {
    const session = vendorSession(request, settings, now());
    return session ? vendorJson({ email: session.email, csrf: session.csrf, expiresAt: session.exp }) :
      vendorJson({ error: "Sign in with an approved vendor Google account." }, 401);
  }
  if (request.method === "GET" && path === "/api/vendor-auth/login") {
    const auth = startOAuth(settings, now());
    return redirect(auth.url, settings, [cookie(settings.stateCookie, auth.value, 600, settings)]);
  }
  if (request.method === "POST" && path === "/api/vendor-auth/logout") {
    const session = vendorSession(request, settings, now());
    if (!session) return vendorJson({ error: "Your session has expired. Sign in again." }, 401);
    if (!sameOriginMutation(request, settings, session)) return vendorJson({ error: "Refresh the dashboard before signing out." }, 403);
    const response = vendorJson({ ok: true });
    response.headers.append("Set-Cookie", cookie(settings.sessionCookie, "", 0, settings));
    return response;
  }
  if (request.method !== "GET" || path !== "/api/vendor-auth/callback") {
    return vendorJson({ error: "Unsupported vendor sign-in action." }, 405);
  }
  const clear = [
    cookie(settings.stateCookie, "", 0, settings),
    cookie(settings.sessionCookie, "", 0, settings),
  ];
  const params = new URL(request.url).searchParams;
  const state = unseal(readCookie(request, settings.stateCookie), "oauth", settings, now());
  if (!state || params.getAll("state").length !== 1 || params.get("state") !== state.state ||
      !/^[A-Za-z0-9_-]{43}$/.test(state.verifier ?? "")) {
    return redirect("/vendor/?auth=invalid", settings, clear);
  }
  if (params.has("error")) return redirect("/vendor/?auth=cancelled", settings, clear);
  if (params.getAll("code").length !== 1 || !params.get("code") || params.get("code").length > 4096) {
    return redirect("/vendor/?auth=invalid", settings, clear);
  }
  try {
    const tokens = await fetchImpl("https://oauth2.googleapis.com/token", {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(15000),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: settings.clientId, client_secret: settings.clientSecret, code: params.get("code"),
        code_verifier: state.verifier, grant_type: "authorization_code",
        redirect_uri: `${settings.origin}/api/vendor-auth/callback`,
      }),
    });
    if (!tokens.ok) throw new Error("Google token exchange failed");
    const token = await tokens.json();
    if (typeof token.access_token !== "string" || !token.access_token || token.token_type?.toLowerCase() !== "bearer") {
      throw new Error("Google token response invalid");
    }
    const profile = await fetchImpl("https://openidconnect.googleapis.com/v1/userinfo", {
      redirect: "error", signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Bearer ${token.access_token}` },
    });
    if (!profile.ok) throw new Error("Google identity request failed");
    const identity = await profile.json();
    if (identity.email_verified !== true || typeof identity.email !== "string" ||
        typeof identity.sub !== "string" || !identity.sub || identity.sub.length > 255 ||
        !settings.emails.includes(identity.email.toLowerCase())) {
      return redirect("/vendor/?auth=denied", settings, clear);
    }
    return redirect("/vendor/", settings, [
      cookie(settings.stateCookie, "", 0, settings),
      cookie(settings.sessionCookie, createSession(identity, settings, now()), SESSION_SECONDS, settings),
    ]);
  } catch {
    console.error("Vendor Google sign-in failed; no vendor session was created.");
    return redirect("/vendor/?auth=failed", settings, clear);
  }
}

export default async request => handleVendorAuth(request);
export const config = {
  path: "/api/vendor-auth/*",
  rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
