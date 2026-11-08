import { ORDER_STATUSES, PAGE_SIZE, validOrder } from "./vendor-model.mjs";

const $ = id => document.getElementById(id);
const money = value => `Rs.${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const orderTime = value => `${new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short", hour12: true,
}).format(new Date(value))} IST`;
let session = null;
let page = 1;
let total = 0;
let filters = { query: "", status: "" };
let selected = null;
let detailId = "";
let listVersion = 0;
let detailVersion = 0;
let expiryTimer;
let saving = false;
let listController;
let detailController;
let accessVersion = 0;

function notice(id, message, error = false) {
  $(id).textContent = message;
  $(id).dataset.error = String(error);
}

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function clearPrivateView() {
  accessVersion++;
  clearTimeout(expiryTimer);
  session = null;
  listVersion++;
  detailVersion++;
  listController?.abort();
  detailController?.abort();
  selected = null;
  detailId = "";
  $("order-dialog").close();
  $("dashboard").hidden = true;
  $("account").hidden = true;
  $("account-email").textContent = "";
  $("order-list").replaceChildren();
  $("order-stats").hidden = true;
  $("pagination").hidden = true;
  $("detail-content").hidden = true;
  for (const id of ["detail-id", "detail-time", "detail-items", "detail-message", "list-message", "last-refreshed", "account-message"]) $(id).textContent = "";
  $("detail-customer").replaceChildren();
  $("detail-amounts").replaceChildren();
  for (const id of ["stat-new", "stat-active", "stat-completed", "stat-value"]) $(id).textContent = "";
  $("order-search").value = "";
  $("status-filter").value = "";
  filters = { query: "", status: "" };
  page = 1;
  $("access-panel").hidden = false;
}

function showAccess(message, error = false, canSignIn = true) {
  clearPrivateView();
  notice("access-message", message, error);
  $("google-sign-in").hidden = !canSignIn;
  $("access-retry").hidden = false;
}

async function api(path, { signal, ...options } = {}) {
  const response = await fetch(path, {
    credentials: "same-origin", cache: "no-store", signal: signal ?? AbortSignal.timeout(25000), ...options,
  });
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error("The server returned an unreadable response. Retry or check the deployment.");
  }
  if (!response.ok) {
    const error = new Error(body.error || "The request could not be completed.");
    error.status = response.status;
    if (response.status === 401 && session) showAccess(error.message, true);
    throw error;
  }
  return body;
}

async function initialise() {
  clearPrivateView();
  const version = accessVersion;
  $("google-sign-in").hidden = true;
  $("access-retry").hidden = true;
  notice("access-message", "Checking vendor access...");
  try {
    const result = await api("/api/vendor-auth/session");
    if (version !== accessVersion) return;
    if (typeof result.email !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(result.csrf ?? "") ||
        !Number.isFinite(result.expiresAt) || result.expiresAt <= Date.now()) {
      throw new Error("The vendor session could not be verified. Sign in again.");
    }
    session = result;
    $("account-email").textContent = result.email;
    $("account").hidden = false;
    $("access-panel").hidden = true;
    $("dashboard").hidden = false;
    expiryTimer = setTimeout(() => showAccess("Your vendor session has expired. Sign in again.", true),
      Math.min(result.expiresAt - Date.now(), 8 * 60 * 60 * 1000));
    await loadOrders();
  } catch (error) {
    if (version !== accessVersion) return;
    const authMessages = {
      denied: "That Google account is not approved for vendor access. Choose an approved account or contact the dashboard owner.",
      cancelled: "Google sign-in was cancelled. Try again when you are ready.",
      invalid: "The sign-in attempt expired or could not be verified. Start a fresh Google sign-in.",
      failed: "Google sign-in could not be completed. Check the OAuth setup and try again.",
    };
    const code = new URL(location.href).searchParams.get("auth");
    showAccess(error.status === 401 ? authMessages[code] ?? "Sign in with an approved vendor Google account." : error.message,
      error.status !== 401 || Boolean(code), error.status === 401);
  } finally {
    if (new URL(location.href).searchParams.has("auth")) history.replaceState(null, "", "/vendor/");
  }
}

async function loadOrders() {
  if (!session) return;
  const version = ++listVersion;
  listController?.abort();
  listController = new AbortController();
  const signal = AbortSignal.any([listController.signal, AbortSignal.timeout(25000)]);
  $("order-list").replaceChildren();
  $("order-list").setAttribute("aria-busy", "true");
  $("order-stats").hidden = true;
  $("pagination").hidden = true;
  $("retry-orders").hidden = true;
  $("last-refreshed").textContent = "";
  $("refresh-orders").disabled = true;
  notice("list-message", "Loading order requests...");
  try {
    const params = new URLSearchParams({ ...filters, page: String(page) });
    const result = await api(`/api/vendor-orders?${params}`, { signal });
    if (version !== listVersion || !session) return;
    if (!Array.isArray(result.orders) || !result.orders.every(order => validOrder(order)) ||
        !Number.isInteger(result.total) || result.total < 0 || result.page !== page || !result.stats ||
        !ORDER_STATUSES.every(status => Number.isInteger(result.stats[status]) && result.stats[status] >= 0) ||
        !Number.isFinite(result.stats.requestValue)) throw new Error("The order list could not be verified. Reload the dashboard.");
    total = result.total;
    if (page > Math.max(1, Math.ceil(total / PAGE_SIZE))) {
      page = 1;
      return await loadOrders();
    }
    $("stat-new").textContent = result.stats.New;
    $("stat-active").textContent = total - result.stats.Completed - result.stats.Cancelled;
    $("stat-completed").textContent = result.stats.Completed;
    $("stat-value").textContent = money(result.stats.requestValue);
    $("order-stats").hidden = false;
    for (const order of result.orders) {
      const card = element("article", undefined, "vendor-panel vendor-order-card");
      const heading = element("div", undefined, "vendor-heading");
      const status = element("span", order.status, "vendor-status");
      status.dataset.status = order.status;
      heading.append(element("h2", order.name), status);
      const meta = element("div", undefined, "vendor-card-meta");
      meta.append(element("span", order.fulfilment), element("strong", money(order.total)));
      const button = element("button", "View request details");
      button.type = "button";
      button.setAttribute("aria-label", `View request for ${order.name}, ${order.orderId}`);
      button.addEventListener("click", () => openDetails(order.orderId));
      card.append(heading, element("p", order.orderId, "vendor-request-id"),
        element("p", orderTime(order.createdAt), "vendor-muted"), element("p", order.phone), meta, button);
      $("order-list").append(card);
    }
    notice("list-message", total ? `${total} matching request${total === 1 ? "" : "s"}. Latest requests first.` :
      filters.query || filters.status ? "No requests match these filters. Clear the filters to see all requests." :
        "No order requests yet. Recorded customer requests will appear here.");
    $("pagination").hidden = total <= PAGE_SIZE;
    $("previous-page").disabled = page === 1;
    $("next-page").disabled = page * PAGE_SIZE >= total;
    $("page-label").textContent = `Page ${page} of ${Math.max(1, Math.ceil(total / PAGE_SIZE))}`;
    $("last-refreshed").textContent = `Last refreshed: ${orderTime(Date.now())}. Refresh to check for new requests.`;
  } catch (error) {
    if (version !== listVersion || !session) return;
    notice("list-message", error.message || "The requests could not be loaded. Retry.", true);
    $("retry-orders").hidden = false;
  } finally {
    if (version === listVersion) {
      $("order-list").setAttribute("aria-busy", "false");
      $("refresh-orders").disabled = false;
    }
  }
}

function detailFields(id, pairs) {
  $(id).replaceChildren();
  for (const [label, value] of pairs) $(id).append(element("dt", label), element("dd", value || "Not provided"));
}

function renderDetail(order) {
  selected = order;
  $("detail-content").hidden = false;
  $("detail-id").textContent = order.orderId;
  $("detail-time").textContent = `Recorded ${orderTime(order.createdAt)}`;
  detailFields("detail-customer", [
    ["Customer", order.name], ["Mobile", order.phone], ["Fulfilment", order.fulfilment],
    ["Address", order.address], ["Preferred date", order.preferredDate], ["Notes", order.notes],
  ]);
  $("detail-items").textContent = order.items;
  detailFields("detail-amounts", [
    ["Subtotal", money(order.subtotal)], ["Discount", `${order.discountPercent}% (${money(order.discount)})`],
    ["Delivery charge", money(order.deliveryCharge)], ["Estimated total", money(order.total)],
  ]);
  $("detail-status").value = order.status;
  $("detail-status").disabled = false;
  $("save-status").disabled = true;
  $("reload-detail").hidden = true;
}

async function openDetails(id) {
  if (!session || saving) return;
  detailId = id;
  selected = null;
  const version = ++detailVersion;
  detailController?.abort();
  detailController = new AbortController();
  $("detail-content").hidden = true;
  $("reload-detail").hidden = true;
  notice("detail-message", "Loading request details...");
  if (!$("order-dialog").open) $("order-dialog").showModal();
  try {
    const result = await api(`/api/vendor-orders?orderId=${encodeURIComponent(id)}`, {
      signal: AbortSignal.any([detailController.signal, AbortSignal.timeout(25000)]),
    });
    if (version !== detailVersion || !session) return;
    if (!validOrder(result.order, true) || result.order.orderId !== id) throw new Error("The request details could not be verified.");
    renderDetail(result.order);
    notice("detail-message", "Update the status after confirming arrangements with the customer.");
  } catch (error) {
    if (version !== detailVersion || !session) return;
    notice("detail-message", error.message, true);
    $("reload-detail").hidden = false;
  }
}

for (const id of ["status-filter", "detail-status"]) {
  for (const status of ORDER_STATUSES) {
    const option = element("option", status);
    option.value = status;
    $(id).append(option);
  }
}

$("filter-form").addEventListener("submit", event => {
  event.preventDefault();
  filters = { query: $("order-search").value.trim(), status: $("status-filter").value };
  page = 1;
  loadOrders();
});
$("clear-filters").addEventListener("click", () => {
  $("order-search").value = "";
  $("status-filter").value = "";
  filters = { query: "", status: "" };
  page = 1;
  loadOrders();
});
$("previous-page").addEventListener("click", () => { if (page > 1) { page--; loadOrders(); } });
$("next-page").addEventListener("click", () => { if (page * PAGE_SIZE < total) { page++; loadOrders(); } });
$("refresh-orders").addEventListener("click", loadOrders);
$("retry-orders").addEventListener("click", loadOrders);
$("access-retry").addEventListener("click", initialise);
$("close-details").addEventListener("click", () => $("order-dialog").close());
$("order-dialog").addEventListener("cancel", event => { if (saving) event.preventDefault(); });
$("order-dialog").addEventListener("close", () => {
  detailVersion++;
  detailController?.abort();
  selected = null;
  detailId = "";
  $("detail-content").hidden = true;
  $("detail-customer").replaceChildren();
  $("detail-amounts").replaceChildren();
  $("detail-items").textContent = "";
});
$("reload-detail").addEventListener("click", () => openDetails(detailId));
$("detail-status").addEventListener("change", () => {
  $("save-status").disabled = !selected || saving || $("detail-status").value === selected.status;
});
$("status-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (!selected || !session || saving || $("detail-status").value === selected.status) return;
  const id = selected.orderId;
  const version = detailVersion;
  const status = $("detail-status").value;
  saving = true;
  $("save-status").disabled = true;
  $("detail-status").disabled = true;
  $("close-details").disabled = true;
  notice("detail-message", "Saving status to the Google Sheet...");
  try {
    const result = await api("/api/vendor-orders", {
      method: "POST", headers: { "Content-Type": "application/json", "X-Vendor-CSRF": session.csrf },
      body: JSON.stringify({ orderId: id, status, expectedStatus: selected.status }),
    });
    if (version !== detailVersion || !session) return;
    if (!validOrder(result.order, true) || result.order.orderId !== id || result.order.status !== status) {
      throw new Error("The status change was not acknowledged. Reload the request before retrying.");
    }
    renderDetail(result.order);
    notice("detail-message", `Status saved: ${result.order.status}. No customer notification was sent.`);
    await loadOrders();
  } catch (error) {
    if (version !== detailVersion || !session) return;
    selected = null;
    notice("detail-message", `${error.message} Reload the request before trying another status change.`, true);
    $("reload-detail").hidden = false;
  } finally {
    saving = false;
    $("close-details").disabled = false;
  }
});
$("sign-out").addEventListener("click", async () => {
  if (!session) return;
  $("sign-out").disabled = true;
  try {
    await api("/api/vendor-auth/logout", {
      method: "POST", headers: { "X-Vendor-CSRF": session.csrf },
    });
    showAccess("You have signed out. Customer details have been cleared from this page.");
  } catch (error) {
    if (session) notice("account-message", `Sign-out was not confirmed. ${error.message} Retry signing out before leaving a shared device.`, true);
  } finally {
    $("sign-out").disabled = false;
  }
});
window.addEventListener("pagehide", clearPrivateView);
window.addEventListener("pageshow", event => { if (event.persisted) initialise(); });
initialise();
