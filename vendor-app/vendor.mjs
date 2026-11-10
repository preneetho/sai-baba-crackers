import { ORDER_STATUSES, PAGE_SIZE, validOrder, validImportSummary } from "./vendor-model.mjs";
import { validCatalogue, validYear, catalogueProducts } from "./catalogue-model.mjs";
import { validMedia, MEDIA_LIMITS, mediaUrl } from "./media-model.mjs";
import { inspectMediaFile, transferMedia } from "./media-upload.mjs";

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
let expandedProductId = null;
let mediaController;
let savedProductIds = new Set();
const openMediaProducts = new Set();

function notice(id, message, error = false) {
  $(id).textContent = message;
  $(id).dataset.error = String(error);
  if (id === "price-message") $("price-view-message").hidden = !error;
}

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

if (typeof ResizeObserver !== "undefined") {
  new ResizeObserver(([entry]) => {
    document.documentElement.style.setProperty("--vendor-save-offset", `${Math.max(24, Math.ceil(entry.target.getBoundingClientRect().height) + 16)}px`);
  }).observe($("price-save-bar"));
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
  mediaController?.abort();
  stopPriceMedia();
  savedProductIds.clear();
  openMediaProducts.clear();
  expandedProductId = null;
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
  $("price-view-message").hidden = true;
  $("new-price-year").value = "";
  setPriceBusy(false);
}

function stopPriceMedia() {
  for (const video of $("price-products").querySelectorAll("video")) {
    video.pause();
    video.removeAttribute("src");
    video.load();
  }
}

function setPriceBusy(value) {
  priceBusy = value;
  $("price-panel").setAttribute("aria-busy", String(value));
  for (const control of $("price-panel").querySelectorAll("button, input, select, textarea")) {
    control.disabled = value || priceNeedsReload;
  }
  $("close-prices").disabled = value;
  $("reload-prices").disabled = value;
  $("price-view-message").disabled = value;
  $("open-prices").disabled = value || importBusy;
  $("open-import").disabled = value || importBusy;
  $("sign-out").disabled = value || importBusy;
  $("activate-prices").disabled = value || priceNeedsReload || priceDirty || !priceList || activePriceYear === priceList.year;
  $("save-prices").disabled = value || priceNeedsReload || !priceDirty;
  $("add-price-product").disabled = value || priceNeedsReload || !priceList || priceList.products.length >= 200;
  const state = !priceList ? "" : `${priceList.year} - ${priceList.products.length} products. ${
    value ? "Working... Please wait." : priceNeedsReload ? "Reload required. Edits kept." :
      priceDirty ? "Unsaved changes." : "All changes saved."}`;
  if ($("price-save-state").textContent !== state) $("price-save-state").textContent = state;
}

function togglePriceProduct(id) {
  if (priceBusy || priceNeedsReload) return;
  expandedProductId = expandedProductId === id ? null : id;
  renderPriceProducts();
  setPriceBusy(false);
  $(`price-toggle-${id}`).focus({ preventScroll: true });
}

function renderPriceProducts() {
  stopPriceMedia();
  if (!priceList.products.some(product => product.id === expandedProductId)) expandedProductId = null;
  $("price-products").replaceChildren(...priceList.products.flatMap(product => {
    const expanded = expandedProductId === product.id;
    const summary = element("tr", undefined, "vendor-price-summary");
    summary.dataset.expanded = String(expanded);
    const number = element("td", product.id, "vendor-price-secondary");
    const name = element("th");
    name.scope = "row";
    const toggle = element("button", undefined, "vendor-price-toggle");
    toggle.id = `price-toggle-${product.id}`;
    toggle.type = "button";
    toggle.setAttribute("aria-expanded", String(expanded));
    toggle.setAttribute("aria-controls", `price-details-${product.id}`);
    const nameText = element("span");
    const productName = element("span", product.name.trim() || `New product #${product.id}`);
    const brand = element("small", product.brand);
    nameText.append(productName, brand);
    toggle.append(nameText);
    toggle.addEventListener("click", () => togglePriceProduct(product.id));
    name.append(toggle);
    const category = element("td", product.category, "vendor-price-secondary");
    const pack = element("td", product.unit, "vendor-price-secondary");
    const price = element("td", undefined, "vendor-price-number");
    const updateSummary = () => {
      productName.textContent = product.name.trim() || `New product #${product.id}`;
      brand.textContent = product.brand;
      category.textContent = product.category;
      pack.textContent = product.unit;
      price.textContent = Number.isFinite(product.price) ? money(product.price).slice(3) : "Not set";
      toggle.setAttribute("aria-label", `${expanded ? "Collapse" : "Edit"} product #${product.id}: ${productName.textContent}`);
    };
    updateSummary();
    const media = element("td", `${product.media?.length ?? 0}/4`, "vendor-price-number");
    media.setAttribute("aria-label", `${product.media?.length ?? 0} photos or videos attached; maximum 4`);
    summary.append(number, name, category, pack, price, media);
    summary.addEventListener("click", event => {
      if (!event.target.closest("button")) togglePriceProduct(product.id);
    });
    const details = element("tr");
    details.id = `price-details-${product.id}`;
    details.hidden = !expanded;
    if (!expanded) return [summary, details];
    const cell = element("td", undefined, "vendor-price-detail-cell");
    cell.colSpan = 6;
    const row = element("fieldset", undefined, "vendor-panel vendor-price-product");
    row.id = `price-editor-${product.id}`;
    row.tabIndex = -1;
    row.append(element("legend", `Product #${product.id}`));
    for (const [key, title] of [["name", "Product name"], ["brand", "Brand"], ["unit", "Selling pack"],
      ["category", "Category"], ["price", "Price per pack (Rs.)"]]) {
      const label = element("label", title);
      const input = element("input");
      input.id = `price-${key}-${product.id}`;
      input.type = key === "price" ? "number" : "text";
      input.required = true;
      input.value = product[key];
      if (key === "price") { input.min = "0"; input.max = "100000"; input.step = "0.01"; }
      else input.maxLength = 120;
      const validateText = () => {
        if (key !== "price") input.setCustomValidity(!input.value.trim() ? `Enter ${title.toLowerCase()}.` :
          /[\u0000-\u001f\u007f]/.test(input.value) ? "Remove control characters." : "");
      };
      validateText();
      input.addEventListener("input", () => {
        if (priceBusy || priceNeedsReload) return;
        product[key] = key === "price" ? (input.value === "" ? NaN : Number(input.value)) : input.value;
        validateText();
        updateSummary();
        priceDirty = true;
        setPriceBusy(false);
      });
      label.append(input);
      row.append(label);
    }
    const remove = element("button", `Remove product #${product.id}`);
    remove.type = "button";
    remove.addEventListener("click", () => {
      if (priceBusy || priceNeedsReload) return;
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
    const close = element("button", "Close details");
    close.type = "button";
    close.addEventListener("click", () => togglePriceProduct(product.id));
    const actions = element("div", undefined, "vendor-actions");
    actions.append(close, remove);
    row.append(actions, renderProductMedia(product));
    cell.append(row);
    details.append(cell);
    return [summary, details];
  }));
}

function renderProductMedia(product) {
  const details = element("details", undefined, "vendor-product-media");
  details.id = `media-product-${product.id}`;
  details.tabIndex = -1;
  details.open = openMediaProducts.has(product.id);
  details.addEventListener("toggle", () => {
    if (details.open) openMediaProducts.add(product.id);
    else openMediaProducts.delete(product.id);
  });
  const media = product.media ?? [];
  details.append(element("summary", `Photos & video (${media.length}/4)`));
  details.append(element("p", "Upload up to 3 photos (5 MB each) and 1 video (20 MB, 30 seconds). Upload only media you own or have permission to publish. Add any required credits and label generic examples.", "vendor-muted"));
  const list = element("div", undefined, "vendor-media-list");
  media.forEach((asset, index) => {
    const item = element("div", undefined, "vendor-media-item");
    const preview = element(asset.resourceType === "image" ? "img" : "video");
    // Draft descriptions may be incomplete; delivery still validates the saved asset identity.
    const previewAsset = { ...asset, alt: "Product media preview", credit: "" };
    if (asset.resourceType === "image") {
      preview.src = mediaUrl(previewAsset);
      preview.alt = asset.alt;
      preview.loading = "lazy";
    } else {
      preview.controls = true;
      preview.preload = "none";
      preview.playsInline = true;
      preview.poster = mediaUrl(previewAsset);
      preview.src = mediaUrl(previewAsset, "play");
      preview.setAttribute("aria-label", asset.alt);
    }
    const failure = element("p", "", "vendor-notice");
    failure.setAttribute("role", "status");
    preview.addEventListener("error", () => { failure.textContent = "Preview unavailable. The saved reference is retained; check Cloudinary before removing it."; });
    item.append(element("p", `${index === 0 ? "Cover - " : ""}${asset.resourceType === "image" ? "Photo" : "Video"} ${index + 1}`), preview, failure);
    for (const [key, title, max] of [["alt", "Description / illustrative-example label", 240], ["credit", "Credit and license (required if not your own)", 1200]]) {
      const label = element("label", title);
      const input = element(key === "credit" ? "textarea" : "input");
      input.value = asset[key];
      input.maxLength = max;
      if (key === "alt") input.required = true;
      else input.rows = 3;
      const validateDescription = () => {
        if (key === "alt") input.setCustomValidity(input.value.trim() ? "" : "Describe this photo or video.");
      };
      validateDescription();
      input.addEventListener("input", () => {
        if (priceBusy || priceNeedsReload) return;
        validateDescription();
        asset[key] = input.value; priceDirty = true; setPriceBusy(false);
      });
      label.append(input);
      item.append(label);
    }
    const actions = element("div", undefined, "vendor-actions");
    for (const [title, next] of [["Use as cover", 0], ["Move earlier", index - 1], ["Move later", index + 1]]) {
      if (next === index || next < 0 || next >= media.length) continue;
      const button = element("button", title);
      button.type = "button";
      button.addEventListener("click", () => {
        if (priceBusy || priceNeedsReload) return;
        const [moved] = media.splice(index, 1);
        media.splice(next, 0, moved);
        priceDirty = true;
        renderPriceProducts();
        setPriceBusy(false);
        $(`media-product-${product.id}`).focus({ preventScroll: true });
      });
      actions.append(button);
    }
    const remove = element("button", "Remove media");
    remove.type = "button";
    remove.addEventListener("click", () => {
      if (priceBusy || priceNeedsReload || !window.confirm("Remove this media from this year's listing? The original file and older catalogues will be kept.")) return;
      product.media = media.filter((_, position) => position !== index);
      priceDirty = true;
      renderPriceProducts();
      setPriceBusy(false);
      $(`media-product-${product.id}`).focus({ preventScroll: true });
    });
    actions.append(remove);
    item.append(actions);
    list.append(item);
  });
  details.append(list);
  if (!savedProductIds.has(product.id)) {
    details.append(element("p", "Save this new product before uploading its media.", "vendor-muted"));
  } else {
    const label = element("label", "Choose one photo or video");
    const file = element("input");
    file.type = "file";
    file.accept = ".jpg,.jpeg,.png,.webp,.mp4,.webm,.mov";
    label.append(file);
    const upload = element("button", "Upload selected file");
    upload.type = "button";
    upload.addEventListener("click", () => uploadProductMedia(product, file));
    details.append(label, upload);
  }
  details.append(element("p", "The first item is the cover. Uploads and media edits are not published until you choose Save price list. Removed or abandoned uploads remain in Cloudinary; do not delete files used by older yearly lists.", "vendor-muted"));
  return details;
}

async function uploadProductMedia(product, input) {
  if (!session || priceBusy || priceNeedsReload || !priceList) return;
  const file = input.files[0];
  if (!file) { notice("price-message", "Choose a photo or video first.", true); return; }
  const version = priceVersion;
  mediaController = new AbortController();
  const signal = AbortSignal.any([mediaController.signal, AbortSignal.timeout(150000)]);
  setPriceBusy(true);
  notice("price-message", "Checking the selected media...");
  try {
    const resourceType = await inspectMediaFile(file);
    if (version !== priceVersion || !session) return;
    const count = (product.media ?? []).filter(asset => asset.resourceType === resourceType).length;
    if (count >= (resourceType === "image" ? MEDIA_LIMITS.images : MEDIA_LIMITS.videos)) {
      throw new Error(`This product already has the maximum ${resourceType === "image" ? "3 photos" : "1 video"}. Remove an item before uploading another.`);
    }
    const post = body => api("/api/vendor-media", {
      method: "POST", headers: { "Content-Type": "application/json", "X-Vendor-CSRF": session.csrf },
      signal, body: JSON.stringify(body),
    });
    const authorization = await post({ action: "sign", year: priceList.year, revision: priceList.revision,
      productId: product.id, resourceType, bytes: file.size });
    if (version !== priceVersion || !session) return;
    if (authorization.resourceType !== resourceType) throw new Error("The upload type could not be verified.");
    notice("price-message", `Uploading ${resourceType === "image" ? "photo" : "video"} for product #${product.id}. Keep this page open...`);
    await transferMedia(file, authorization, { signal });
    if (version !== priceVersion || !session) return;
    notice("price-message", "Verifying the uploaded file with Cloudinary...");
    const result = await post({ action: "verify", ticket: authorization.ticket });
    if (version !== priceVersion || !session) return;
    if (!validMedia(result.media) || !result.media.proof || result.media.cloudName !== authorization.cloudName ||
        result.media.publicId !== authorization.params.public_id || result.media.resourceType !== resourceType) {
      throw new Error("The uploaded media acknowledgement could not be verified.");
    }
    product.media = [...(product.media ?? []), result.media];
    priceDirty = true;
    expandedProductId = product.id;
    openMediaProducts.add(product.id);
    renderPriceProducts();
    $(`media-product-${product.id}`).focus({ preventScroll: true });
    notice("price-message", `Media added to product #${product.id}'s draft. Review its description and credits, then choose Save price list to publish.`);
  } catch (error) {
    if (version !== priceVersion || !session) return;
    if (error.status === 409) priceNeedsReload = true;
    notice("price-message", `${error.message} Your existing edits and saved list are unchanged. If a transfer started, check Cloudinary's Media Library before retrying.`, true);
  } finally {
    if (version === priceVersion) setPriceBusy(false);
  }
}

function acceptPrices(result, expectedYear) {
  if (!validCatalogue(result.catalogue) || !validYear(result.activeYear) ||
      (expectedYear !== undefined && result.catalogue.year !== expectedYear) ||
      !Array.isArray(result.years) || !result.years.some(year => year.year === result.activeYear) ||
      !result.years.every(year => validYear(year.year) && Number.isSafeInteger(year.revision) && year.revision > 0)) {
    throw new Error("The price-list acknowledgement could not be verified. Reload before editing.");
  }
  if (priceList?.year !== result.catalogue.year) {
    expandedProductId = null;
    openMediaProducts.clear();
  }
  priceList = { ...result.catalogue, products: catalogueProducts(result.catalogue.products) };
  savedProductIds = new Set(priceList.products.map(product => product.id));
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
$("price-view-message").addEventListener("click", () => {
  $("price-message").scrollIntoView({ block: "center" });
  $("price-message").focus({ preventScroll: true });
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
  expandedProductId = id;
  priceDirty = true;
  renderPriceProducts();
  setPriceBusy(false);
  $(`price-name-${id}`).focus();
});
$("price-form").addEventListener("submit", event => {
  event.preventDefault();
  if (!priceList || !priceDirty || priceBusy || priceNeedsReload) return;
  const products = priceList.products.map(product => ({
    ...product, ...Object.fromEntries(["name", "brand", "unit", "category"].map(key => [key, product[key].trim()])),
    ...(product.media ? { media: product.media.map(asset => ({ ...asset, alt: asset.alt.trim(), credit: asset.credit.trim() })) } : {}),
  }));
  if (!validCatalogue({ ...priceList, products })) {
    notice("price-message", "Complete every product field and media description. Use at most 3 photos and 1 video, unique positive IDs and prices from Rs.0 to Rs.100,000 with at most two decimals.", true);
    const invalid = products.find(product => !validCatalogue({ ...priceList, products: [product] }));
    if (invalid) {
      expandedProductId = invalid.id;
      if (invalid.media?.some(asset => !validMedia(asset))) openMediaProducts.add(invalid.id);
      renderPriceProducts();
      setPriceBusy(false);
      const editor = $(`price-editor-${invalid.id}`);
      const control = editor.querySelector(":invalid") ?? editor;
      control.focus();
      control.reportValidity?.();
    }
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
