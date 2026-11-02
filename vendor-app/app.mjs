import { products, categories, vendor } from "./catalog.mjs";
import { CART_KEY, MAX_QUANTITY, DISCOUNT_PERCENT, sanitizeCart, cartLines, pricing, total, money, localDate, validateCustomer, prepareMessages } from "./order.mjs";

const $ = selector => document.querySelector(selector);
let cart = {};
let category = "All products";
let query = "";
let sort = "catalogue";
let fullMessage = "";
let lastReviewTrigger = null;
let submission = null;
let saving = false;
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
        showStorageWarning("This browser cannot access saved selections. Your current list works, but will not survive a refresh.");
      }
    });
    warning.append(" ", button);
  }
  warning.hidden = false;
}

try {
  const stored = localStorage.getItem(CART_KEY);
  if (stored) cart = sanitizeCart(JSON.parse(stored));
} catch (error) {
  showStorageWarning(`Your previous selection could not be restored. ${error instanceof SyntaxError ? "The saved data is unreadable." : error.message}`, true);
}

function saveCart() {
  try {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
  } catch {
    showStorageWarning("Your selection could not be saved on this device. Keep this page open or download your requirement before leaving.");
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
  amount.setAttribute("aria-label", `${quantity} selling units`);
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
  const previous = cart[id] ?? 0;
  const next = Math.max(0, Math.min(MAX_QUANTITY, previous + change));
  if (next === 0) delete cart[id];
  else cart[id] = next;
  saveCart();
  renderProducts();
  renderCart();
  $("#announcement").textContent = `${products.find(product => product.id === id).name}: ${next} selling units selected. Estimated total after ${DISCOUNT_PERCENT}% discount ${money(total(cart))}.`;
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
    categoryArtwork[product.category];
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
  $("#results-count").textContent = `${filtered.length} product${filtered.length === 1 ? "" : "s"}${category === "All products" ? " to light up your celebration" : ` in ${category.toLowerCase()}`}`;
  $("#no-results").hidden = filtered.length !== 0;
  $("#products").replaceChildren(...filtered.map(product => {
    const card = element("article", `product-card${cart[product.id] ? " in-cart" : ""}`);
    card.dataset.id = product.id;
    const art = element("div", `product-art art-${categories.indexOf(product.category) % 4}`);
    art.setAttribute("aria-hidden", "true");
    art.append(element("span", "product-number", `NO. ${String(product.id).padStart(2, "0")}`),
      productIllustration(product),
      element("span", "art-category", product.category));
    const body = element("div", "product-body");
    body.append(element("p", "product-brand", product.brand), element("h3", "", product.name),
      element("p", "product-unit", product.unit));
    const bottom = element("div", "product-bottom");
    const price = element("div", "product-price");
    price.append(element("strong", "", money(product.price)), element("span", "", "per selling unit"));
    bottom.append(price, quantityControl(product));
    body.append(bottom);
    card.append(art, body);
    return card;
  }));
}

function pricingSummary(withIds = false) {
  const amounts = pricing(cart);
  const summary = element("div", "pricing-summary");
  const rows = [
    ["Subtotal", money(amounts.subtotal), "pricing-row", "cart-subtotal"],
    [amounts.subtotal ? `Discount applied (${DISCOUNT_PERCENT}%)` : `Discount (${DISCOUNT_PERCENT}%)`,
      `\u2212${money(amounts.discount)}`, "pricing-row discount-row", "cart-discount"],
    ...(!withIds && $("#fulfilment-delivery").checked ?
      [["Home delivery charge", "FREE", "pricing-row discount-row", "delivery-charge"]] : []),
    ["Estimated total after discount", money(amounts.total), "cart-total", "cart-total"],
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
  $("#clear-cart").hidden = lines.length === 0;
  $("#mobile-cart").hidden = lines.length === 0;
  $("#mobile-cart-label").textContent = `${units} pack${units === 1 ? "" : "s"} \u00b7 ${money(total(cart))}`;
  if (!lines.length) {
    const empty = element("div", "cart-empty");
    empty.append(element("span", "", "\u2727"), element("h3", "", "Good things start with a list"),
      element("p", "", "Tap + on a product to add a little sparkle to yours."));
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
    remove.setAttribute("aria-label", `Remove ${line.name}, product ${line.id} from selection`);
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
    "Free home delivery to this address. The vendor will confirm service area and timing." :
    method === "pickup" ? "Your address will be shared with the vendor. You will collect the items from the shop." :
      "Your address and selected delivery or pickup option will be shared with the vendor.";
  $("#checkout-summary .pricing-summary")?.replaceWith(pricingSummary());
}

function showReview() {
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
    "Saving to order tracker..." : "Save requirement & prepare WhatsApp";
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
$("#clear-cart").addEventListener("click", () => {
  if (!window.confirm("Clear all products from your festive list?")) return;
  cart = {};
  saveCart();
  renderProducts();
  renderCart();
  $("#search").focus();
});
$("#customer-form").addEventListener("change", event => {
  if (event.target.name === "fulfilment") updateFulfilment();
});
$("#customer-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (saving) return;
  $("#form-error").hidden = true;
  try {
    const customer = validateCustomer(Object.fromEntries(new FormData(event.currentTarget)));
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
        body: JSON.stringify({ requestId: submission.requestId, cart: selection, customer, consent: true }),
        signal: AbortSignal.timeout(25000),
      });
    } catch {
      throw new Error("We could not confirm saving your requirement. Keep this review open and retry with the same details to avoid duplicate records.");
    }
    if (response.status === 429) throw new Error("Too many submissions. Wait a minute, then retry with this review open.");
    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error("The order tracker returned an unreadable response. Keep this review open and retry, or contact the shop.");
    }
    if (!response.ok) throw new Error(typeof result?.error === "string" ? result.error :
      "We could not confirm saving your requirement. Keep this review open and retry.");
    const orderId = `SBC-${submission.requestId.toUpperCase()}`;
    if (result?.orderId !== orderId || typeof result.message !== "string" ||
        !result.message.startsWith(`Order ID: ${orderId}\n`) || result.message.length > 65536) {
      throw new Error("The order tracker did not confirm the expected reference. Keep this review open and retry.");
    }
    fullMessage = result.message;
    const messages = prepareMessages(fullMessage);
    $("#full-message").value = fullMessage;
    $("#order-reference").textContent = `Recorded in the vendor's order sheet. Reference: ${orderId}`;
    $("#recipient").textContent = `${vendor.name} \u00b7 ${vendor.phone}`;
    $("#handoff-instructions").textContent = messages.length === 1 ?
      "Open the chat below, then press Send in WhatsApp. The vendor will confirm your requirement." :
      `Your list needs ${messages.length} messages to keep links manageable. Open and SEND EACH numbered part in order. All products and details are included across the parts. You can also copy or download the complete requirement below.`;
    $("#message-links").replaceChildren(...messages.map((message, index) => {
      const link = element("a", "button primary wide", messages.length === 1 ?
        "Open WhatsApp chat \u2197" : `Open WhatsApp \u00b7 part ${index + 1} of ${messages.length} \u2197`);
      link.href = message.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      return link;
    }));
    $("#customer-form").hidden = true;
    $("#message-preview").hidden = false;
    $("#copy-status").textContent = "";
    $("#message-title").tabIndex = -1;
    $("#message-title").focus();
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
    $("#copy-status").textContent = "Copied. Paste the complete requirement into the vendor's WhatsApp chat, then press Send.";
  } catch {
    $("#copy-status").textContent = "Clipboard access is unavailable. Select and copy the message below manually.";
    $("#full-message").focus();
    $("#full-message").select();
  }
});
$("#download-message").addEventListener("click", () => {
  const url = URL.createObjectURL(new Blob([fullMessage], { type: "text/plain;charset=utf-8" }));
  const link = element("a");
  link.href = url;
  link.download = `sai-baba-requirement-${localDate()}.txt`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
window.addEventListener("storage", event => {
  if (event.key !== CART_KEY && event.key !== null) return;
  if ($("#checkout").open) {
    showStorageWarning("The saved selection changed in another tab. This tab keeps its current review; check your list before sending.");
    return;
  }
  try {
    cart = event.newValue ? sanitizeCart(JSON.parse(event.newValue)) : {};
    renderProducts();
    renderCart();
  } catch {
    showStorageWarning("Another tab saved an invalid selection. This tab has kept your current list.", true);
  }
});
renderCategories();
renderProducts();
renderCart();
