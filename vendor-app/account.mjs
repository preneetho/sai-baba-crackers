import { customerSession } from "./customer-client.mjs";

const $ = selector => document.querySelector(selector);
let session, confirmation, verifier, busy = false, cooldown = 0, cooldownTimer, page = 1, generation = 0;
const pending = new Set();
const money = value => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(value);
const date = value => new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata",
}).format(new Date(value));

function node(tag, text) {
  const result = document.createElement(tag);
  result.textContent = text;
  return result;
}
function showError(error) {
  $("#account-error").textContent = error.message;
  $("#account-error").hidden = false;
  $("#account-error").focus();
}
function clearError() { $("#account-error").hidden = true; }
function setBusy(value) {
  busy = value;
  for (const id of ["send-code", "verify-code", "resend-code", "change-phone", "sign-out"]) {
    $(`#${id}`).disabled = value || (id === "resend-code" && Date.now() < cooldown);
  }
}
function otpError(error) {
  const messages = {
    "auth/invalid-verification-code": "The code is incorrect. Check the six-digit code configured in Firebase.",
    "auth/code-expired": "This code expired. Request a new test verification.",
    "auth/session-expired": "This verification expired. Request a new test verification.",
    "auth/too-many-requests": "Too many attempts. Wait a few minutes before trying again.",
    "auth/invalid-phone-number": "Enter a valid allowed Indian test number.",
    "auth/invalid-app-credential": "Test verification is not configured correctly. Check the Firebase fictional number and website setup.",
    "auth/captcha-check-failed": "Verification could not start. Check the Firebase website and fictional-number configuration.",
    "auth/network-request-failed": "Firebase could not be reached. Check your connection and retry.",
    "auth/operation-not-allowed": "Phone authentication is not enabled for this Firebase project.",
  };
  return new Error(messages[error.code] ?? "Firebase verification failed. Check the test configuration and retry.");
}
function resetVerification() {
  confirmation = null;
  verifier?.clear();
  verifier = undefined;
  $("#login-code").value = "";
  $("#code-form").hidden = true;
  $("#phone-form").hidden = false;
}
function clearHistory() {
  generation++;
  for (const controller of pending) controller.abort();
  pending.clear();
  $("#customer-orders").replaceChildren();
  $("#history-status").textContent = "";
  $("#signed-in-phone").textContent = "";
  $("#history-pages").hidden = true;
}
async function historyRequest(query, user, version) {
  const controller = new AbortController();
  pending.add(controller);
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const token = await user.getIdToken();
    if (version !== generation) return null;
    const response = await fetch(`/api/customer-orders${query}`, {
      headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal,
    });
    const result = await response.json();
    if (version !== generation) return null;
    if (!response.ok) throw new Error(result.error ?? "Your history could not be loaded. Retry.");
    return result;
  } finally { clearTimeout(timeout); pending.delete(controller); }
}
async function loadHistory(nextPage = 1) {
  clearError();
  clearHistory();
  const version = generation;
  const user = session.auth.currentUser;
  if (!user) return;
  $("#signed-in-phone").textContent = `Signed in: ${user.phoneNumber}`;
  $("#history-status").textContent = "Loading your test requests...";
  $("#reload-history").disabled = true;
  try {
    const result = await historyRequest(`?page=${nextPage}`, user, version);
    if (!result) return;
    if (!Array.isArray(result.orders) || !Number.isSafeInteger(result.total) || result.total < 0 ||
        result.page !== nextPage || result.pageSize !== 20 || result.isTest !== true) {
      throw new Error("The history response could not be confirmed. Retry.");
    }
    page = nextPage;
    for (const order of result.orders) {
      const card = node("article", "");
      card.className = "customer-order";
      card.append(node("h3", order.orderId), node("p", `${date(order.createdAt)} IST`),
        node("p", `Test request - ${money(order.total)} - Not sent to the shop`));
      const details = node("details", "");
      details.append(node("summary", "View request details"));
      let loaded = false, loading = false;
      details.addEventListener("toggle", async () => {
        if (!details.open || loaded || loading) return;
        loading = true;
        details.querySelector("pre")?.remove();
        const content = node("pre", "Loading details...");
        content.setAttribute("role", "status");
        details.append(content);
        try {
          const result = await historyRequest(`?orderId=${encodeURIComponent(order.orderId)}`, user, version);
          if (!result) return;
          if (!result.order || result.order.orderId !== order.orderId || result.order.isTest !== true) {
            throw new Error("These request details could not be confirmed.");
          }
          const row = result.order;
          content.textContent = [row.name, row.phone, row.fulfilment, row.address,
            row.preferredDate ? `Preferred date: ${row.preferredDate}` : "", row.notes, "", row.items, "",
            `Subtotal: ${money(row.subtotal)}`, `Discount: ${money(row.discount)}`,
            `Delivery: ${money(row.deliveryCharge)}`, `Estimated total: ${money(row.total)}`].filter(Boolean).join("\n");
          loaded = true;
        } catch (error) {
          if (version === generation) {
            content.textContent = `${error.message} Close and reopen these details to retry.`;
          }
        } finally { loading = false; }
      });
      card.append(details);
      $("#customer-orders").append(card);
    }
    $("#history-status").textContent = result.total ?
      `${result.total} test request${result.total === 1 ? "" : "s"}. No purchases or real orders.` :
      "No test requests yet. Build a cart in the catalogue and submit it after signing in.";
    $("#history-pages").hidden = result.total <= 20;
    $("#previous-page").disabled = page <= 1;
    $("#next-page").disabled = page * 20 >= result.total || page >= 9999;
    $("#page-label").textContent = `Page ${page} of ${Math.max(1, Math.ceil(result.total / 20))}`;
  } catch (error) {
    if (version === generation) {
      $("#history-status").textContent = "Requests could not be loaded.";
      showError(error);
    }
  } finally {
    if (version === generation) $("#reload-history").disabled = false;
  }
}
async function sendCode() {
  const phone = `+91${$("#login-phone").value.trim()}`;
  if (!session.config.testPhones.includes(phone)) {
    throw new Error("This number is not on the fictional test-number allowlist. No SMS was requested.");
  }
  resetVerification();
  verifier = new session.sdk.RecaptchaVerifier(session.auth, "customer-recaptcha", { size: "invisible" });
  try { confirmation = await session.sdk.signInWithPhoneNumber(session.auth, phone, verifier); }
  catch (error) { resetVerification(); throw otpError(error); }
  cooldown = Date.now() + 60000;
  clearInterval(cooldownTimer);
  const tick = () => {
    const seconds = Math.max(0, Math.ceil((cooldown - Date.now()) / 1000));
    $("#resend-code").textContent = seconds ? `Request again in ${seconds}s` : "Request code again";
    $("#resend-code").disabled = busy || seconds > 0;
    if (!seconds) clearInterval(cooldownTimer);
  };
  tick();
  cooldownTimer = setInterval(tick, 1000);
  $("#phone-form").hidden = true;
  $("#code-form").hidden = false;
  $("#code-help").textContent = `Use the six-digit fictional code configured for ${phone} in Firebase. No SMS was sent.`;
  $("#login-code").focus();
}
async function initialize() {
  $("#account-retry").hidden = true;
  clearError();
  try {
    session = await customerSession();
    if (session.config.mode === "off") {
      $("#account-status").textContent = "Customer login is not enabled yet. You can still browse the catalogue.";
      return;
    }
    $("#account-status").textContent = "";
    $("#test-notice").hidden = false;
    session.sdk.onAuthStateChanged(session.auth, user => {
      clearHistory();
      resetVerification();
      $("#login-panel").hidden = !!user;
      $("#history-panel").hidden = !user;
      if (user) void loadHistory();
    }, () => showError(new Error("Your login state could not be loaded. Reload this page.")));
  } catch (error) {
    $("#account-status").textContent = "Customer login is unavailable.";
    showError(error);
    $("#account-retry").hidden = false;
  }
}
$("#phone-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (busy) return;
  clearError();
  setBusy(true);
  try { await sendCode(); } catch (error) { showError(error); } finally { setBusy(false); }
});
$("#resend-code").addEventListener("click", async () => {
  if (busy || Date.now() < cooldown) return;
  clearError();
  setBusy(true);
  try { await sendCode(); } catch (error) { showError(error); } finally { setBusy(false); }
});
$("#code-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (busy) return;
  clearError();
  setBusy(true);
  try {
    if (!confirmation) throw new Error("Request test verification again.");
    await confirmation.confirm($("#login-code").value.trim());
  } catch (error) { showError(error.code ? otpError(error) : error); } finally { setBusy(false); }
});
$("#change-phone").addEventListener("click", () => { clearError(); resetVerification(); $("#login-phone").focus(); });
$("#sign-out").addEventListener("click", async () => {
  if (busy) return;
  clearError();
  clearHistory();
  $("#history-panel").hidden = true;
  setBusy(true);
  try { await session.sdk.signOut(session.auth); }
  catch {
    $("#history-panel").hidden = false;
    showError(new Error("Sign out could not be completed. Retry, or close this browser session on a shared device."));
  }
  finally { setBusy(false); }
});
$("#previous-page").addEventListener("click", () => { if (page > 1) void loadHistory(page - 1); });
$("#next-page").addEventListener("click", () => void loadHistory(page + 1));
$("#reload-history").addEventListener("click", () => void loadHistory(page));
$("#account-retry").addEventListener("click", initialize);
window.addEventListener("pagehide", () => {
  clearHistory();
  clearInterval(cooldownTimer);
});
window.addEventListener("pageshow", event => {
  if (event.persisted && session?.auth?.currentUser) void loadHistory(page);
});
void initialize();
