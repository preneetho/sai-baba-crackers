let sessionPromise;

async function loadSession() {
  const response = await fetch("/api/customer-config", { cache: "no-store", signal: AbortSignal.timeout(15000) });
  const config = await response.json();
  if (!response.ok) throw new Error(config.error ?? "Customer login could not be loaded. Retry.");
  if (config.mode === "off") return { config };
  if (config.mode !== "test" || !config.firebase || !Array.isArray(config.testPhones) || !config.testPhones.length) {
    throw new Error("Customer test login is not configured correctly.");
  }
  const [{ initializeApp }, sdk] = await Promise.all([
    import("https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js"),
    import("https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js"),
  ]);
  const auth = sdk.getAuth(initializeApp(config.firebase, "customer"));
  auth.settings.appVerificationDisabledForTesting = true;
  await sdk.setPersistence(auth, sdk.browserSessionPersistence);
  await auth.authStateReady();
  return { config, auth, sdk };
}

export async function customerSession() {
  sessionPromise ??= loadSession();
  const pending = sessionPromise;
  try { return await pending; }
  catch (error) {
    if (pending === sessionPromise) sessionPromise = undefined;
    throw error;
  }
}

export async function customerAuthorization(phone) {
  const { config, auth } = await customerSession();
  if (config.mode === "off") return { headers: {}, isTest: false };
  if (!auth.currentUser) {
    throw Object.assign(new Error("Sign in to verify your mobile before submitting. Your cart is kept."),
      { code: "CUSTOMER_SIGN_IN_REQUIRED" });
  }
  if (auth.currentUser.phoneNumber !== `+91${phone}` || !config.testPhones.includes(auth.currentUser.phoneNumber)) {
    throw Object.assign(new Error("Use the mobile number verified in My Orders, or sign in with your order number."),
      { code: "CUSTOMER_PHONE_MISMATCH" });
  }
  return { headers: { Authorization: `Bearer ${await auth.currentUser.getIdToken()}` }, isTest: true };
}
