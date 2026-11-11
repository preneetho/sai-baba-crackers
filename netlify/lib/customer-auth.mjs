function failure(message, status) {
  return Object.assign(new Error(message), { status });
}

export function customerSettings(env = process.env) {
  const mode = env.CUSTOMER_AUTH_MODE ?? "off";
  if (mode === "off") return { mode };
  if (mode !== "test") throw failure("Customer authentication mode is not configured correctly.", 503);
  if (env.FIREBASE_AUTH_EMULATOR_HOST) throw failure("Auth emulators cannot be used for deployed customer verification.", 503);
  let config;
  try { config = JSON.parse(env.CUSTOMER_FIREBASE_WEB_CONFIG); }
  catch { throw failure("Customer Firebase web configuration is missing or invalid.", 503); }
  const phones = (env.CUSTOMER_AUTH_TEST_PHONES ?? "").split(",").map(value => value.trim()).filter(Boolean);
  if (!config || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(config.projectId ?? "") ||
      config.authDomain !== `${config.projectId}.firebaseapp.com` ||
      typeof config.apiKey !== "string" || !config.apiKey || config.apiKey.length > 200 ||
      typeof config.appId !== "string" || !/^1:\d+:web:[a-f0-9]+$/.test(config.appId) ||
      !phones.length || phones.length > 10 || !phones.every(phone => /^\+91[6-9]\d{9}$/.test(phone))) {
    throw failure("Configure the Firebase web app and allowed Indian fictional test numbers before enabling customer login.", 503);
  }
  return { mode, projectId: config.projectId, testPhones: phones,
    firebase: { apiKey: config.apiKey, authDomain: config.authDomain, projectId: config.projectId, appId: config.appId } };
}

async function firebaseVerify(token, projectId) {
  const [{ getApps, initializeApp }, { getAuth }] = await Promise.all([
    import("firebase-admin/app"), import("firebase-admin/auth"),
  ]);
  const name = `customer-${projectId}`;
  const app = getApps().find(candidate => candidate.name === name) ?? initializeApp({ projectId }, name);
  return getAuth(app).verifyIdToken(token);
}

export async function verifyCustomer(request, settings, { verifyIdToken = firebaseVerify } = {}) {
  if (settings.mode === "off") throw failure("Customer login is not enabled.", 503);
  const header = request.headers.get("authorization") ?? "";
  if (!/^Bearer [^\s]{1,8192}$/.test(header)) throw failure("Sign in to verify your mobile number.", 401);
  let token;
  try { token = await verifyIdToken(header.slice(7), settings.projectId); }
  catch (error) {
    if (["auth/id-token-expired", "auth/argument-error", "auth/invalid-id-token",
      "auth/id-token-revoked", "auth/user-disabled"].includes(error.code)) {
      throw failure("Your login expired or could not be verified. Sign in again.", 401);
    }
    console.error("Customer identity verification is unavailable.");
    throw failure("Customer verification is unavailable. Keep your cart and retry.", 503);
  }
  if (token.aud !== settings.projectId || token.iss !== `https://securetoken.google.com/${settings.projectId}` ||
      typeof token.uid !== "string" || !token.uid || token.uid.length > 128 ||
      token.firebase?.sign_in_provider !== "phone" ||
      !settings.testPhones.includes(token.phone_number)) {
    throw failure("Use an allowed Firebase fictional test number. Real SMS login is not enabled.", 403);
  }
  return { projectId: settings.projectId, uid: token.uid, phone: token.phone_number, isTest: true };
}

export function customerJson(body, status = 200) {
  return Response.json(body, { status, headers: {
    "Cache-Control": "private, no-store", Vary: "Authorization",
    "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
  } });
}
