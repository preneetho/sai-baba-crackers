import { createBrowserCustomerStore, validateDemoHistory, validateDemoOrder } from "./browser-customer-model.mjs";
import { money } from "./order.mjs";

const orderDate = value => new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short",
}).format(new Date(value));

export function renderCustomerOrderTable(orders, tbody, onSelect) {
  const document = tbody.ownerDocument;
  tbody.replaceChildren();
  for (const order of orders) {
    const row = document.createElement("tr");
    const reference = document.createElement("td");
    reference.textContent = order.orderId;
    row.append(reference);
    const date = document.createElement("td");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "customer-order-reference";
    button.dataset.orderId = order.orderId;
    button.textContent = new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata", dateStyle: "medium",
    }).format(new Date(order.createdAt));
    button.setAttribute("aria-label", `View details for ${order.orderId}`);
    button.addEventListener("click", () => onSelect(order.orderId));
    date.append(button);
    row.append(date);
    for (const value of [order.status, money(order.total)]) {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.append(cell);
    }
    row.addEventListener("click", event => {
      if (!event.target.closest("button")) onSelect(order.orderId);
    });
    tbody.append(row);
  }
}

export function renderCustomerOrderDetails(order, container) {
  const document = container.ownerDocument;
  container.replaceChildren();
  const heading = document.createElement("h3");
  heading.tabIndex = -1;
  heading.textContent = order.orderId;
  container.append(heading);
  const fields = document.createElement("dl");
  for (const [label, value] of [
    ["Status", order.status], ["Submitted (IST)", orderDate(order.createdAt)],
    ["Customer", order.name], ["Mobile", order.phone], ["Address", order.address],
    ["Fulfilment", order.fulfilment], ["Preferred date", order.preferredDate], ["Notes", order.notes],
    ["Subtotal", money(order.subtotal)], ["Discount", money(order.discount)],
    ["Delivery charge", money(order.deliveryCharge)], ["Estimated amount", money(order.total)],
  ]) {
    const term = document.createElement("dt");
    term.textContent = label;
    const description = document.createElement("dd");
    description.textContent = value || "Not supplied";
    fields.append(term, description);
  }
  const itemsHeading = document.createElement("h4");
  itemsHeading.textContent = "Requested items";
  const items = document.createElement("pre");
  items.textContent = order.items;
  const historyHeading = document.createElement("h4");
  historyHeading.textContent = "Status history";
  container.append(fields, itemsHeading, items, historyHeading);
  if (order.statusHistory.length) {
    const timeline = document.createElement("ol");
    for (const entry of order.statusHistory) {
      const item = document.createElement("li");
      const change = entry.fromStatus ? `${entry.fromStatus} to ${entry.toStatus}` : `Request recorded: ${entry.toStatus}`;
      item.textContent = `${orderDate(entry.changedAt)} IST - ${change}`;
      timeline.append(item);
    }
    container.append(timeline);
  } else {
    const empty = document.createElement("p");
    empty.textContent = "No status-change history is recorded for this request.";
    container.append(empty);
  }
  const revisions = document.createElement("p");
  revisions.textContent = "Product and price revisions are not tracked yet. This view shows the saved item list and recorded status changes.";
  container.append(revisions);
  return heading;
}

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
    status.textContent = "Your request is saved with the shop, but its link could not be saved on this device. Keep the details link from checkout. You can clear unreadable saved links using My orders.";
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
  const listView = $("#customer-order-list-view");
  const tableWrap = $("#customer-orders-table-wrap");
  const rows = $("#customer-order-rows");
  const detailView = $("#customer-order-detail");
  const detailContent = $("#customer-order-detail-content");
  const historyStatus = $("#browser-history-status");
  const previous = $("#previous-customer-orders");
  const next = $("#next-customer-orders");
  const retry = $("#retry-customer-orders");
  let demoMode = null;
  let page = 1;
  let historyAbort;
  let orders = [];
  let selectedOrderId = null;
  const notifyPhoneChange = () => window.dispatchEvent(new Event("browser-customer-change"));
  const refreshModeText = () => {
    $("#open-browser-history").textContent = "My orders";
    $("#phone-entry-help").textContent = "Enter your mobile number to continue. OTP verification is not enabled yet.";
    $("#customer-history-help").textContent = demoMode ?
      "Your saved order requests. Select a row to view the latest details." :
      "Showing order links saved on this device. These links show details at submission and expire after seven days.";
    $("#browser-history-title").textContent = "My orders";
    $("#forget-browser-history").hidden = demoMode === true;
    $("#browser-session-status").textContent = store?.phone ?
      `Shopping with +91 ${store.phone}. Your cart is saved for this number on this browser.` :
      "Your cart is saved per mobile number on this browser.";
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
      status.textContent = "Your mobile session ended. Enter a number to continue.";
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
    rows.replaceChildren();
    orders = [];
    selectedOrderId = null;
    detailContent.replaceChildren();
    detailView.hidden = true;
    listView.hidden = false;
    tableWrap.hidden = true;
    previous.disabled = true;
    next.disabled = true;
    previous.hidden = true;
    next.hidden = true;
    retry.hidden = true;
    historyStatus.textContent = "Loading your orders...";
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
        orders = data.orders;
        renderCustomerOrderTable(orders, rows, loadOrder);
        tableWrap.hidden = orders.length === 0;
        historyStatus.textContent = data.total ? `${data.total} order request(s). Page ${page} of ${Math.ceil(data.total / 20)}.` :
          "No previous orders found for this mobile number.";
        previous.hidden = next.hidden = data.total <= 20;
        previous.disabled = page <= 1;
        next.disabled = page * 20 >= data.total;
        return;
      }
      const entries = store.history();
      historyStatus.textContent = entries.length ? "Full order history is unavailable. Showing only links saved on this device." :
        "Full order history is unavailable. No order links saved on this device for this mobile number.";
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
  async function loadOrder(orderId) {
    historyAbort?.abort();
    const controller = new AbortController();
    historyAbort = controller;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]);
    selectedOrderId = orderId;
    detailContent.replaceChildren();
    listView.hidden = true;
    detailView.hidden = false;
    retry.hidden = true;
    historyStatus.textContent = "Loading latest order details...";
    try {
      const phone = store.phone;
      const response = await fetch("/api/customer-orders", {
        method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, orderId }), signal,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Order details could not be loaded.");
      const order = validateDemoOrder(result, phone, orderId);
      if (signal.aborted || phone !== store.phone || !history.open || selectedOrderId !== orderId) return;
      orders = orders.map(previousOrder => previousOrder.orderId === orderId ? order : previousOrder);
      renderCustomerOrderTable(orders, rows, loadOrder);
      const heading = renderCustomerOrderDetails(order, detailContent);
      historyStatus.textContent = "Latest saved details. The shop must confirm final prices and availability.";
      heading.focus({ preventScroll: true });
    } catch (problem) {
      if (controller.signal.aborted) return;
      console.error("Customer order details could not be loaded.");
      historyStatus.textContent = `${problem.message} No previous details have been shown.`;
      retry.hidden = false;
    }
  }
  $("#back-to-customer-orders").addEventListener("click", () => {
    historyAbort?.abort();
    const previousId = selectedOrderId;
    selectedOrderId = null;
    detailView.hidden = true;
    detailContent.replaceChildren();
    listView.hidden = false;
    retry.hidden = true;
    historyStatus.textContent = `Order requests - page ${page}.`;
    rows.querySelector(`[data-order-id="${previousId}"]`)?.focus();
  });
  $("#open-browser-history").addEventListener("click", event => { event.preventDefault(); page = 1; loadHistory(); });
  previous.addEventListener("click", () => loadHistory(page - 1));
  next.addEventListener("click", () => loadHistory(page + 1));
  retry.addEventListener("click", () => {
    if (selectedOrderId) loadOrder(selectedOrderId);
    else { demoMode = null; loadHistory(page); }
  });
  history.addEventListener("close", () => {
    historyAbort?.abort();
    list.replaceChildren();
    rows.replaceChildren();
    detailContent.replaceChildren();
    selectedOrderId = null;
    orders = [];
    historyStatus.textContent = "";
  });
  $("#close-browser-history").addEventListener("click", () => history.close());
  $("#forget-browser-history").addEventListener("click", () => {
    if (!window.confirm("Forget request links for this phone entry in this browser? Requests saved with the shop will not be deleted.")) return;
    try {
      if (!store) throw new Error("Browser storage is unavailable.");
      store.forget();
      if (!demoMode) list.replaceChildren();
      historyStatus.textContent = "Saved links cleared from this device. Your requests remain in the shop's order register.";
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
    status.textContent = "Order history could not load. Shopping still works; open My orders to retry.";
  });
}
