import { ORDER_STATUSES, PAGE_SIZE, validOrder } from "./vendor-model.mjs";
import { validCatalogue, validYear, catalogueProducts, PRODUCT_TYPES } from "./catalogue-model.mjs";
import { validMedia, MEDIA_LIMITS, mediaUrl, isYouTubeMedia, youtubeVideoId } from "./media-model.mjs";
import { inspectMediaFile, transferMedia } from "./media-upload.mjs";
import { validHomepageVideo, validHomepageVersion, homepageVideoFromUrl, homepageVideoUrl } from "./homepage-model.mjs";
import { validOffers, validOfferVersion, checkOffers, normalizeCoupon } from "./offers-model.mjs";

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
let shareController;
let shareVersion = 0;
let shareBusy = false;
let accessVersion = 0;
let priceVersion = 0;
let priceList = null;
let activePriceYear = null;
let priceDirty = false;
let priceBusy = false;
let priceNeedsReload = false;
let homepageState = null;
let homepageVersion = 0;
let homepageBusy = false;
let homepageNeedsReload = false;
let offerState = null;
let offerBusy = false;
let offerDirty = false;
let offerNeedsReload = false;
let offerAccessVersion = 0;
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
  clearPrices();
  clearHomepage();
  clearOffers();
  listVersion++;
  detailVersion++;
  listController?.abort();
  detailController?.abort();
  selected = null;
  clearShare();
  detailId = "";
  $("order-dialog").close();
  $("dashboard").hidden = true;
  $("account").hidden = true;
  $("account-email").textContent = "";
  $("order-list").replaceChildren();
  $("order-table-wrap").hidden = true;
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
  const blocked = value || offerBusy;
  $("price-panel").setAttribute("aria-busy", String(value));
  for (const control of $("price-panel").querySelectorAll("button, input, select, textarea")) {
    control.disabled = blocked || priceNeedsReload;
  }
  $("close-prices").disabled = value;
  $("reload-prices").disabled = value;
  $("price-view-message").disabled = value;
  $("open-prices").disabled = value || homepageBusy || offerBusy;
  $("open-homepage").disabled = value || homepageBusy || offerBusy;
  $("sign-out").disabled = value || homepageBusy || offerBusy;
  $("open-offers").disabled = value || homepageBusy || offerBusy;
  $("activate-prices").disabled = blocked || priceNeedsReload || priceDirty || !priceList || activePriceYear === priceList.year;
  $("save-prices").disabled = blocked || priceNeedsReload || !priceDirty;
  $("add-price-product").disabled = blocked || priceNeedsReload || !priceList || priceList.products.length >= 200;
  const hiddenCount = priceList?.products.filter(product => product.hidden === true).length ?? 0;
  const state = !priceList ? "" : `${priceList.year} - ${priceList.products.length} products${hiddenCount ? `, ${hiddenCount} hidden` : ""}. ${
    value ? "Working... Please wait." : priceNeedsReload ? "Reload required. Edits kept." :
      priceDirty ? "Unsaved changes." : "All changes saved."}`;
  if ($("price-save-state").textContent !== state) $("price-save-state").textContent = state;
  setHomepageBusy(homepageBusy);
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
    const hidden = element("small", "Hidden from customers");
    nameText.append(productName, brand, hidden);
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
      hidden.hidden = product.hidden !== true;
      toggle.setAttribute("aria-label", `${expanded ? "Collapse" : "Edit"} product #${product.id}: ${productName.textContent}${product.hidden === true ? ". Hidden from customers" : ""}`);
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
    const types = element("fieldset", undefined, "vendor-product-types");
    types.append(element("legend", "Shop by type"));
    const typeHelp = element("p", "Select every effect that applies. Leave all unchecked if unsure; the product stays in All types. Save price list to publish.", "vendor-muted");
    typeHelp.id = `price-types-help-${product.id}`;
    types.setAttribute("aria-describedby", typeHelp.id);
    const typeOptions = element("div", undefined, "vendor-type-options");
    for (const type of PRODUCT_TYPES) {
      const label = element("label");
      const input = element("input");
      input.id = `price-type-${type.id}-${product.id}`;
      input.type = "checkbox";
      input.checked = product.types?.includes(type.id) ?? false;
      input.addEventListener("change", () => {
        if (priceBusy || priceNeedsReload) return;
        const selected = new Set(product.types ?? []);
        if (input.checked) selected.add(type.id);
        else selected.delete(type.id);
        product.types = PRODUCT_TYPES.filter(item => selected.has(item.id)).map(item => item.id);
        priceDirty = true;
        setPriceBusy(false);
      });
      label.append(input, element("span", type.label));
      typeOptions.append(label);
    }
    types.append(typeHelp, typeOptions);
    row.append(types);
    const visibility = element("label", undefined, "vendor-price-visibility");
    const visible = element("input");
    visible.id = `price-visible-${product.id}`;
    visible.type = "checkbox";
    visible.checked = product.hidden !== true;
    const visibilityText = element("span", "Visible to customers");
    visibilityText.append(element("small", "Uncheck when out of stock. Save price list to apply; hidden products stay in this year's list."));
    visible.addEventListener("change", () => {
      if (priceBusy || priceNeedsReload) return;
      product.hidden = !visible.checked;
      updateSummary();
      priceDirty = true;
      setPriceBusy(false);
    });
    visibility.append(visible, visibilityText);
    row.append(visibility);
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
  details.append(element("p", "Add up to 3 photos (5 MB each) and 1 video: a YouTube link or an upload (20 MB, 30 seconds). Publish only media you own or have permission to use. Add required credits and label generic examples.", "vendor-muted"));
  const list = element("div", undefined, "vendor-media-list");
  media.forEach((asset, index) => {
    const item = element("div", undefined, "vendor-media-item");
    const youtube = isYouTubeMedia(asset);
    const preview = element(asset.resourceType === "image" || youtube ? "img" : "video");
    // Draft descriptions may be incomplete; delivery still validates the saved asset identity.
    const previewAsset = { ...asset, alt: "Product media preview", credit: "" };
    if (asset.resourceType === "image" || youtube) {
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
    preview.addEventListener("error", () => {
      failure.textContent = `Preview unavailable. The saved reference is retained; check ${youtube ? "the YouTube video" : "Cloudinary"} before removing it.`;
    });
    item.append(element("p", `${index === 0 ? "Cover - " : ""}${youtube ? "YouTube video" : asset.resourceType === "image" ? "Photo" : "Video"} ${index + 1}`), preview, failure);
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
    if (youtube) {
      const link = element("a", "Check video on YouTube (new tab)");
      link.href = mediaUrl(previewAsset, "watch");
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      item.append(link);
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
      if (priceBusy || priceNeedsReload || !window.confirm("Remove this media from this year's listing? The original source and older catalogues will be kept.")) return;
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
  if (!media.some(asset => asset.resourceType === "video")) {
    const label = element("label", "YouTube video URL");
    const input = element("input");
    input.id = `youtube-url-${product.id}`;
    input.type = "url";
    input.maxLength = 2048;
    input.setAttribute("aria-describedby", `youtube-help-${product.id}`);
    input.addEventListener("input", () => input.setCustomValidity(""));
    label.append(input);
    const help = element("p", "Paste an HTTPS YouTube watch, share or Shorts link. Choose Add YouTube video, then Save price list. The video must allow embedding; YouTube links need no Cloudinary setup.", "vendor-muted");
    help.id = `youtube-help-${product.id}`;
    const add = element("button", "Add YouTube video");
    add.type = "button";
    add.addEventListener("click", () => addYouTubeVideo(product, input));
    details.append(label, help, add);
  } else {
    details.append(element("p", "One video is attached. Remove it before adding a different YouTube link or uploaded video.", "vendor-muted"));
  }
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

function addYouTubeVideo(product, input) {
  if (!session || priceBusy || offerBusy || priceNeedsReload || !priceList) return;
  const videoId = youtubeVideoId(input.value);
  const error = !videoId ? "Enter a valid HTTPS YouTube video URL, such as a watch, youtu.be or Shorts link." :
    (product.media ?? []).some(asset => asset.resourceType === "video") ?
      "This product already has the maximum 1 video. Remove it before adding another." : "";
  input.setCustomValidity(error);
  if (error) {
    notice("price-message", error, true);
    input.focus();
    input.reportValidity();
    return;
  }
  product.media = [...(product.media ?? []), { provider: "youtube", resourceType: "video", videoId,
    alt: product.name.trim() || `Product #${product.id} video`, credit: "" }];
  priceDirty = true;
  expandedProductId = product.id;
  openMediaProducts.add(product.id);
  renderPriceProducts();
  setPriceBusy(false);
  $(`media-product-${product.id}`).focus({ preventScroll: true });
  notice("price-message", "YouTube video added to the draft. Review its description and credits, then choose Save price list to publish. Check that the video is available and allows embedding.");
}

async function uploadProductMedia(product, input) {
  if (!session || priceBusy || offerBusy || priceNeedsReload || !priceList) return;
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
  if (!session || priceBusy || offerBusy) return;
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
  if (!session || priceBusy || offerBusy || priceNeedsReload) return;
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

function homepageDirty() {
  return homepageState && $("homepage-video-url").value !== homepageVideoUrl(homepageState.video);
}

function setHomepageBusy(value) {
  homepageBusy = value;
  const blocked = value || priceBusy || offerBusy;
  $("homepage-panel").setAttribute("aria-busy", String(value));
  $("homepage-video-url").disabled = blocked || homepageNeedsReload || !homepageState;
  $("save-homepage").disabled = blocked || homepageNeedsReload || !homepageDirty();
  $("reload-homepage").disabled = blocked;
  $("close-homepage").disabled = blocked;
  $("open-homepage").disabled = value || priceBusy || offerBusy;
  $("open-prices").disabled = blocked;
  $("sign-out").disabled = blocked;
  $("open-offers").disabled = blocked;
}

function clearHomepage() {
  homepageVersion++;
  homepageState = null;
  homepageNeedsReload = false;
  $("homepage-panel").hidden = true;
  $("open-homepage").setAttribute("aria-expanded", "false");
  $("homepage-video-url").value = "";
  $("homepage-message").textContent = "";
  setHomepageBusy(false);
}

function acceptHomepage(result) {
  if (!validHomepageVideo(result.video) || !validHomepageVersion(result.version)) {
    throw new Error("The saved homepage video settings could not be verified.");
  }
  homepageState = { video: { videoId: result.video.videoId }, version: result.version };
  homepageNeedsReload = false;
  $("homepage-video-url").value = homepageVideoUrl(result.video);
}

async function loadHomepage() {
  if (!session || homepageBusy || priceBusy || offerBusy) return;
  const version = ++homepageVersion;
  setHomepageBusy(true);
  notice("homepage-message", "Loading saved homepage video...");
  try {
    const result = await api("/api/vendor-homepage");
    if (version !== homepageVersion || !session) return;
    acceptHomepage(result);
    notice("homepage-message", result.video.videoId === null ?
      "The homepage video is hidden. Paste a link and save to show a video." :
      "Saved video loaded. Choose Save homepage video to publish a change.");
  } catch (error) {
    if (version !== homepageVersion || !session) return;
    homepageNeedsReload = true;
    notice("homepage-message", error.message, true);
  } finally {
    if (version === homepageVersion) setHomepageBusy(false);
  }
}

async function saveHomepage(event) {
  event.preventDefault();
  if (!session || homepageBusy || priceBusy || offerBusy || homepageNeedsReload || !homepageDirty()) return;
  let video;
  try { video = homepageVideoFromUrl($("homepage-video-url").value); }
  catch (error) {
    notice("homepage-message", error.message, true);
    $("homepage-video-url").focus();
    return;
  }
  const version = homepageVersion;
  setHomepageBusy(true);
  notice("homepage-message", "Saving homepage video...");
  try {
    const result = await api("/api/vendor-homepage", {
      method: "POST", headers: { "Content-Type": "application/json", "X-Vendor-CSRF": session.csrf },
      body: JSON.stringify({ videoUrl: $("homepage-video-url").value, expectedVersion: homepageState.version }),
    });
    if (version !== homepageVersion || !session) return;
    if (result.version === null || result.video?.videoId !== video.videoId) {
      throw new Error("The homepage video change could not be verified.");
    }
    acceptHomepage(result);
    notice("homepage-message", video.videoId === null ?
      "Saved. The video section is hidden on new homepage loads." :
      "Saved. The new video appears on new homepage loads.");
  } catch (error) {
    if (version !== homepageVersion || !session) return;
    homepageNeedsReload = true;
    notice("homepage-message", `${error.message} Your visible edits have been kept. Reload the saved video to check whether the change was committed before trying again.`, true);
  } finally {
    if (version === homepageVersion) setHomepageBusy(false);
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

function setOfferBusy(value) {
  offerBusy = value;
  $("offers-panel").setAttribute("aria-busy", String(value));
  $("offers-fields").disabled = value || offerNeedsReload || !offerState;
  $("save-offers").disabled = !offerDirty || value || offerNeedsReload;
  $("reload-vendor-offers").disabled = value;
  $("close-offers").disabled = value;
  $("add-coupon").disabled = value || $("vendor-coupons").children.length >= 20;
  for (const id of ["open-offers", "open-homepage", "open-prices", "sign-out"]) {
    $(id).disabled = value || priceBusy || homepageBusy;
  }
  setPriceBusy(priceBusy);
}

function clearOffers() {
  offerAccessVersion++;
  offerState = null;
  offerDirty = false;
  offerNeedsReload = false;
  $("offers-panel").hidden = true;
  $("open-offers").setAttribute("aria-expanded", "false");
  $("vendor-coupons").replaceChildren();
  $("free-delivery-minimum").value = "";
  $("delivery-fee").value = "";
  notice("offers-message", "");
  setOfferBusy(false);
}

function addCouponRow(coupon = { code: "", percent: 15, enabled: true }) {
  const row = element("div", undefined, "vendor-coupon-row");
  const codeLabel = element("label", "Code");
  const code = element("input");
  code.dataset.field = "code";
  code.value = coupon.code;
  code.required = true;
  code.maxLength = 24;
  code.minLength = 2;
  code.pattern = "[A-Za-z0-9][A-Za-z0-9_\\-]{1,23}";
  code.autocomplete = "off";
  code.spellcheck = false;
  codeLabel.append(code);
  const percentLabel = element("label", "Discount (%)");
  const percent = element("input");
  percent.dataset.field = "percent";
  percent.type = "number";
  percent.min = "1";
  percent.max = "100";
  percent.step = "1";
  percent.required = true;
  percent.value = coupon.percent;
  percentLabel.append(percent);
  const enabledLabel = element("label", "Enabled");
  enabledLabel.className = "vendor-coupon-enabled";
  const enabled = element("input");
  enabled.dataset.field = "enabled";
  enabled.type = "checkbox";
  enabled.checked = coupon.enabled;
  enabledLabel.prepend(enabled);
  const remove = element("button", "Remove coupon");
  remove.type = "button";
  remove.addEventListener("click", () => {
    row.remove();
    offerDirty = true;
    setOfferBusy(false);
    $("add-coupon").focus();
  });
  row.append(codeLabel, percentLabel, enabledLabel, remove);
  $("vendor-coupons").append(row);
  return code;
}

function acceptOffers(result) {
  if (!validOffers(result.offers) || !validOfferVersion(result.version)) throw new Error("Saved offers could not be verified.");
  offerState = result;
  offerDirty = false;
  offerNeedsReload = false;
  $("vendor-coupons").replaceChildren();
  for (const coupon of result.offers.coupons) addCouponRow(coupon);
  $("free-delivery-minimum").value = result.offers.freeDeliveryMinimum;
  $("delivery-fee").value = result.offers.deliveryFee;
}

async function loadVendorOffers() {
  if (!session || offerBusy || priceBusy || homepageBusy) return;
  const version = ++offerAccessVersion;
  setOfferBusy(true);
  notice("offers-message", "Loading saved coupons and delivery rules...");
  try {
    const result = await api("/api/vendor-offers");
    if (version !== offerAccessVersion || !session) return;
    acceptOffers(result);
    notice("offers-message", "Saved settings loaded. Save changes to publish across the shop.");
  } catch (error) {
    if (version !== offerAccessVersion || !session) return;
    offerNeedsReload = true;
    notice("offers-message", error.message, true);
  } finally { if (version === offerAccessVersion) setOfferBusy(false); }
}

$("open-offers").addEventListener("click", () => {
  if (!session || offerBusy || priceBusy || homepageBusy || !$("offers-panel").hidden) return;
  $("offers-panel").hidden = false;
  $("open-offers").setAttribute("aria-expanded", "true");
  loadVendorOffers();
});
$("close-offers").addEventListener("click", () => {
  if (offerBusy || (offerDirty && !window.confirm("Discard unsaved coupon and delivery edits?"))) return;
  clearOffers();
  $("open-offers").focus();
});
$("reload-vendor-offers").addEventListener("click", () => {
  if (offerDirty && !window.confirm("Reloading discards visible unsaved offer edits. Continue?")) return;
  loadVendorOffers();
});
$("add-coupon").addEventListener("click", () => {
  if (offerBusy || offerNeedsReload || !offerState || $("vendor-coupons").children.length >= 20) return;
  const input = addCouponRow();
  offerDirty = true;
  setOfferBusy(false);
  input.focus();
});
$("offers-form").addEventListener("input", () => {
  offerDirty = true;
  setOfferBusy(offerBusy);
});
$("offers-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (!session || offerBusy || priceBusy || homepageBusy || offerNeedsReload || !offerState || !offerDirty) return;
  let offers;
  try {
    offers = checkOffers({
      coupons: [...$("vendor-coupons").children].map(row => ({
        code: normalizeCoupon(row.querySelector('[data-field="code"]').value),
        percent: Number(row.querySelector('[data-field="percent"]').value),
        enabled: row.querySelector('[data-field="enabled"]').checked,
      })),
      freeDeliveryMinimum: $("free-delivery-minimum").valueAsNumber,
      deliveryFee: $("delivery-fee").valueAsNumber,
    });
  } catch (error) { notice("offers-message", error.message, true); return; }
  const version = offerAccessVersion;
  setOfferBusy(true);
  notice("offers-message", "Saving coupons and delivery rules...");
  try {
    const result = await api("/api/vendor-offers", {
      method: "POST", headers: { "Content-Type": "application/json", "X-Vendor-CSRF": session.csrf },
      body: JSON.stringify({ offers, expectedVersion: offerState.version }),
    });
    if (version !== offerAccessVersion || !session) return;
    if (JSON.stringify(result.offers) !== JSON.stringify(offers)) throw new Error("The saved offer update could not be verified.");
    acceptOffers(result);
    notice("offers-message", "Saved. New visits use these coupons and delivery rules. Open carts must reload offers if settings change.");
  } catch (error) {
    if (version !== offerAccessVersion || !session) return;
    offerNeedsReload = true;
    notice("offers-message", `${error.message} Your edits are kept. Reload saved offers to check whether the update was committed before trying again.`, true);
  } finally { if (version === offerAccessVersion) setOfferBusy(false); }
});

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
  $("order-table-wrap").hidden = true;
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
      const row = element("tr", undefined, "vendor-order-row");
      const customer = element("th");
      customer.scope = "row";
      const button = element("button", undefined, "vendor-order-open");
      button.id = `order-open-${order.orderId}`;
      button.type = "button";
      button.setAttribute("aria-label", `View request for ${order.name}, ${order.orderId}`);
      button.setAttribute("aria-haspopup", "dialog");
      const customerText = element("span");
      customerText.append(element("span", order.name), element("small", order.phone));
      button.append(customerText);
      button.addEventListener("click", () => openDetails(order.orderId));
      customer.append(button);
      const request = element("td", undefined, "vendor-order-secondary");
      request.append(element("p", order.orderId, "vendor-request-id"),
        element("p", orderTime(order.createdAt), "vendor-muted"));
      const status = element("span", order.status, "vendor-status");
      status.dataset.status = order.status;
      const statusCell = element("td");
      statusCell.append(status);
      row.append(customer, request, element("td", order.fulfilment, "vendor-order-secondary"),
        statusCell, element("td", money(order.total), "vendor-order-total"));
      row.addEventListener("click", event => {
        if (event.target.closest("button")) return;
        button.focus({ preventScroll: true });
        openDetails(order.orderId);
      });
      $("order-list").append(row);
    }
    $("order-table-wrap").hidden = result.orders.length === 0;
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
  clearShare();
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
    ["Subtotal", money(order.subtotal)], ...(order.couponCode ? [["Coupon", order.couponCode]] : []), ["Discount", `${order.discountPercent}% (${money(order.discount)})`],
    ["Delivery charge", money(order.deliveryCharge)], ["Estimated total", money(order.total)],
  ]);
  $("detail-status").value = order.status;
  $("detail-status").disabled = false;
  $("save-status").disabled = true;
  $("reload-detail").hidden = true;
}

async function openDetails(id) {
  if (!session || saving) return;
  clearShare();
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

function clearShare() {
  shareVersion++;
  shareController?.abort();
  shareBusy = false;
  $("create-share").disabled = saving;
  $("create-share").hidden = false;
  $("share-ready").hidden = true;
  $("share-link").value = "";
  $("share-expiry").textContent = "";
  $("share-whatsapp").removeAttribute("href");
  $("share-other").hidden = true;
  $("share-other").disabled = false;
  $("share-message").textContent = "";
}

function sharePayload() {
  return {
    title: `Sai Baba Crackers request ${selected.orderId}`,
    text: `Order request ${selected.orderId}. Read-only snapshot. ${$("share-expiry").textContent}`,
    url: $("share-link").value,
  };
}

$("create-share").addEventListener("click", async () => {
  if (!session || !selected || saving || shareBusy) return;
  const id = selected.orderId;
  const version = ++shareVersion;
  shareController = new AbortController();
  shareBusy = true;
  $("create-share").disabled = true;
  notice("share-message", "Creating a private request link...");
  try {
    const result = await api("/api/vendor-order-share", {
      method: "POST", headers: { "Content-Type": "application/json", "X-Vendor-CSRF": session.csrf },
      signal: AbortSignal.any([shareController.signal, AbortSignal.timeout(25000)]),
      body: JSON.stringify({ orderId: id }),
    });
    if (version !== shareVersion || !session || selected?.orderId !== id) return;
    if (typeof result.url !== "string" || typeof result.expiresAt !== "string") {
      throw new Error("The shared request link could not be verified. Create a new link.");
    }
    const url = new URL(result.url);
    const expiry = Date.parse(result.expiresAt);
    if (result.orderId !== id || url.origin !== new URL(location.href).origin || url.username || url.password || url.search || url.hash ||
        !/^\/request\/\d{8}\.[A-Za-z0-9_-]{43}$/.test(url.pathname) ||
        !Number.isFinite(expiry) || new Date(expiry).toISOString() !== result.expiresAt ||
        expiry <= Date.now() || expiry > Date.now() + 7 * 86400000 + 60000 ||
        url.pathname.slice(9, 17) !== result.expiresAt.slice(0, 10).replaceAll("-", "")) {
      throw new Error("The shared request link could not be verified. Create a new link.");
    }
    $("share-link").value = url.href;
    $("share-expiry").textContent = `Link expires ${orderTime(result.expiresAt)}.`;
    const payload = sharePayload();
    $("share-whatsapp").href = `https://wa.me/?text=${encodeURIComponent(`${payload.text}\n${payload.url}`)}`;
    $("share-other").hidden = typeof navigator.share !== "function" ||
      (typeof navigator.canShare === "function" && !navigator.canShare(payload));
    $("share-ready").hidden = false;
    $("create-share").hidden = true;
    notice("share-message", "Link ready. Choose a sharing action below. No message has been sent.");
    $("share-link").focus();
  } catch (error) {
    if (version === shareVersion && session) notice("share-message", error.message, true);
  } finally {
    if (version === shareVersion) {
      shareBusy = false;
      $("create-share").disabled = false;
    }
  }
});
$("copy-share").addEventListener("click", async () => {
  if (!session || !selected || !$("share-link").value) return;
  const version = shareVersion;
  try {
    if (!navigator.clipboard?.writeText) throw new Error("Clipboard access is unavailable.");
    await navigator.clipboard.writeText($("share-link").value);
    if (version === shareVersion && session) notice("share-message", "Request link copied. Paste it into WhatsApp, email or another app.");
  } catch (error) {
    if (version !== shareVersion || !session) return;
    notice("share-message", `${error.message} Select and copy the request link manually.`, true);
    $("share-link").focus();
    $("share-link").select();
  }
});
$("share-other").addEventListener("click", async () => {
  if (!session || !selected || !$("share-link").value || typeof navigator.share !== "function") return;
  if ($("share-other").disabled) return;
  const version = shareVersion;
  $("share-other").disabled = true;
  try {
    await navigator.share(sharePayload());
    if (version === shareVersion && session) notice("share-message", "Request link handed to your sharing app.");
  } catch (error) {
    if (version !== shareVersion || !session) return;
    notice("share-message", error.name === "AbortError" ? "Sharing cancelled. The link is still available." :
      `${error.message} Use WhatsApp or Copy link instead.`, error.name !== "AbortError");
  } finally {
    if (version === shareVersion) $("share-other").disabled = false;
  }
});

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
$("open-homepage").addEventListener("click", () => {
  if (!session || homepageBusy || priceBusy || !$("homepage-panel").hidden) return;
  $("homepage-panel").hidden = false;
  $("open-homepage").setAttribute("aria-expanded", "true");
  loadHomepage();
});
$("close-homepage").addEventListener("click", () => {
  if (homepageBusy || (homepageDirty() && !window.confirm("Discard unsaved homepage video edits?"))) return;
  clearHomepage();
  $("open-homepage").focus();
});
$("reload-homepage").addEventListener("click", () => {
  if (homepageDirty() && !window.confirm("Reloading discards visible unsaved video edits. Continue?")) return;
  loadHomepage();
});
$("homepage-video-url").addEventListener("input", () => setHomepageBusy(homepageBusy));
$("homepage-form").addEventListener("submit", saveHomepage);
$("open-prices").addEventListener("click", () => {
  if (!session || priceBusy || homepageBusy) return;
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
  if (priceDirty || priceBusy || homepageDirty() || homepageBusy || offerDirty || offerBusy) { event.preventDefault(); event.returnValue = ""; }
});
$("close-details").addEventListener("click", () => $("order-dialog").close());
$("order-dialog").addEventListener("cancel", event => { if (saving) event.preventDefault(); });
$("order-dialog").addEventListener("close", () => {
  const trigger = $(`order-open-${detailId}`);
  detailVersion++;
  detailController?.abort();
  clearShare();
  selected = null;
  detailId = "";
  $("detail-content").hidden = true;
  $("detail-customer").replaceChildren();
  $("detail-amounts").replaceChildren();
  $("detail-items").textContent = "";
  if (session) (trigger ?? $("refresh-orders")).focus({ preventScroll: true });
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
  clearShare();
  saving = true;
  $("create-share").disabled = true;
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
    $("create-share").disabled = false;
    $("close-details").disabled = false;
  }
});
$("sign-out").addEventListener("click", async () => {
  if (!session || priceBusy || homepageBusy || offerBusy ||
      ((priceDirty || homepageDirty() || offerDirty) && !window.confirm("Sign out and discard unsaved dashboard edits?"))) return;
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
