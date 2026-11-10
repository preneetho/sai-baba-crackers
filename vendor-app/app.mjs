import { track } from "./telemetry-client.mjs";
import { vendor } from "./catalog.mjs";
import { validCatalogue } from "./catalogue-model.mjs";
import { mediaUrl, isYouTubeMedia } from "./media-model.mjs";
import { CART_KEY, MAX_QUANTITY, DISCOUNT_PERCENT, sanitizeCart as checkCart, cartLines as getLines, pricing as getPricing, total as getTotal, money, localDate, validateCustomer, prepareOrderMessage, validatePdfLink } from "./order.mjs";

const $ = selector => document.querySelector(selector);
let products = [];
let categories = ["All products"];
let catalogue = null;
let catalogueLoading = false;
let retainedCart = null;
const sanitizeCart = value => checkCart(value, products);
const cartLines = value => getLines(value, products);
const pricing = value => getPricing(value, products);
const total = value => getTotal(value, products);
let cart = {};
let category = "All products";
let query = "";
let sort = "catalogue";
let fullMessage = "";
let lastReviewTrigger = null;
let submission = null;
let saving = false;
let galleryProduct = null;
let galleryIndex = 0;
let galleryTrigger = null;
let galleryVideo = null;
let galleryFrame = null;
const warning = $("#storage-warning");

function showStorageWarning(message, reset = false) {
  warning.replaceChildren(document.createTextNode(message));
  if (reset) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "text-button";
    button.textContent = "Discard invalid saved cart";
    button.addEventListener("click", () => {
      try {
        localStorage.removeItem(CART_KEY);
        warning.hidden = true;
      } catch {
        showStorageWarning("This browser cannot access your saved cart. Your current cart works, but will not survive a refresh.");
      }
    });
    warning.append(" ", button);
  }
  warning.hidden = false;
}

function restoredCart(text) {
  const stored = JSON.parse(text);
  if (stored?.year !== catalogue.year || stored?.revision !== catalogue.revision) {
    throw new Error("The price-list year or prices changed. Start a new cart using the current list.");
  }
  const selection = sanitizeCart(stored.cart);
  pricing(selection);
  return selection;
}

function saveCart() {
  try {
    localStorage.setItem(CART_KEY, JSON.stringify({ year: catalogue.year, revision: catalogue.revision, cart }));
  } catch {
    showStorageWarning("Your cart could not be saved on this device. Keep this page open or download your order request before leaving.");
  }
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function quantityControl(product, compact = false) {
  const control = element("div", `quantity-control${compact ? " compact" : ""}`);
  const quantity = cart[product.id] ?? 0;
  const decrease = element("button", "", "\u2212");
  decrease.type = "button";
  decrease.setAttribute("aria-label", `Remove one pack of ${product.name}, ${product.brand}, product ${product.id}`);
  decrease.disabled = quantity === 0;
  decrease.dataset.direction = "decrease";
  const amount = element("span", "", String(quantity));
  amount.setAttribute("aria-label", `${quantity} pack${quantity === 1 ? "" : "s"}`);
  const increase = element("button", "", "+");
  increase.type = "button";
  increase.disabled = quantity === MAX_QUANTITY;
  increase.dataset.direction = "increase";
  increase.setAttribute("aria-label", `Add one pack of ${product.name}, ${product.brand}, product ${product.id}`);
  decrease.addEventListener("click", () => updateQuantity(product.id, -1, compact));
  increase.addEventListener("click", () => updateQuantity(product.id, 1, compact));
  control.append(decrease, amount, increase);
  return control;
}

function updateQuantity(id, change, fromCart) {
  if (!catalogue || catalogueLoading || saving) return;
  const previous = cart[id] ?? 0;
  const next = Math.max(0, Math.min(MAX_QUANTITY, previous + change));
  const updated = { ...cart };
  if (next === 0) delete updated[id];
  else updated[id] = next;
  try {
    pricing(updated);
  } catch (error) {
    $("#catalogue-status").textContent = error.message;
    $("#announcement").textContent = error.message;
    return;
  }
  cart = updated;
  if (next > previous) track("cart");
  saveCart();
  renderProducts();
  renderCart();
  $("#announcement").textContent = `${products.find(product => product.id === id).name}: ${next} pack${next === 1 ? "" : "s"} in your cart. Estimated total after ${DISCOUNT_PERCENT}% discount ${money(total(cart))}.`;
  const scope = fromCart ? "#cart-items" : "#products";
  const direction = change > 0 ? "increase" : "decrease";
  const active = $(`${scope} [data-id="${id}"] [data-direction="${direction}"]:not(:disabled)`) ??
    $(`${scope} [data-id="${id}"] button:not(:disabled)`) ??
    $("#review:not(:disabled)") ?? $("#search");
  active.focus({ preventScroll: true });
}

const categoryArtwork = {
  Chakkars: "chakkar", "Pencils & stars": "pencil", "Flower pots": "flower-pot",
  Crackers: "crackers", Novelties: "novelty", Rockets: "rocket",
  "Fountains & shots": "fountain", Sparklers: "sparklers",
};

const artworkVariants = {
  "Pencils & stars": [[/twinkling/i, "twinkling"]],
  Crackers: [[/wala/i, "garland"], [/bomb/i, "bomb"]],
  Novelties: [
    [/matches/i, "matches"], [/roll caps/i, "roll-caps"], [/pop-pop/i, "pop-pops"],
    [/gun/i, "cap-gun"], [/helicopter/i, "helicopter"], [/butterfly/i, "butterfly"],
    [/merry go round/i, "chakkar"], [/siren/i, "siren"],
  ],
  "Fountains & shots": [
    [/comet/i, "comet"], [/shots/i, "shots"], [/peacock/i, "peacock"],
    [/candle|torch/i, "pencil"],
  ],
};

function productIllustration(product) {
  const type = artworkVariants[product.category]?.find(([pattern]) => pattern.test(product.name))?.[1] ??
    categoryArtwork[product.category] ?? "fountain";
  if (typeof type !== "string") throw new Error(`Missing artwork for category: ${product.category}`);
  const namespace = "http://www.w3.org/2000/svg";
  const illustration = document.createElementNS(namespace, "svg");
  illustration.setAttribute("class", "product-illustration");
  illustration.setAttribute("viewBox", "0 0 64 64");
  illustration.setAttribute("aria-hidden", "true");
  illustration.setAttribute("focusable", "false");
  const use = document.createElementNS(namespace, "use");
  use.setAttribute("href", `#product-art-${type}`);
  illustration.append(use);
  return illustration;
}

function renderCategories() {
  $("#categories").replaceChildren(...categories.map(name => {
    const button = element("button", `category-chip${name === category ? " selected" : ""}`, name);
    button.type = "button";
    button.setAttribute("aria-pressed", String(name === category));
    button.addEventListener("click", () => {
      category = name;
      renderCategories();
      renderProducts();
      [...$("#categories").children].find(child => child.textContent === name)?.focus({ preventScroll: true });
    });
    return button;
  }));
}

function renderProducts() {
  const filtered = products.filter(product =>
    (category === "All products" || product.category === category) &&
    `${product.id} ${product.name} ${product.brand} ${product.category}`.toLowerCase().includes(query.toLowerCase()));
  if (sort === "low") filtered.sort((a, b) => a.price - b.price);
  if (sort === "high") filtered.sort((a, b) => b.price - a.price);
  if (sort === "name") filtered.sort((a, b) => a.name.localeCompare(b.name));
  $("#results-count").textContent = `${filtered.length} product${filtered.length === 1 ? "" : "s"}${category === "All products" ? "" : ` in ${category.toLowerCase()}`}`;
  $("#no-results").hidden = filtered.length !== 0;
  $("#no-results-title").textContent = products.length ? "No products found" : "No products currently available";
  $("#no-results-message").textContent = products.length ? "Try a different product name or category." :
    "Please check back later or contact the shop.";
  $("#reset-filters").hidden = products.length === 0;
  $("#products").replaceChildren(...filtered.map(product => {
    const card = element("article", `product-card${cart[product.id] ? " in-cart" : ""}`);
    card.dataset.id = product.id;
    const hasMedia = Boolean(product.media?.length);
    const art = element(hasMedia ? "button" : "div", `product-art art-${categories.indexOf(product.category) % 4}${hasMedia ? " media-cover" : ""}`);
    const number = element("span", hasMedia ? "media-cover-number" : "product-number", `NO. ${String(product.id).padStart(2, "0")}`);
    number.setAttribute("aria-hidden", "true");
    if (hasMedia) {
      art.type = "button";
      art.dataset.mediaProduct = String(product.id);
      const label = `View photos and videos for ${product.name}, product ${product.id}`;
      art.setAttribute("aria-label", label);
      art.setAttribute("aria-haspopup", "dialog");
      art.title = "View photos & videos";
      const expand = mediaIcon("expand");
      const cover = element("img", "product-cover");
      cover.src = mediaUrl(product.media[0]);
      cover.alt = "";
      cover.loading = "lazy";
      cover.decoding = "async";
      cover.addEventListener("error", () => {
        art.setAttribute("aria-label", `Preview unavailable. ${label}`);
        const failure = element("span", "media-cover-error", "Preview unavailable");
        failure.setAttribute("aria-hidden", "true");
        art.replaceChildren(productIllustration(product), failure, expand, number);
      }, { once: true });
      art.append(cover, expand, number);
      art.addEventListener("click", () => openMedia(product, art));
    } else {
      art.setAttribute("aria-hidden", "true");
      art.append(number,
        productIllustration(product),
        element("span", "art-category", product.category));
    }
    const body = element("div", "product-body");
    body.append(element("p", "product-brand", product.brand), element("h3", "", product.name),
      element("p", "product-unit", product.unit));
    const bottom = element("div", "product-bottom");
    const price = element("div", "product-price");
    price.append(element("strong", "", money(product.price)), element("span", "", "per pack"));
    bottom.append(price, quantityControl(product));
    body.append(bottom);
    card.append(art, body);
    return card;
  }));
}

function mediaIcon(type) {
  const badge = element("span", `media-cover-icon media-cover-${type}`);
  badge.setAttribute("aria-hidden", "true");
  const namespace = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(namespace, "svg");
  svg.setAttribute("viewBox", "0 0 20 20");
  svg.setAttribute("focusable", "false");
  const use = document.createElementNS(namespace, "use");
  use.setAttribute("href", `#media-icon-${type}`);
  svg.append(use);
  badge.append(svg);
  return badge;
}

function stopGalleryVideo() {
  if (galleryFrame) {
    galleryFrame.removeAttribute("src");
    galleryFrame = null;
  }
  if (!galleryVideo) return;
  galleryVideo.pause();
  galleryVideo.removeAttribute("src");
  galleryVideo.load();
  galleryVideo = null;
}

function openMedia(product, trigger) {
  galleryProduct = product;
  galleryIndex = 0;
  galleryTrigger = trigger;
  $("#product-media-title").textContent = product.name;
  renderMedia();
  $("#product-media-dialog").showModal();
}

function renderMedia() {
  stopGalleryVideo();
  const asset = galleryProduct.media[galleryIndex];
  $("#product-media-stage").replaceChildren();
  $("#product-media-credit").textContent = asset.credit ? `Credit / license: ${asset.credit}` : "";
  $("#product-media-description").textContent = asset.alt;
  const status = $("#product-media-status");
  const retry = $("#retry-product-media");
  retry.hidden = true;
  const youtube = isYouTubeMedia(asset);
  const node = element(youtube ? "div" : asset.resourceType === "image" ? "img" : "video",
    youtube ? "gallery-asset gallery-youtube" : "gallery-asset");
  node.addEventListener("error", () => {
    status.textContent = "This media could not be loaded. Retry, choose another item, or close this preview to keep shopping.";
    retry.hidden = false;
  });
  if (youtube) {
    status.textContent = "Load the YouTube player, then press play. Nothing plays automatically. YouTube content is loaded from YouTube.";
    const poster = element("img", "gallery-youtube-poster");
    poster.alt = asset.alt;
    poster.src = mediaUrl(asset);
    poster.addEventListener("error", () => {
      if (galleryProduct?.media[galleryIndex] !== asset || galleryFrame) return;
      poster.hidden = true;
      status.textContent = "Thumbnail unavailable. You can still load the YouTube player or watch on YouTube.";
    });
    const watch = element("a", "", "Video unavailable? Watch on YouTube (new tab)");
    watch.href = mediaUrl(asset, "watch");
    watch.target = "_blank";
    watch.rel = "noopener noreferrer";
    const load = element("button", "", "Load YouTube player");
    load.type = "button";
    load.addEventListener("click", () => {
      const frame = element("iframe");
      frame.title = `YouTube video: ${asset.alt}`;
      frame.allow = "encrypted-media; picture-in-picture; fullscreen";
      frame.allowFullscreen = true;
      // YouTube requires an identifying Referer; disclose only this site's origin.
      frame.referrerPolicy = "strict-origin-when-cross-origin";
      frame.addEventListener("load", () => {
        if (galleryFrame !== frame) return;
        status.textContent = "Press play in the YouTube player. If playback is unavailable, use Watch on YouTube.";
      });
      frame.addEventListener("error", () => {
        if (galleryFrame !== frame) return;
        status.textContent = "The YouTube player could not load. Retry or use Watch on YouTube.";
      });
      frame.src = mediaUrl(asset, "play");
      galleryFrame = frame;
      status.textContent = "Loading YouTube player... If unavailable, use Watch on YouTube.";
      retry.hidden = false;
      node.replaceChildren(frame, watch);
      frame.focus();
    });
    node.append(poster, load, watch);
  } else if (asset.resourceType === "image") {
    status.textContent = "Loading photo...";
    node.alt = asset.alt;
    node.addEventListener("load", () => { status.textContent = ""; });
    node.src = mediaUrl(asset, "full");
  } else {
    status.textContent = "Press play to load the video. No video plays automatically.";
    node.controls = true;
    node.preload = "none";
    node.playsInline = true;
    node.poster = mediaUrl(asset);
    node.setAttribute("aria-label", asset.alt);
    node.addEventListener("playing", () => { status.textContent = ""; });
    node.addEventListener("waiting", () => { status.textContent = "Loading video..."; });
    node.src = mediaUrl(asset, "play");
    galleryVideo = node;
  }
  $("#product-media-stage").append(node);
  $("#product-media-position").textContent = `${galleryIndex + 1} of ${galleryProduct.media.length}`;
  $("#previous-product-media").disabled = galleryIndex === 0;
  $("#next-product-media").disabled = galleryIndex === galleryProduct.media.length - 1;
}

function stepMedia(delta) {
  if (!galleryProduct) return;
  const next = galleryIndex + delta;
  if (next < 0 || next >= galleryProduct.media.length) return;
  galleryIndex = next;
  renderMedia();
  $("#product-media-position").focus();
}

$("#close-product-media").addEventListener("click", () => $("#product-media-dialog").close());
$("#retry-product-media").addEventListener("click", () => { if (galleryProduct) renderMedia(); });
$("#previous-product-media").addEventListener("click", () => stepMedia(-1));
$("#next-product-media").addEventListener("click", () => stepMedia(1));
$("#product-media-dialog").addEventListener("keydown", event => {
  if (event.target.tagName === "VIDEO") return;
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    event.preventDefault();
    stepMedia(event.key === "ArrowLeft" ? -1 : 1);
  }
});
$("#product-media-dialog").addEventListener("close", () => {
  stopGalleryVideo();
  $("#product-media-stage").replaceChildren();
  galleryProduct = null;
  if (galleryTrigger?.isConnected) galleryTrigger.focus({ preventScroll: true });
  else $("#catalogue-title").focus({ preventScroll: true });
  galleryTrigger = null;
});

function pricingSummary(withIds = false) {
  const amounts = pricing(cart);
  const summary = element("div", "pricing-summary");
  const rows = [
    ["Subtotal", money(amounts.subtotal), "pricing-row", "cart-subtotal"],
    [`Discount (${DISCOUNT_PERCENT}%)`,
      `\u2212${money(amounts.discount)}`, "pricing-row discount-row", "cart-discount"],
    ...(!withIds && $("#fulfilment-delivery").checked ?
      [["Delivery fee", "FREE", "pricing-row discount-row", "delivery-charge"]] : []),
    ["Estimated total", money(amounts.total), "cart-total", "cart-total"],
  ];
  for (const [label, value, className, id] of rows) {
    const row = element("div", className);
    const amount = element("strong", "", value);
    if (withIds) amount.id = id;
    row.append(element("span", "", label), amount);
    summary.append(row);
  }
  return summary;
}

function renderCart() {
  const lines = cartLines(cart);
  const units = lines.reduce((sum, line) => sum + line.quantity, 0);
  $("#header-count").textContent = units;
  $("#cart-count").textContent = lines.length;
  $("#cart-pricing").replaceChildren(pricingSummary(true));
  $("#review").disabled = lines.length === 0;
  for (const button of document.querySelectorAll("#clear-cart, #clear-cart-top")) {
    button.hidden = lines.length === 0;
  }
  $("#mobile-cart").hidden = lines.length === 0;
  $("#mobile-cart-label").textContent = `${units} pack${units === 1 ? "" : "s"} \u00b7 ${money(total(cart))}`;
  if (!lines.length) {
    const empty = element("div", "cart-empty");
    empty.append(element("span", "", "\u2727"), element("h3", "", "Your cart is empty"),
      element("p", "", "Tap + on a product to add it to your cart."));
    $("#cart-items").replaceChildren(empty);
    return;
  }
  $("#cart-items").replaceChildren(...lines.map(line => {
    const row = element("div", "cart-item");
    row.dataset.id = line.id;
    const heading = element("div", "cart-item-heading");
    heading.append(element("h3", "", line.name), element("strong", "", money(line.amount)));
    row.append(heading, element("p", "", `${line.brand} \u00b7 ${line.unit}`));
    const controls = element("div", "cart-item-controls");
    const remove = element("button", "text-button", "Remove");
    remove.type = "button";
    remove.setAttribute("aria-label", `Remove ${line.name}, product ${line.id} from cart`);
    remove.addEventListener("click", () => updateQuantity(line.id, -line.quantity, true));
    controls.append(quantityControl(line, true), remove);
    row.append(controls);
    return row;
  }));
}

function updateFulfilment() {
  const method = $("#customer-form").elements.fulfilment.value;
  const delivery = method === "delivery";
  $("#preferred-date-label").textContent = delivery ? "Preferred delivery date" :
    method === "pickup" ? "Preferred pickup date" : "Preferred date";
  $("#address-label").textContent = delivery ? "Delivery address" : "Your address";
  $("#address-help").textContent = delivery ?
    "Free home delivery to this address. The shop will confirm service area and timing." :
    method === "pickup" ? "Your address will be shared with the shop. Collect your items from the store address shown above." :
      "Your address and selected delivery or pickup option will be shared with the shop.";
  $("#checkout-summary .pricing-summary")?.replaceWith(pricingSummary());
}

function showReview() {
  if (!catalogue || catalogueLoading || !cartLines(cart).length) return;
  lastReviewTrigger = document.activeElement;
  const summary = element("div", "review-lines");
  for (const line of cartLines(cart)) {
    const row = element("div", "review-line");
    row.append(element("span", "", `#${line.id} ${line.name} (${line.brand}) \u00d7 ${line.quantity}`),
      element("strong", "", money(line.amount)));
    summary.append(row);
  }
  summary.append(pricingSummary());
  $("#checkout-summary").replaceChildren(summary);
  $("#customer-form").hidden = false;
  $("#message-preview").hidden = true;
  $("#form-error").hidden = true;
  $("#preferred-date").min = localDate();
  updateFulfilment();
  $("#checkout").showModal();
  if (cartLines(cart).length) track("cart");
  track("checkout");
}

function closeReview() {
  if (saving) return;
  $("#checkout").close();
}

function setSaving(value) {
  saving = value;
  for (const control of $("#customer-form").elements) control.disabled = value;
  $("#close-checkout").disabled = value;
  $("#customer-form").setAttribute("aria-busy", String(value));
  $("#submit-requirement").textContent = value ?
    "Saving order request..." : "Send order request via WhatsApp";
  $("#save-status").hidden = !value;
}

$("#checkout").addEventListener("cancel", event => {
  if (saving) event.preventDefault();
});
$("#checkout").addEventListener("close", () => {
  $("#customer-form").reset();
  updateFulfilment();
  $("#message-links").replaceChildren();
  $("#full-message").value = "";
  fullMessage = "";
  submission = null;
  $("#order-reference").textContent = "";
  $("#pdf-details").hidden = true;
  $("#pdf-link").removeAttribute("href");
  $("#pdf-expiry").textContent = "";
  $("#whatsapp-recovery").open = false;
  $("#whatsapp-message").value = "";
  $("#whatsapp-copy-status").textContent = "";
  $("#open-shop-chat").removeAttribute("href");
  lastReviewTrigger?.focus({ preventScroll: true });
});
$("#review").addEventListener("click", showReview);
$("#close-checkout").addEventListener("click", closeReview);
$("#checkout").addEventListener("click", event => {
  if (event.target !== $("#checkout")) return;
  const box = $("#checkout").getBoundingClientRect();
  if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) closeReview();
});
$("#search").addEventListener("input", event => {
  query = event.target.value.trim();
  renderProducts();
});
$("#sort").addEventListener("change", event => {
  sort = event.target.value;
  renderProducts();
});
$("#reset-filters").addEventListener("click", () => {
  category = "All products";
  query = "";
  $("#search").value = "";
  renderCategories();
  renderProducts();
  $("#search").focus();
});
function clearSelection() {
  if (!catalogue || catalogueLoading) return;
  if (!window.confirm("Remove all items from your cart?")) return;
  cart = {};
  saveCart();
  renderProducts();
  renderCart();
  $("#search").focus();
}
for (const button of document.querySelectorAll("#clear-cart, #clear-cart-top")) {
  button.addEventListener("click", clearSelection);
}
$("#customer-form").addEventListener("change", event => {
  if (event.target.name === "fulfilment") updateFulfilment();
});
$("#customer-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (saving) return;
  $("#form-error").hidden = true;
  try {
    const customer = validateCustomer(Object.fromEntries(new FormData(event.currentTarget)));
    if (!catalogue) throw new Error("Load the current price list before submitting.");
    const selection = sanitizeCart(cart);
    const fingerprint = JSON.stringify({ cart: selection, customer });
    if (!submission || submission.fingerprint !== fingerprint) {
      submission = { requestId: crypto.randomUUID(), fingerprint };
    }
    setSaving(true);
    let response;
    try {
      response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: submission.requestId, cart: selection, customer,
          catalogue: { year: catalogue.year, revision: catalogue.revision }, consent: true, pdfConsent: true }),
        signal: AbortSignal.timeout(25000),
      });
    } catch {
      throw new Error("We could not confirm saving your order request. Keep checkout open and retry with the same details to avoid duplicate records.");
    }
    if (response.status === 429) throw new Error("Too many attempts. Wait a minute, then retry with checkout open.");
    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error("The order tracker returned an unreadable response. Keep checkout open and retry, or contact the shop.");
    }
    if (!response.ok) throw new Error(typeof result?.error === "string" ? result.error :
      "We could not confirm saving your order request. Keep checkout open and retry.");
    const orderId = `SBC-${submission.requestId.toUpperCase()}`;
    if (result?.orderId !== orderId || typeof result.message !== "string" ||
        !result.message.startsWith(`Order ID: ${orderId}\n`) || result.message.length > 131072 ||
        (result.summary !== undefined && (typeof result.summary !== "string" ||
          !result.summary.startsWith(`Order ID: ${orderId}\n`) || result.summary.length > 65536))) {
      throw new Error("The order tracker did not confirm the expected request ID. Keep checkout open and retry.");
    }
    track("saved");
    fullMessage = result.message;
    const message = prepareOrderMessage(fullMessage, result.summary);
    const pdf = message.isSummary ? validatePdfLink(result.pdf, window.location.origin) : null;
    if (pdf && !message.text.includes(pdf.url)) {
      throw new Error("Your order request is saved, but its WhatsApp summary is missing the PDF link. Keep checkout open and retry.");
    }
    $("#pdf-details").hidden = !pdf;
    if (pdf) {
      $("#pdf-link").href = pdf.url;
      const expiry = new Intl.DateTimeFormat("en-IN", {
        timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short",
      }).format(new Date(pdf.expiresAt));
      $("#pdf-expiry").textContent = ` Link expires ${expiry} IST. Anyone with the link can open it.`;
    }
    $("#whatsapp-recovery").open = false;
    $("#whatsapp-message").value = message.text;
    $("#whatsapp-copy-status").textContent = "";
    const chatUrl = new URL(message.url);
    chatUrl.search = "";
    $("#open-shop-chat").href = chatUrl.href;
    $("#recovery-phone").textContent = vendor.phone;
    $("#full-message").value = fullMessage;
    $("#order-reference").textContent = `Order request ID: ${orderId}`;
    $("#recipient").textContent = `${vendor.name} \u00b7 ${vendor.phone}`;
    $("#message-title").textContent = "Order request saved";
    $("#handoff-instructions").textContent = message.isSummary ?
      "Your complete order request is saved. WhatsApp should open with one short summary, your request ID and a PDF link valid for 7 days. The PDF contains every item and your customer details; the shop also has the full record in its private order register. Tap Send in WhatsApp. Your complete order request is also available below. The shop will confirm your order." :
      "Your order request is saved. WhatsApp should open with your message. Tap Send there to share it with the shop. If it does not open, use the button below. The shop will confirm your order.";
    $("#handoff-instructions").textContent += " If WhatsApp closes or does not open, use the copy-and-open option below without submitting again.";
    const link = element("a", "button primary wide", "Send order request via WhatsApp \u2197");
    link.href = message.url;
    link.target = "_self";
    link.rel = "noopener noreferrer";
    $("#message-links").replaceChildren(link);
    $("#customer-form").hidden = true;
    $("#message-preview").hidden = false;
    $("#copy-status").textContent = "";
    $("#message-title").tabIndex = -1;
    $("#message-title").focus();
    try {
      link.click();
    } catch {
      console.warn("Automatic WhatsApp navigation was blocked by the browser.");
      $("#whatsapp-recovery").open = true;
      $("#handoff-instructions").textContent += " This browser could not open WhatsApp automatically. Tap Send order request via WhatsApp below, then tap Send in WhatsApp. Opening the chat alone does not send your order request.";
    }
  } catch (error) {
    $("#form-error").textContent = error.message;
    $("#form-error").hidden = false;
    $("#form-error").focus();
  } finally {
    setSaving(false);
  }
});
$("#edit-details").addEventListener("click", () => {
  $("#customer-form").hidden = false;
  $("#message-preview").hidden = true;
  $("#customer-form input").focus();
});
$("#copy-message").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(fullMessage);
    $("#copy-status").textContent = "Message copied. Paste the complete order request into the shop's WhatsApp chat, then tap Send.";
  } catch {
    $("#copy-status").textContent = "Clipboard access is unavailable. Select and copy the message below manually.";
    $("#full-message").focus();
    $("#full-message").select();
  }
});
$("#copy-whatsapp-message").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("#whatsapp-message").value);
    $("#whatsapp-copy-status").textContent = "Message copied. Open the shop's chat, paste the message, then tap Send.";
  } catch {
    $("#whatsapp-copy-status").textContent = "Clipboard access is unavailable. Select and copy the WhatsApp message below, then paste it into the shop's chat and tap Send.";
    $("#whatsapp-message").focus();
    $("#whatsapp-message").select();
  }
});
$("#download-message").addEventListener("click", () => {
  const url = URL.createObjectURL(new Blob([fullMessage], { type: "text/plain;charset=utf-8" }));
  const link = element("a");
  link.href = url;
  link.download = `sai-baba-order-request-${localDate()}.txt`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
window.addEventListener("storage", event => {
  if (event.key !== CART_KEY && event.key !== null) return;
  if ($("#checkout").open) {
    showStorageWarning("Your cart changed in another tab. This checkout keeps its current items; check your cart before sending an order request.");
    return;
  }
  try {
    if (!catalogue) return;
    cart = event.newValue ? restoredCart(event.newValue) : {};
    renderProducts();
    renderCart();
  } catch {
    showStorageWarning("Another tab saved an invalid cart. This tab has kept your current cart.", true);
  }
});
async function loadCatalogue() {
  if (catalogueLoading || saving || $("#checkout").open) return;
  if ($("#product-media-dialog").open) $("#product-media-dialog").close();
  if (catalogue) retainedCart = JSON.stringify({ year: catalogue.year, revision: catalogue.revision, cart });
  catalogueLoading = true;
  $("#reload-catalogue").disabled = true;
  $("#review").disabled = true;
  $("#catalogue-status").textContent = "Loading the current price list...";
  try {
    const response = await fetch("/api/catalogue", { cache: "no-store", signal: AbortSignal.timeout(25000) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "The price list is unavailable.");
    if (!validCatalogue(result, { allowEmpty: true })) throw new Error("The price list could not be verified. Retry or contact the shop.");
    catalogue = result;
    products = result.products.filter(product => product.hidden !== true);
    categories = ["All products", ...new Set(products.map(product => product.category))];
    category = "All products";
    cart = {};
    submission = null;
    try {
      const stored = retainedCart ?? localStorage.getItem(CART_KEY);
      if (stored) cart = restoredCart(stored);
      else if (localStorage.getItem("sai-baba-cart-v1")) {
        showStorageWarning("Your old cart used the previous catalogue format. Please select items again using the current prices.");
      }
    } catch (error) {
      showStorageWarning(`Your saved cart could not be restored. ${error.message}`, true);
    }
    document.title = `${vendor.name} | Diwali ${result.year}`;
    for (const node of document.querySelectorAll("[data-catalogue-year]")) node.textContent = result.year;
    $("#catalogue-status").textContent = `${result.year} price list loaded. Prices are confirmed again when you submit.`;
    renderCategories();
    renderProducts();
    renderCart();
    retainedCart = null;
  } catch (error) {
    console.error("Customer catalogue could not be loaded.");
    catalogue = null;
    products = [];
    cart = {};
    $("#products").replaceChildren();
    $("#categories").replaceChildren();
    $("#results-count").textContent = "Price list unavailable";
    $("#no-results").hidden = true;
    renderCart();
    $("#catalogue-status").textContent = `${error.message} Retry loading the price list or contact the shop.`;
  } finally {
    catalogueLoading = false;
    $("#reload-catalogue").disabled = false;
  }
}
$("#reload-catalogue").addEventListener("click", loadCatalogue);
loadCatalogue();
