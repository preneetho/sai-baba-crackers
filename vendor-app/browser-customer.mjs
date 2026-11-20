import { createBrowserCustomerStore } from "./browser-customer-model.mjs";

let store;
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
      status.textContent = "Mobile number entered, not verified. History is limited to this browser.";
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
      $("#customer-form").elements.phone.value = "";
      form.reset();
      error.hidden = true;
      status.textContent = "Phone session ended. Remembered links remain until you forget history or clear site storage.";
      showGate();
    } catch {
      status.textContent = "Could not clear the phone session. Clear this site's storage before sharing this device.";
    }
  });
  $("#open-browser-history").addEventListener("click", () => {
    list.replaceChildren();
    historyStatus.textContent = "";
    try {
      if (!store) throw new Error("Browser storage is unavailable.");
      const entries = store.history();
      if (!entries.length) historyStatus.textContent = "No requests remembered for this phone entry in this browser.";
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
    } catch {
      console.error("Browser request history could not be read.");
      historyStatus.textContent = "History could not be read. Allow site storage, or use Forget history to clear unreadable entries.";
    }
    history.showModal();
  });
  $("#close-browser-history").addEventListener("click", () => history.close());
  $("#forget-browser-history").addEventListener("click", () => {
    if (!window.confirm("Forget request links for this phone entry in this browser? Requests saved with the shop will not be deleted.")) return;
    try {
      if (!store) throw new Error("Browser storage is unavailable.");
      store.forget();
      list.replaceChildren();
      historyStatus.textContent = "Browser history cleared. Requests saved with the shop are unchanged.";
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
      gate.close();
    }
  } catch {
    console.error("Browser phone session could not be restored.");
    report("Your session could not be restored. Enter your number again; site storage must be enabled.");
  }
}
