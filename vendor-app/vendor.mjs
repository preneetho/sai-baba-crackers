import { ORDER_STATUSES, PAGE_SIZE, validOrder, validImportSummary } from "./vendor-model.mjs";
import { validCatalogue, validYear, catalogueProducts } from "./catalogue-model.mjs";

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
let importVersion = 0;
let importController;
let importSql = "";
let importReceipt = "";
let importEnabled = false;
let importBusy = false;
let importFileLimit = 0;
let priceVersion = 0;
let priceList = null;
let activePriceYear = null;
let priceDirty = false;
let priceBusy = false;
let priceNeedsReload = false;

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
  clearImport();
  clearPrices();
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

function clearImport() {
  importVersion++;
  importController?.abort();
  importSql = "";
  importReceipt = "";
  importEnabled = false;
  importBusy = false;
  $("import-panel").hidden = true;
  $("import-file").value = "";
  $("import-ack").checked = false;
  $("import-message").textContent = "";
  setImportBusy(false);
}

function setImportBusy(value) {
  importBusy = value;
  $("import-file").disabled = value || !importEnabled;
  $("preview-import").disabled = value || !importEnabled || !importSql;
  $("import-ack").disabled = value || !importReceipt;
  $("commit-import").disabled = value || !importReceipt || !$("import-ack").checked;
  $("close-import").disabled = value;
  $("open-import").disabled = value;
  $("sign-out").disabled = value || priceBusy;
  $("open-prices").disabled = value || priceBusy;
}

function clearPrices() {
  priceVersion++;
  priceList = null;
  activePriceYear = null;
  priceDirty = false;
  priceNeedsReload = false;
  $("price-panel").hidden = true;
  $("price-controls").hidden = true;
  $("price-products").replaceChildren();
  $("price-year").replaceChildren();
  $("price-active").textContent = "";
  $("price-message").textContent = "";
  $("new-price-year").value = "";
  setPriceBusy(false);
}

function setPriceBusy(value) {
  priceBusy = value;
  $("price-panel").setAttribute("aria-busy", String(value));
  for (const control of $("price-panel").querySelectorAll("button, input, select")) {
    control.disabled = value || priceNeedsReload;
  }
  $("close-prices").disabled = value;
  $("reload-prices").disabled = value;
  $("open-prices").disabled = value || importBusy;
  $("open-import").disabled = value || importBusy;
  $("sign-out").disabled = value || importBusy;
  $("activate-prices").disabled = value || priceNeedsReload || priceDirty || !priceList || activePriceYear === priceList.year;
  $("save-prices").disabled = value || priceNeedsReload || !priceDirty;
  $("add-price-product").disabled = value || priceNeedsReload || !priceList || priceList.products.length >= 200;
}

function renderPriceProducts() {
  $("price-products").replaceChildren(...priceList.products.map(product => {
    const row = element("fieldset", undefined, "vendor-panel vendor-price-product");
    row.append(element("legend", `Product #${product.id}`));
    for (const [key, title] of [["name", "Product name"], ["brand", "Brand"], ["unit", "Selling pack"],
      ["category", "Category"], ["price", "Price per pack (Rs.)"]]) {
      const label = element("label", title);
      const input = element("input");
      input.type = key === "price" ? "number" : "text";
      input.required = true;
      input.value = product[key];
      if (key === "price") { input.min = "0"; input.max = "100000"; input.step = "0.01"; }
      else input.maxLength = 120;
      input.addEventListener("input", () => {
        product[key] = key === "price" ? (input.value === "" ? NaN : Number(input.value)) : input.value;
        priceDirty = true;
        setPriceBusy(false);
      });
      label.append(input);
      row.append(label);
    }
    const remove = element("button", `Remove product #${product.id}`);
    remove.type = "button";
    remove.addEventListener("click", () => {
      if (priceList.products.length === 1) {
        notice("price-message", "Keep at least one product in the price list.", true);
        return;
      }
      if (!window.confirm(`Remove product #${product.id} from this year's list? Existing orders will not change.`)) return;
      priceList.products = priceList.products.filter(item => item.id !== product.id);
      priceDirty = true;
      renderPriceProducts();
      setPriceBusy(false);
      $("add-price-product").focus();
    });
    row.append(remove);
    return row;
  }));
}

function acceptPrices(result, expectedYear) {
  if (!validCatalogue(result.catalogue) || !validYear(result.activeYear) ||
      (expectedYear !== undefined && result.catalogue.year !== expectedYear) ||
      !Array.isArray(result.years) || !result.years.some(year => year.year === result.activeYear) ||
      !result.years.every(year => validYear(year.year) && Number.isSafeInteger(year.revision) && year.revision > 0)) {
    throw new Error("The price-list acknowledgement could not be verified. Reload before editing.");
  }
  priceList = { ...result.catalogue, products: catalogueProducts(result.catalogue.products) };
  activePriceYear = result.activeYear;
  priceDirty = false;
  priceNeedsReload = false;
  $("price-year").replaceChildren(...result.years.map(year => {
    const option = element("option", `${year.year}${year.year === result.activeYear ? " (active)" : ""}`);
    option.value = year.year;
    return option;
  }));
  $("price-year").value = priceList.year;
  $("price-active").textContent = `Customers currently see ${result.activeYear}. Selected list: ${priceList.year}, version ${priceList.revision}.`;
  $("new-price-year").value = Math.min(priceList.year + 1, 9999);
  $("price-controls").hidden = false;
  renderPriceProducts();
}

async function loadPrices(year) {
  if (!session || priceBusy) return;
  const version = ++priceVersion;
  priceNeedsReload = false;
  setPriceBusy(true);
  notice("price-message", "Loading saved yearly price lists...");
  try {
    const result = await api(`/api/vendor-catalogue${year === undefined ? "" : `?year=${year}`}`);
    if (version !== priceVersion || !session) return;
    acceptPrices(result, year);
    notice("price-message", `${priceList.products.length} products loaded. Changes are saved only when you choose Save price list.`);
  } catch (error) {
    if (version !== priceVersion || !session) return;
    priceNeedsReload = true;
    notice("price-message", error.message, true);
  } finally {
    if (version === priceVersion) setPriceBusy(false);
  }
}

async function changePrices(input) {
  if (!session || priceBusy || priceNeedsReload) return;
  const version = priceVersion;
  setPriceBusy(true);
  notice("price-message", "Saving price-list changes...");
  try {
    const result = await api("/api/vendor-catalogue", {
      method: "POST", headers: { "Content-Type": "application/json", "X-Vendor-CSRF": session.csrf },
      body: JSON.stringify(input),
    });
    if (version !== priceVersion || !session) return;
    if (result.catalogue?.year !== input.year ||
        (input.action === "activate" && result.activeYear !== input.year) ||
        (input.action === "save" && result.catalogue.revision !== input.expectedRevision + 1) ||
        (input.action === "create" && result.catalogue.revision !== 1)) {
      throw new Error("The change could not be verified.");
    }
    acceptPrices(result, input.year);
    notice("price-message", input.action === "activate" ?
      `Customers now see the ${priceList.year} price list. Existing orders are unchanged.` :
      `Price list saved for ${priceList.year}. ${activePriceYear === priceList.year ?
        "Current prices apply to new requests." : "This year is not active for customers."} Existing orders are unchanged.`);
  } catch (error) {
    if (version !== priceVersion || !session) return;
    priceNeedsReload = true;
    notice("price-message", `${error.message} Your visible edits have been kept. Reload the saved list to establish whether the change was committed before trying again.`, true);
  } finally {
    if (version === priceVersion) setPriceBusy(false);
  }
}

async function submitImport(commit = false) {
  if (!session || importBusy || !importEnabled || !importSql ||
      (commit && (!importReceipt || !$("import-ack").checked))) return;
  const version = importVersion;
  importController = new AbortController();
  setImportBusy(true);
  notice("import-message", commit ? "Importing the approved historical requests..." :
    "Running the approved import and rolling back all preview changes...");
  try {
    const result = await api("/api/vendor-import", {
      method: "POST", headers: { "Content-Type": "application/json", "X-Vendor-CSRF": session.csrf },
      signal: AbortSignal.any([importController.signal, AbortSignal.timeout(45000)]),
      body: JSON.stringify({ action: commit ? "import" : "preview", sql: importSql,
        ...(commit ? { receipt: importReceipt, acknowledge: true } : {}) }),
    });
    if (version !== importVersion || !session) return;
    if (!validImportSummary(result) || (commit ? result.imported !== true :
      result.previewed !== true || result.rolledBack !== true ||
      typeof result.receipt !== "string" || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(result.receipt))) {
      throw new Error("The import acknowledgement could not be verified. Check the register before retrying.");
    }
    const summary = `${result.requests} requests, ${result.items} items, ${money(result.totalPaise / 100)}. ` +
      `${result.newRequests} new requests; ${result.existingRequestsUnchanged} existing requests unchanged. ` +
      `${result.statusDifferencesPreserved} newer statuses preserved. Current statuses: ` +
      `${Object.entries(result.statusCounts).map(([status, count]) => `${count} ${status}`).join(", ")}.`;
    if (commit) {
      importSql = "";
      importReceipt = "";
      $("import-file").value = "";
      $("import-ack").checked = false;
      notice("import-message", `Import confirmed. ${summary} No WhatsApp messages were sent.`);
      page = 1;
      await loadOrders();
    } else {
      importReceipt = result.receipt;
      $("import-ack").checked = false;
      notice("import-message", `Preview rolled back; nothing saved. ${summary} ` +
        `${result.unverifiedSourceHashes} source hashes are marked unverified; the approved file retains the originals. ` +
        "Review and acknowledge the historical values before confirming within 15 minutes.");
    }
  } catch (error) {
    if (version !== importVersion || !session) return;
    importReceipt = "";
    $("import-ack").checked = false;
    notice("import-message", `${error.message} Check the register, then preview the same file before retrying.`, true);
  } finally {
    if (version === importVersion) setImportBusy(false);
  }
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
$("open-prices").addEventListener("click", () => {
  if (!session || priceBusy || importBusy) return;
  if (!$("price-panel").hidden) return;
  clearPrices();
  $("price-panel").hidden = false;
  loadPrices();
});
$("close-prices").addEventListener("click", () => {
  if (priceBusy || (priceDirty && !window.confirm("Discard unsaved price-list edits?"))) return;
  clearPrices();
  $("open-prices").focus();
});
$("reload-prices").addEventListener("click", () => {
  if (priceDirty && !window.confirm("Reloading discards visible unsaved edits. Continue?")) return;
  loadPrices(priceList?.year);
});
$("price-year").addEventListener("change", () => {
  const year = Number($("price-year").value);
  if (priceDirty && !window.confirm("Discard unsaved edits and select another year?")) {
    $("price-year").value = priceList.year;
    return;
  }
  loadPrices(year);
});
$("create-price-year").addEventListener("submit", event => {
  event.preventDefault();
  if (!priceList || priceDirty) {
    notice("price-message", "Save or reload your current edits before copying this list.", true);
    return;
  }
  const year = Number($("new-price-year").value);
  if (!validYear(year)) { notice("price-message", "Enter a whole year between 2000 and 9999.", true); return; }
  changePrices({ action: "create", year, sourceYear: priceList.year, expectedRevision: priceList.revision });
});
$("activate-prices").addEventListener("click", () => {
  if (!priceList || priceDirty || activePriceYear === priceList.year ||
      !window.confirm(`Show the ${priceList.year} price list to all customers? Existing orders will not change.`)) return;
  changePrices({ action: "activate", year: priceList.year, expectedRevision: priceList.revision, expectedActiveYear: activePriceYear });
});
$("add-price-product").addEventListener("click", () => {
  if (!priceList || priceBusy || priceNeedsReload || priceList.products.length >= 200) return;
  const id = Math.max(...priceList.products.map(product => product.id)) + 1;
  if (id > 999999) { notice("price-message", "The product ID limit has been reached.", true); return; }
  priceList.products.push({ id, name: "", brand: "", unit: "", category: "", price: 0 });
  priceDirty = true;
  renderPriceProducts();
  setPriceBusy(false);
  $("price-products").lastElementChild.querySelector("input").focus();
});
$("price-form").addEventListener("submit", event => {
  event.preventDefault();
  if (!priceList || !priceDirty) return;
  const products = priceList.products.map(product => ({
    ...product, ...Object.fromEntries(["name", "brand", "unit", "category"].map(key => [key, product[key].trim()])),
  }));
  if (!validCatalogue({ ...priceList, products })) {
    notice("price-message", "Complete every product field. Use unique positive IDs and prices from Rs.0 to Rs.100,000 with at most two decimals.", true);
    return;
  }
  if (activePriceYear === priceList.year &&
      !window.confirm(`Update the active ${priceList.year} price list for new requests? Existing orders will not change.`)) return;
  changePrices({ action: "save", year: priceList.year, expectedRevision: priceList.revision, products });
});
window.addEventListener("beforeunload", event => {
  if (priceDirty || priceBusy) { event.preventDefault(); event.returnValue = ""; }
});
$("open-import").addEventListener("click", async () => {
  if (!session || importBusy || priceBusy) return;
  clearImport();
  $("import-panel").hidden = false;
  const version = importVersion;
  importController = new AbortController();
  notice("import-message", "Checking whether the owner has enabled an approved import...");
  try {
    const result = await api("/api/vendor-import", {
      signal: AbortSignal.any([importController.signal, AbortSignal.timeout(25000)]),
    });
    if (version !== importVersion || !session) return;
    if (typeof result.enabled !== "boolean" || result.maxFileBytes !== 512000 ||
        typeof result.message !== "string") throw new Error("Import configuration could not be verified.");
    importEnabled = result.enabled;
    importFileLimit = result.maxFileBytes;
    notice("import-message", result.message, !result.enabled);
    setImportBusy(false);
  } catch (error) {
    if (version === importVersion && session) notice("import-message", error.message, true);
  }
});
$("close-import").addEventListener("click", () => { if (!importBusy) clearImport(); });
$("import-file").addEventListener("change", async () => {
  importReceipt = "";
  importSql = "";
  $("import-ack").checked = false;
  const version = ++importVersion;
  const file = $("import-file").files[0];
  if (!file) { setImportBusy(false); return; }
  setImportBusy(true);
  try {
    if (!file.name.toLowerCase().endsWith(".sql") || !file.size || file.size > importFileLimit) {
      throw new Error("Choose the original approved .sql file, no larger than 512,000 bytes.");
    }
    const text = await file.text();
    if (version !== importVersion || !session) return;
    importSql = text;
    notice("import-message", "File loaded privately in this page. Preview checks the owner-approved checksum and rolls back all changes.");
  } catch (error) {
    if (version === importVersion && session) notice("import-message", error.message, true);
  } finally {
    if (version === importVersion) setImportBusy(false);
  }
});
$("import-form").addEventListener("submit", event => { event.preventDefault(); submitImport(); });
$("import-ack").addEventListener("change", () => setImportBusy(importBusy));
$("commit-import").addEventListener("click", () => submitImport(true));
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
  notice("detail-message", "Saving status to the order register...");
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
  if (!session || priceBusy || importBusy ||
      (priceDirty && !window.confirm("Sign out and discard unsaved price-list edits?"))) return;
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
