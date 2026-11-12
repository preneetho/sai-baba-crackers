import { track } from "./telemetry-client.mjs";
import { vendor } from "./catalog.mjs";
import { validCatalogue, PRODUCT_TYPES } from "./catalogue-model.mjs";
import { mediaUrl, isYouTubeMedia } from "./media-model.mjs";
import { CART_KEY, MAX_QUANTITY, sanitizeCart as checkCart, cartLines as getLines, pricing as getPricing, money, localDate, validateCustomer, prepareOrderMessage, validateOrderShareLink } from "./order.mjs";
import { DEFAULT_OFFERS, validOffers, validOfferVersion, normalizeCoupon } from "./offers-model.mjs";
import { renderOfferWidgets, initializeOfferCarousel } from "./offer-widgets.mjs";

const $ = selector => document.querySelector(selector);
let products = [];
let categories = ["All products"];
let catalogue = null;
let catalogueLoading = false;
let retainedCart = null;
const sanitizeCart = value => checkCart(value, products);
const cartLines = value => getLines(value, products);
let offers = null;
let offerVersion = null;
let offersLoading = false;
let couponCode = "";
const pricing = (value, fulfilment = "pickup") => getPricing(value, products, offers ?? DEFAULT_OFFERS, offers ? couponCode : "", fulfilment);
const total = value => pricing(value).total;
let cart = {};
let category = "All products";
let productType = null;
let query = "";
let sort = "catalogue";
let fullMessage = "";
let lastReviewTrigger = null;
let submission = null;
let saving = false;
let returningToCart = false;
let galleryProduct = null;
let galleryIndex = 0;
let galleryTrigger = null;
let galleryVideo = null;
let galleryFrame = null;
const warning = $("#storage-warning");
const updateOfferCarousel = initializeOfferCarousel($("#shop-offers"), $("#shop-offers-toggle"), $("#shop-offers-dots"));

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
    warning.hidden = true;
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
    $("#catalogue-status").hidden = false;
    $("#announcement").textContent = error.message;
    return;
  }
  cart = updated;
  if (next > previous) track("cart");
  saveCart();
  renderProducts();
  renderCart();
  $("#announcement").textContent = `${products.find(product => product.id === id).name}: ${next} pack${next === 1 ? "" : "s"} in your cart. Items total ${money(total(cart))}.`;
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
  if (!products.length) {
    $("#categories").replaceChildren();
    return;
  }
  $("#categories").replaceChildren(...categories.map(name => {
    const members = products.filter(product => name === "All products" || product.category === name);
    const button = element("button", `category-tile${name === category ? " selected" : ""}`);
    button.type = "button";
    button.dataset.category = name;
    button.setAttribute("aria-pressed", String(name === category));
    const art = element("span", "category-tile-art");
    art.setAttribute("aria-hidden", "true");
    art.append(productIllustration({ category: name, name: "" }));
    button.append(art, element("span", "category-tile-name", name),
      element("small", "category-tile-count", `${members.length} product${members.length === 1 ? "" : "s"}`));
    button.addEventListener("click", () => {
      category = name;
      renderCategories();
      renderTypes();
      renderProducts();
      $("#results-count").focus({ preventScroll: true });
      $("#results-count").scrollIntoView({ block: "start" });
    });
    return button;
  }));
}

function matchingProducts(type = productType) {
  return products.filter(product =>
    (category === "All products" || product.category === category) &&
    (type === null || product.types?.includes(type)) &&
    `${product.id} ${product.name} ${product.brand} ${product.category}`.toLowerCase().includes(query.toLowerCase()));
}

function renderTypes() {
  const candidates = matchingProducts(null);
  $("#product-types").replaceChildren(...[{ id: null, label: "All types" }, ...PRODUCT_TYPES].map(({ id, label }) => {
    const count = id === null ? candidates.length : candidates.filter(product => product.types?.includes(id)).length;
    const button = element("button", `category-chip${id === productType ? " selected" : ""}`, `${label} (${count})`);
    button.type = "button";
    button.dataset.type = id ?? "";
    button.setAttribute("aria-pressed", String(id === productType));
    button.disabled = count === 0 && id !== null && id !== productType;
    button.addEventListener("click", () => {
      productType = id;
      renderTypes();
      renderProducts();
      [...$("#product-types").children].find(child => child.dataset.type === (id ?? ""))?.focus({ preventScroll: true });
    });
    return button;
  }));
}

function renderProducts() {
  const filtered = matchingProducts();
  if (sort === "low") filtered.sort((a, b) => a.price - b.price);
  if (sort === "high") filtered.sort((a, b) => b.price - a.price);
  if (sort === "name") filtered.sort((a, b) => a.name.localeCompare(b.name));
  const typeLabel = PRODUCT_TYPES.find(type => type.id === productType)?.label;
  $("#results-count").textContent = `${filtered.length} product${filtered.length === 1 ? "" : "s"}${category === "All products" ? "" : ` in ${category.toLowerCase()}`}${typeLabel ? ` matching ${typeLabel}` : ""}`;
  $("#clear-filters").hidden = category === "All products" && productType === null && !query;
  $("#no-results").hidden = filtered.length !== 0;
  $("#no-results-title").textContent = products.length ? "No products found" : "No products currently available";
  $("#no-results-message").textContent = products.length ? "Try a different product name, category or type, or clear filters." :
    "Please check back later or contact the shop.";
  $("#reset-filters").hidden = products.length === 0;
  $("#products").replaceChildren(...filtered.map(product => {
    const card = element("article", `product-card${cart[product.id] ? " in-cart" : ""}`);
    card.dataset.id = product.id;
    const hasMedia = Boolean(product.media?.length);
    const art = element(hasMedia ? "button" : "div", `product-art art-${categories.indexOf(product.category) % 4}${hasMedia ? " media-cover" : ""}`);
    const number = element("span", "product-number", `NO. ${String(product.id).padStart(2, "0")}`);
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
        art.replaceChildren(productIllustration(product), failure, expand);
      }, { once: true });
      art.append(cover, expand);
      art.addEventListener("click", () => openMedia(product, art));
    } else {
      art.setAttribute("aria-hidden", "true");
      art.append(productIllustration(product));
    }
    const body = element("div", "product-body");
    const meta = element("div", "product-meta");
    meta.append(number, element("p", "product-brand", product.brand));
    body.append(meta, element("h3", "", product.name),
      element("p", "product-unit", product.unit));
    if (product.types?.length) {
      const types = element("p", "product-type-labels",
        PRODUCT_TYPES.filter(type => product.types.includes(type.id)).map(type => type.label).join(" \u00b7 "));
      body.append(types);
    }
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
    status.textContent = "Loading YouTube player...";
    const watch = element("a", "", "Watch on YouTube (new tab)");
    watch.href = mediaUrl(asset, "watch");
    watch.target = "_blank";
    watch.rel = "noopener noreferrer";
    const frame = element("iframe");
    frame.title = `YouTube video: ${asset.alt}`;
    frame.allow = "encrypted-media; picture-in-picture; fullscreen";
    frame.allowFullscreen = true;
    // YouTube requires an identifying Referer; disclose only this site's origin.
    frame.referrerPolicy = "strict-origin-when-cross-origin";
    frame.addEventListener("load", () => {
      if (galleryFrame !== frame) return;
      status.textContent = "Press play to watch.";
      retry.hidden = true;
    });
    frame.addEventListener("error", () => {
      if (galleryFrame !== frame) return;
      status.textContent = "The YouTube player could not load. Retry or use Watch on YouTube.";
      retry.hidden = false;
    });
    frame.src = mediaUrl(asset, "play");
    galleryFrame = frame;
    node.append(frame, watch);
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
  const amounts = pricing(cart, !withIds && $("#fulfilment-delivery").checked ? "delivery" : "pickup");
  const summary = element("div", "pricing-summary");
  const rows = [
    ["Subtotal", money(amounts.subtotal), "pricing-row", "cart-subtotal"],
    ...(amounts.couponCode ? [[`Coupon ${amounts.couponCode} (${amounts.discountPercent}%)`,
      `\u2212${money(amounts.discount)}`, "pricing-row discount-row", "cart-discount"]] : []),
    ...(!withIds && $("#fulfilment-delivery").checked ?
      [["Delivery fee", amounts.deliveryCharge ? money(amounts.deliveryCharge) : "FREE", "pricing-row", "delivery-charge"]] : []),
    ...(!withIds ? [["Estimated total", money(amounts.total), "cart-total", "cart-total"]] : []),
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
  const amounts = pricing(cart);
  const units = lines.reduce((sum, line) => sum + line.quantity, 0);
  $("#header-count").textContent = units;
  $("#cart-count").textContent = lines.length;
  $("#cart-pricing").replaceChildren(pricingSummary(true));
  $("#cart-total").textContent = money(amounts.total);
  $("#cart-details-label").textContent = amounts.couponCode ?
    `Coupon ${amounts.couponCode} (${amounts.discountPercent}%)` : "Coupon & price details";
  $("#cart-savings").textContent = amounts.couponCode ? `Save ${money(amounts.discount)}` : "";
  $("#review").disabled = lines.length === 0 || !offers || offersLoading;
  $("#review").textContent = lines.length ? `Continue \u00b7 ${money(total(cart))}` : "Continue to checkout";
  for (const button of document.querySelectorAll("#clear-cart, #clear-cart-top")) {
    button.hidden = lines.length === 0;
  }
  $("#mobile-cart").hidden = lines.length === 0;
  $("#mobile-cart-label").textContent = `${units} pack${units === 1 ? "" : "s"} \u00b7 ${money(total(cart))}`;
  if (offers) {
    const progress = amounts.freeDeliveryRemaining > 0 ?
      `Add ${money(amounts.freeDeliveryRemaining)} more for free delivery` : "Free delivery unlocked";
    $("#delivery-progress-text").textContent = progress;
    $("#mobile-delivery-progress").textContent = progress;
    $("#delivery-progress").max = Math.max(1, offers.freeDeliveryMinimum);
    $("#delivery-progress").value = amounts.freeDeliveryRemaining > 0 ? amounts.billed : $("#delivery-progress").max;
    $("#delivery-progress").setAttribute("aria-label", progress);
    $("#delivery-progress-note").textContent = amounts.freeDeliveryRemaining > 0 ?
      `Free delivery from ${money(offers.freeDeliveryMinimum)} after coupon discount. Otherwise ${money(offers.deliveryFee)}. Pickup is free.` :
      "Based on your items total after coupon discount. Delivery area and timing need shop confirmation.";
  }
  $("#delivery-offer").hidden = !offers || !lines.length;
  $("#coupon-code").disabled = !offers || saving || offersLoading;
  $("#apply-coupon").disabled = !offers || saving || offersLoading;
  $("#remove-coupon").hidden = !couponCode;
  $("#remove-coupon").disabled = saving || offersLoading;
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
  const amounts = pricing(cart, method);
  $("#checkout-total").textContent = money(amounts.total);
  $("#fulfilment-help").textContent = method === "pickup" ?
    "Collect from Industrial Estate, Main Road, Sanath Nagar. The shop will confirm timing." :
    `${amounts.deliveryCharge ? `Delivery fee ${money(amounts.deliveryCharge)}. Add ${money(amounts.freeDeliveryRemaining)} more after discount for free delivery.` : "Free home delivery."} The shop will confirm delivery area and timing.`;
  $("#checkout-summary .pricing-summary")?.replaceWith(pricingSummary());
}

function showReview() {
  if (!catalogue || catalogueLoading || !offers || offersLoading || !cartLines(cart).length) return;
  lastReviewTrigger = document.activeElement;
  $("#checkout-summary").replaceChildren(pricingSummary());
  $("#checkout-total").textContent = money(total(cart));
  $("#checkout-title").textContent = "Your details";
  $("#checkout-step").textContent = "STEP 2 OF 3";
  $("#back-to-cart").hidden = false;
  $("#customer-form").hidden = false;
  $("#message-preview").hidden = true;
  $("#form-error").hidden = true;
  $("#preferred-date").min = localDate();
  updateFulfilment();
  $("#checkout").showModal();
  $("#checkout .checkout-body").scrollTop = 0;
  $("#checkout-title").focus({ preventScroll: true });
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
  $("#back-to-cart").disabled = value;
  $("#customer-form").setAttribute("aria-busy", String(value));
  $("#submit-requirement").textContent = value ?
    "Saving order request..." : "Save & open WhatsApp";
  $("#save-status").hidden = !value;
}

$("#checkout").addEventListener("cancel", event => {
  if (saving) event.preventDefault();
});
$("#checkout").addEventListener("close", () => {
  if (returningToCart) {
    returningToCart = false;
    lastReviewTrigger?.focus({ preventScroll: true });
    return;
  }
  $("#customer-form").reset();
  for (const details of document.querySelectorAll("#checkout details")) details.open = false;
  updateFulfilment();
  $("#message-links").replaceChildren();
  $("#full-message").value = "";
  fullMessage = "";
  submission = null;
  $("#order-reference").textContent = "";
  $("#order-details").hidden = true;
  $("#order-link").removeAttribute("href");
  $("#order-expiry").textContent = "";
  $("#whatsapp-recovery").open = false;
  $("#whatsapp-message").value = "";
  $("#whatsapp-copy-status").textContent = "";
  $("#open-shop-chat").removeAttribute("href");
  lastReviewTrigger?.focus({ preventScroll: true });
});
$("#review").addEventListener("click", showReview);
$("#close-checkout").addEventListener("click", closeReview);
$("#back-to-cart").addEventListener("click", () => {
  if (saving) return;
  returningToCart = true;
  $("#checkout").close();
});
$("#checkout").addEventListener("click", event => {
  if (event.target !== $("#checkout")) return;
  const box = $("#checkout").getBoundingClientRect();
  if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) closeReview();
});
$("#search").addEventListener("input", event => {
  query = event.target.value.trim();
  renderTypes();
  renderProducts();
});
$("#sort").addEventListener("change", event => {
  sort = event.target.value;
  renderProducts();
});
function resetFilters() {
  category = "All products";
  productType = null;
  query = "";
  $("#search").value = "";
  renderCategories();
  renderTypes();
  renderProducts();
  $("#search").focus();
}
$("#reset-filters").addEventListener("click", resetFilters);
$("#clear-filters").addEventListener("click", resetFilters);
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
$("#customer-form").addEventListener("invalid", event => {
  const details = event.target.closest("details");
  if (details) details.open = true;
}, true);
$("#customer-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (saving) return;
  $("#form-error").hidden = true;
  try {
    const customer = validateCustomer(Object.fromEntries(new FormData(event.currentTarget)));
    if (!catalogue) throw new Error("Load the current price list before submitting.");
    const selection = sanitizeCart(cart);
    if (!offers) throw new Error("Return to your cart and reload offers before submitting.");
    // Requoting after an uncertain save must not create a duplicate request.
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
          catalogue: { year: catalogue.year, revision: catalogue.revision }, couponCode, offerVersion, consent: true, shareConsent: true }),
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
    if (!response.ok) {
      if (result?.offersChanged === true) {
        offers = null;
        $("#shop-offers-ribbon").hidden = true;
        updateOfferCarousel();
        $("#offer-status").textContent = result.error;
        $("#reload-offers").hidden = false;
      }
      throw new Error(typeof result?.error === "string" ? result.error :
        "We could not confirm saving your order request. Keep checkout open and retry.");
    }
    const orderId = `SBC-${submission.requestId.toUpperCase()}`;
    if (result?.orderId !== orderId || typeof result.message !== "string" ||
        !result.message.startsWith(`Order ID: ${orderId}\n`) || result.message.length > 131072 ||
        typeof result.summary !== "string" ||
        !result.summary.startsWith(`Order ID: ${orderId}\n`) || result.summary.length > 65536) {
      throw new Error("The order tracker did not confirm the expected request ID. Keep checkout open and retry.");
    }
    track("saved");
    fullMessage = result.message;
    const share = validateOrderShareLink(result.share, window.location.origin, orderId);
    const message = prepareOrderMessage(result.summary);
    if (!message.text.includes(share.url)) {
      throw new Error("Your order request is saved, but its WhatsApp summary is missing the details link. Keep checkout open and retry.");
    }
    $("#order-details").hidden = false;
    $("#order-link").href = share.url;
    const expiry = new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short",
    }).format(new Date(share.expiresAt));
    $("#order-expiry").textContent = ` Link expires ${expiry} IST. Anyone with the link can view your details.`;
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
    $("#handoff-instructions").textContent = "Tap Send in WhatsApp to share your request. The shop will confirm availability and final prices. No payment has been made.";
    const link = element("a", "button primary wide", "Open WhatsApp \u2197");
    link.href = message.url;
    link.target = "_self";
    link.rel = "noopener noreferrer";
    $("#message-links").replaceChildren(link);
    $("#customer-form").hidden = true;
    $("#message-preview").hidden = false;
    $("#checkout-title").textContent = "Send on WhatsApp";
    $("#checkout-step").textContent = "STEP 3 OF 3";
    $("#back-to-cart").hidden = true;
    $("#message-preview").scrollTop = 0;
    $("#copy-status").textContent = "";
    $("#message-title").tabIndex = -1;
    $("#message-title").focus();
    try {
      link.click();
    } catch {
      console.warn("Automatic WhatsApp navigation was blocked by the browser.");
      $("#whatsapp-recovery").open = true;
      $("#handoff-instructions").textContent += " WhatsApp could not open automatically. Use Open WhatsApp or the recovery option below.";
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
  $("#checkout-title").textContent = "Your details";
  $("#checkout-step").textContent = "STEP 2 OF 3";
  $("#back-to-cart").hidden = false;
  $("#customer-form input").focus();
});
$("#copy-message").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(fullMessage);
    $("#copy-status").textContent = "Message copied. Paste the complete order request into the shop's WhatsApp chat, then tap Send.";
  } catch {
    $("#copy-status").textContent = "Clipboard access is unavailable. Select and copy the message below manually.";
    $("#complete-request").open = true;
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
  $("#catalogue-discovery").hidden = true;
  $("#reload-catalogue").disabled = true;
  $("#review").disabled = true;
  $("#catalogue-status").textContent = "Loading the current price list...";
  $("#catalogue-status").hidden = false;
  $("#reload-catalogue").hidden = true;
  try {
    const response = await fetch("/api/catalogue", { cache: "no-store", signal: AbortSignal.timeout(25000) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "The price list is unavailable.");
    if (!validCatalogue(result, { allowEmpty: true })) throw new Error("The price list could not be verified. Retry or contact the shop.");
    catalogue = result;
    products = result.products.filter(product => product.hidden !== true);
    categories = ["All products", ...new Set(products.map(product => product.category))];
    category = "All products";
    productType = null;
    cart = {};
    submission = null;
    try {
      const stored = retainedCart ?? localStorage.getItem(CART_KEY);
      if (stored) cart = restoredCart(stored);
      else if (localStorage.getItem("sai-baba-cart-v1")) {
        showStorageWarning("Your old cart used the previous catalogue format. Please select items again using the current prices.");
      }
    } catch {
      showStorageWarning("Your saved cart is no longer available. Please select your items again.", true);
    }
    document.title = `${vendor.name} | Diwali ${result.year}`;
    for (const node of document.querySelectorAll("[data-catalogue-year]")) node.textContent = result.year;
    $("#catalogue-status").textContent = "";
    $("#catalogue-status").hidden = true;
    renderCategories();
    renderTypes();
    renderProducts();
    $("#catalogue-discovery").hidden = products.length === 0;
    renderCart();
    retainedCart = null;
  } catch (error) {
    console.error("Customer catalogue could not be loaded.");
    catalogue = null;
    products = [];
    cart = {};
    $("#products").replaceChildren();
    $("#categories").replaceChildren();
    $("#product-types").replaceChildren();
    $("#clear-filters").hidden = true;
    $("#results-count").textContent = "Price list unavailable";
    $("#no-results").hidden = true;
    renderCart();
    $("#catalogue-status").textContent = `${error.message} Retry loading the price list or contact the shop.`;
    $("#catalogue-status").hidden = false;
    $("#reload-catalogue").hidden = false;
  } finally {
    catalogueLoading = false;
    $("#reload-catalogue").disabled = false;
  }
}
$("#reload-catalogue").addEventListener("click", loadCatalogue);
async function findCoupon(code) {
  const known = offers.coupons.find(coupon => coupon.enabled && coupon.code === code);
  if (known) return known;
  const response = await fetch("/api/offers", { method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, version: offerVersion }),
    cache: "no-store", signal: AbortSignal.timeout(25000) });
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(result.error || "This coupon could not be verified. Try again.");
    error.status = response.status;
    throw error;
  }
  if (result.version !== offerVersion || result.coupon?.code !== code || !result.coupon.enabled ||
    !validOffers({ ...offers, coupons: [...offers.coupons, result.coupon] })) {
    throw new Error("The coupon could not be verified. Reload offers before trying again.");
  }
  offers.coupons.push(result.coupon);
  return result.coupon;
}
async function loadOffers() {
  if (saving || offersLoading || $("#checkout").open) return;
  offersLoading = true;
  $("#offer-status").textContent = "Loading offers and delivery charges...";
  $("#reload-offers").disabled = true;
  renderCart();
  try {
    const response = await fetch("/api/offers", { cache: "no-store", signal: AbortSignal.timeout(25000) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Offer settings are unavailable.");
    if (!validOffers(result.offers) || !validOfferVersion(result.version)) throw new Error("Offers could not be verified. Reload before checking out.");
    offers = result.offers;
    offerVersion = result.version;
    try { if (couponCode) await findCoupon(couponCode); }
    catch (error) {
      if (error.status !== 400) throw error;
      couponCode = "";
      $("#coupon-code").value = "";
      $("#coupon-status").textContent = `${error.message} No discount is currently applied.`;
    }
    $("#offer-status").textContent = "";
    $("#reload-offers").hidden = true;
    renderOfferWidgets($("#shop-offers"), offers, $("#shop-coupon-copy-status"));
    $("#shop-offers-ribbon").hidden = false;
    updateOfferCarousel();
  } catch (error) {
    offers = null;
    $("#shop-offers-ribbon").hidden = true;
    updateOfferCarousel();
    $("#offer-status").textContent = error.message;
    $("#reload-offers").hidden = false;
  } finally {
    offersLoading = false;
    $("#reload-offers").disabled = false;
    renderCart();
  }
}
$("#coupon-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (!offers || saving || offersLoading) return;
  offersLoading = true;
  $("#coupon-status").textContent = "Checking coupon...";
  renderCart();
  try {
    const code = normalizeCoupon($("#coupon-code").value);
    if (!code) throw new Error("Enter a coupon code.");
    const coupon = await findCoupon(code);
    couponCode = coupon.code;
    $("#coupon-code").value = couponCode;
    $("#coupon-status").textContent = `${coupon.percent}% discount applied with ${couponCode}.`;
  } catch (error) {
    $("#coupon-status").textContent = error.message;
    if (error.status === 409) {
      offers = null;
      $("#shop-offers-ribbon").hidden = true;
      updateOfferCarousel();
      $("#offer-status").textContent = error.message;
      $("#reload-offers").hidden = false;
    }
  } finally {
    offersLoading = false;
    renderCart();
  }
});
$("#remove-coupon").addEventListener("click", () => {
  if (saving || offersLoading) return;
  couponCode = "";
  $("#coupon-code").value = "";
  $("#coupon-status").textContent = "Coupon removed. No discount applied.";
  renderCart();
});
$("#reload-offers").addEventListener("click", loadOffers);
loadCatalogue();
loadOffers();
