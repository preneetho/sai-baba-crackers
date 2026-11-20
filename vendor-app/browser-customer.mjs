import { createBrowserCustomerStore, validateDemoHistory } from "./browser-customer-model.mjs";
import { money } from "./order.mjs";

let store;
export function browserCartKey() {
  return store?.cartKey ?? null;
}
export function rememberBrowserRequest(orderId, share) {
  const status = document.querySelector("#browser-session-status");
  try {
    if (!store) throw new Error("Browser storage is unavailable.");
    store.remember(orderId, share);
    status.textContent = "Request link remembered in this browser. Details expire after seven days.";
  } catch {
    console.error("Saved request could not be remembered in browser history.");
    status.textContent = "Your request is saved with the shop, but browser history could not be updated. Keep the details link from checkout. You can clear unreadable history using My browser requests.";
  }
}

export async function initializeBrowserCustomer() {
  const $ = selector => document.querySelector(selector);
  const gate = $("#phone-entry");
  const form = $("#phone-entry-form");
  const error = $("#phone-entry-error");
  const status = $("#browser-session-status");
  const history = $("#browser-history");
  const list = $("#browser-history-list");
  const historyStatus = $("#browser-history-status");
  const previous = $("#previous-customer-orders");
  const next = $("#next-customer-orders");
  const retry = $("#retry-customer-orders");
  let demoMode = null;
  let page = 1;
  let historyAbort;
  const notifyPhoneChange = () => window.dispatchEvent(new Event("browser-customer-change"));
  const refreshModeText = () => {
    $("#open-browser-history").textContent = demoMode ? "My orders (demo)" : "My browser requests";
    $("#phone-entry-help").textContent = demoMode ?
      "DEMO ONLY: no OTP is sent. Anyone entering a number can view its dummy requests. Do not use real customer data." :
      "No OTP is sent yet. This is not verified login. Server history is disabled; only this browser's remembered links are available.";
    $("#customer-history-help").textContent = demoMode ?
      "DEMO ONLY: requests are retrieved by the entered phone number without verification. Saved status and details are shown below. Requests are not confirmed sales." :
      "Only requests remembered here are listed. Links show submission snapshots, not live status. Details expire after seven days.";
    $("#browser-history-title").textContent = demoMode ? "Previous orders (demo)" : "My browser requests";
    $("#browser-session-status").textContent = demoMode ?
      "DEMO - unverified phone access to dummy orders. Carts are saved separately for each phone in this browser." :
      "Mobile number entered, not verified. Carts and remembered request links are separate for each phone in this browser.";
  };
  async function loadMode(signal = AbortSignal.timeout(15000)) {
    const response = await fetch("/api/customer-orders", { cache: "no-store", signal });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Customer history configuration could not be loaded.");
    if (!["off", "demo"].includes(result.mode) || result.enabled !== (result.mode === "demo")) {
      throw new Error("Customer history configuration is unreadable.");
    }
    demoMode = result.enabled;
    refreshModeText();
  }
  const showGate = () => {
    if (!gate.open) gate.showModal();
    form.elements.mobile.focus();
  };
  const report = message => {
    error.textContent = message;
    error.hidden = false;
  };
  gate.addEventListener("cancel", event => event.preventDefault());
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    error.hidden = true;
    try {
      if (!store) store = createBrowserCustomerStore({ session: sessionStorage, storage: localStorage, origin: location.origin });
      const phone = await store.enter(form.elements.mobile.value);
      $("#customer-form").elements.phone.value = phone;
      notifyPhoneChange();
      refreshModeText();
      gate.close();
      $("#hero-title").focus({ preventScroll: true });
    } catch (problem) {
      console.error("Browser phone entry could not be retained.");
      report(`${problem.message} If storage is blocked, allow site storage and retry.`);
    } finally {
      button.disabled = false;
    }
  });
  $("#change-browser-phone").addEventListener("click", () => {
    try {
      store?.end();
      historyAbort?.abort();
      if (history.open) history.close();
      $("#customer-form").reset();
      notifyPhoneChange();
      form.reset();
      error.hidden = true;
      status.textContent = "Phone session ended. Remembered links remain until you forget history or clear site storage.";
      showGate();
    } catch {
      status.textContent = "Could not clear the phone session. Clear this site's storage before sharing this device.";
    }
  });
  async function loadHistory(requestedPage = 1) {
    historyAbort?.abort();
    const controller = new AbortController();
    historyAbort = controller;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]);
    list.replaceChildren();
    previous.disabled = true;
    next.disabled = true;
    previous.hidden = true;
    next.hidden = true;
    retry.hidden = true;
    historyStatus.textContent = "Loading previous requests...";
    if (!history.open) history.showModal();
    try {
      if (!store) throw new Error("Browser storage is unavailable.");
      const phone = store.phone;
      if (demoMode === null) await loadMode(signal);
      if (demoMode) {
        const response = await fetch("/api/customer-orders", {
          method: "POST", cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone, page: requestedPage }), signal,
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Previous requests could not be loaded.");
        const data = validateDemoHistory(result, phone, requestedPage);
        if (signal.aborted || phone !== store.phone || !history.open) return;
        page = requestedPage;
        for (const order of data.orders) {
          const item = document.createElement("li");
          const details = document.createElement("details");
          const summary = document.createElement("summary");
          summary.textContent = `${order.orderId} - ${order.status} - ${money(order.total)}`;
          details.append(summary);
          for (const [label, value] of [
            ["Submitted", new Date(order.createdAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) + " IST"],
            ["Customer", order.name], ["Mobile", order.phone], ["Address", order.address],
            ["Fulfilment", order.fulfilment], ["Notes", order.notes],
          ]) {
            const line = document.createElement("p");
            line.textContent = `${label}: ${value || "Not supplied"}`;
            details.append(line);
          }
          const items = document.createElement("pre");
          items.textContent = order.items;
          details.append(items);
          item.append(details);
          list.append(item);
        }
        historyStatus.textContent = data.total ? `${data.total} saved request(s). Page ${page} of ${Math.ceil(data.total / 20)}. Demo access is not verified login.` :
          "No previous requests found for this phone number.";
        previous.hidden = next.hidden = data.total <= 20;
        previous.disabled = page <= 1;
        next.disabled = page * 20 >= data.total;
        return;
      }
      const entries = store.history();
      historyStatus.textContent = entries.length ? "Server history is disabled. Showing only links remembered in this browser." :
        "Server history is disabled. No requests remembered for this phone entry in this browser.";
      for (const entry of entries) {
        const item = document.createElement("li");
        const reference = document.createElement("strong");
        reference.textContent = entry.orderId;
        item.append(reference, document.createElement("br"));
        if (Date.parse(entry.expiresAt) <= Date.now()) {
          item.append("Details link expired. Contact the shop with this reference.");
        } else {
          const link = document.createElement("a");
          link.href = entry.url;
          link.textContent = "View submitted request";
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          item.append(link, ` - expires ${new Date(entry.expiresAt).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })}`);
        }
        list.append(item);
      }
    } catch (problem) {
      if (controller.signal.aborted) return;
      console.error("Browser request history could not be read.");
      historyStatus.textContent = `${problem.message} No other requests have been shown.`;
      retry.hidden = false;
    }
  }
  $("#open-browser-history").addEventListener("click", () => { page = 1; loadHistory(); });
  previous.addEventListener("click", () => loadHistory(page - 1));
  next.addEventListener("click", () => loadHistory(page + 1));
  retry.addEventListener("click", () => { demoMode = null; loadHistory(page); });
  history.addEventListener("close", () => {
    historyAbort?.abort();
    list.replaceChildren();
    historyStatus.textContent = "";
  });
  $("#close-browser-history").addEventListener("click", () => history.close());
  $("#forget-browser-history").addEventListener("click", () => {
    if (!window.confirm("Forget request links for this phone entry in this browser? Requests saved with the shop will not be deleted.")) return;
    try {
      if (!store) throw new Error("Browser storage is unavailable.");
      store.forget();
      if (!demoMode) list.replaceChildren();
      historyStatus.textContent = "Browser links cleared. Requests saved with the shop remain available in demo mode.";
    } catch {
      historyStatus.textContent = "Could not clear history. Clear this site's storage in browser settings.";
    }
  });
  showGate();
  try {
    store = createBrowserCustomerStore({ session: sessionStorage, storage: localStorage, origin: location.origin });
    const phone = await store.restore();
    if (phone) {
      $("#customer-form").elements.phone.value = phone;
      notifyPhoneChange();
      gate.close();
    }
  } catch {
    console.error("Browser phone session could not be restored.");
    report("Your session could not be restored. Enter your number again; site storage must be enabled.");
  }
  loadMode().catch(() => {
    console.error("Customer history configuration could not be loaded.");
    status.textContent = "History configuration could not load. Shopping still works; My browser requests will retry the history configuration.";
  });
}
