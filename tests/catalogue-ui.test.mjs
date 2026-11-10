import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { vendor, products } from "../vendor-app/catalog.mjs";
import { validCatalogue } from "../vendor-app/catalogue-model.mjs";
import { mediaUrl, isYouTubeMedia } from "../vendor-app/media-model.mjs";
import * as order from "../vendor-app/order.mjs";

const tick = () => new Promise(resolve => setImmediate(resolve));
async function harness({ stored, unavailableStorage = false, price = 70, navigator = {} } = {}) {
  class Node {
    constructor(tag = "div") { this.tagName = tag.toUpperCase(); this.children = []; this.events = new Map(); this.dataset = {}; this.value = ""; this.attributes = {}; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    addEventListener(type, callback) { this.events.set(type, callback); }
    setAttribute(key, value) { this.attributes[key] = value; }
    getAttribute(key) { return this.attributes[key]; }
    removeAttribute(key) { delete this.attributes[key]; delete this[key]; }
    focus() { this.focused = true; }
    click() { this.clicks = (this.clicks ?? 0) + 1; }
    select() { this.selected = true; }
    replaceWith() {}
    reset() {}
    showModal() { this.open = true; }
    close() { this.open = false; }
  }
  const nodes = new Map();
  const get = selector => {
    if (!nodes.has(selector)) nodes.set(selector, new Node());
    return nodes.get(selector);
  };
  get("#customer-form").elements = Object.assign([], { fulfilment: { value: "pickup" } });
  const storage = new Map(stored ? [[order.CART_KEY, JSON.stringify(stored)]] : []);
  const events = new Map();
  const requests = [];
  let respond = async () => new Response(JSON.stringify({
    year: 2026, revision: 1, products: [{ ...products[0], price }],
  }));
  const context = vm.createContext({
    ...Object.fromEntries(["CART_KEY", "MAX_QUANTITY", "DISCOUNT_PERCENT", "money", "localDate", "validateCustomer",
      "prepareOrderMessage", "validateOrderShareLink"].map(key => [key, order[key]])),
    checkCart: order.sanitizeCart, getLines: order.cartLines, getPricing: order.pricing, getTotal: order.total,
    vendor, validCatalogue, mediaUrl, isYouTubeMedia, track() {}, URL, AbortSignal, console, Intl, navigator,
    setTimeout, clearTimeout, crypto: { randomUUID: () => "00000000-0000-4000-8000-000000000001" },
    FormData: class {
      *[Symbol.iterator]() {
        yield* Object.entries({ name: "Synthetic Customer", phone: "9876543210", address: "Synthetic address only",
          fulfilment: "pickup", notes: "", preferredDate: "" });
      }
    },
    document: {
      querySelector: get, createElement: tag => new Node(tag), createElementNS: (namespace, tag) => new Node(tag),
      createTextNode: text => ({ textContent: text }),
      querySelectorAll: selector => selector === "#clear-cart, #clear-cart-top" ? [get("#clear-cart"), get("#clear-cart-top")] :
        selector === "[data-catalogue-year]" ? [get("year-label")] : [],
    },
    localStorage: {
      getItem(key) { if (unavailableStorage) throw new Error("Storage blocked"); return storage.get(key); },
      setItem(key, value) { if (unavailableStorage) throw new Error("Storage blocked"); storage.set(key, value); },
      removeItem(key) { storage.delete(key); },
    },
    window: { location: { origin: "https://vendor.example" }, confirm: () => true,
      addEventListener: (type, callback) => events.set(type, callback) },
    fetch: async (path, options) => { requests.push({ path, ...options }); return respond(path, options); },
  });
  const source = await readFile(new URL("../vendor-app/app.mjs", import.meta.url), "utf8");
  vm.runInContext(source.replace(/^import .*;\r?\n/gm, ""), context);
  await tick();
  return {
    get, storage, requests, events, context, run: source => vm.runInContext(source, context),
    respond(callback) { respond = callback; },
    async emit(selector, type) { await get(selector).events.get(type)({ preventDefault() {}, currentTarget: get(selector) }); await tick(); },
  };
}

test("customer catalogue is loaded dynamically and saved carts are bound to its year and revision", async () => {
  const ui = await harness({ stored: { year: 2026, revision: 1, cart: { 1: 2 } }, price: 99.95 });
  assert.equal(ui.get("#products").children.length, 1);
  assert.equal(ui.get("#review").disabled, false);
  assert.equal(ui.get("year-label").textContent, 2026);
  assert.equal(ui.run("total(cart)"), 169.91);
  ui.run("updateQuantity(1, 1, false)");
  assert.deepEqual(JSON.parse(ui.storage.get(order.CART_KEY)), { year: 2026, revision: 1, cart: { 1: 3 } });
  ui.respond(async () => new Response(JSON.stringify({ year: 2027, revision: 2, products: [products[0]] })));
  await ui.emit("#reload-catalogue", "click");
  assert.equal(ui.get("#review").disabled, true);
  assert.match(ui.get("#storage-warning").children[0].textContent, /year or prices changed/);
  assert.equal(ui.get("year-label").textContent, 2027);
});

test("customer media covers and gallery preserve cart controls, render credits safely, retry failures and stop video", async () => {
  const ui = await harness();
  const photo = { cloudName: "synthetic-cloud", publicId: "sai-baba-crackers/products/00000000-0000-4000-8000-000000000001",
    resourceType: "image", version: 1234567890, format: "jpg", bytes: 1000, width: 640, height: 480,
    duration: 0, alt: "Illustrative example, not exact brand", credit: "<script>not executable</script> CC BY test credit" };
  const video = { ...photo, publicId: photo.publicId.slice(0, -1) + "2", resourceType: "video", duration: 30, format: "mp4" };
  ui.respond(async () => Response.json({ year: 2026, revision: 1, products: [{ ...products[0], media: [photo, video] }] }));
  await ui.emit("#reload-catalogue", "click");
  const cover = ui.get("#products").children[0].children[0];
  assert.equal(cover.children[0].loading, "lazy");
  assert.match(cover.children[0].src, /w_640/);
  assert.match(cover.getAttribute("aria-label"), /View photos and videos for/);
  assert.equal(cover.getAttribute("aria-haspopup"), "dialog");
  assert.equal(cover.children.some(child => child.className === "media-cover-caption"), false);
  assert.equal(cover.children.filter(child => child.className?.includes("media-cover-icon")).length, 1);
  assert.equal(cover.children[1].getAttribute("aria-hidden"), "true");
  assert.equal(cover.children.find(child => child.className === "product-number").textContent, "NO. 01");
  assert.match(cover.getAttribute("aria-label"), /product 1$/);
  await cover.events.get("click")();
  assert.equal(ui.get("#product-media-dialog").open, true);
  assert.equal(ui.get("#product-media-credit").textContent, `Credit / license: ${photo.credit}`);
  assert.equal(ui.get("#product-media-description").textContent, photo.alt);
  const image = ui.get("#product-media-stage").children[0];
  assert.match(image.src, /w_1600/);
  image.events.get("error")();
  assert.equal(ui.get("#retry-product-media").hidden, false);
  await ui.emit("#retry-product-media", "click");
  assert.equal(ui.get("#retry-product-media").hidden, true);
  await ui.emit("#next-product-media", "click");
  const player = ui.get("#product-media-stage").children[0];
  assert.equal(player.preload, "none");
  assert.equal(player.controls, true);
  assert.equal(player.autoplay, undefined);
  assert.match(player.src, /f_mp4/);
  assert.match(player.poster, /\.jpg$/);
  let paused = 0;
  let unloaded = 0;
  player.pause = () => paused++;
  player.load = () => unloaded++;
  await ui.emit("#product-media-dialog", "close");
  assert.equal(paused, 1);
  assert.equal(unloaded, 1);
  assert.equal(ui.get("#product-media-stage").children.length, 0);
  ui.run("updateQuantity(1, 1, false)");
  assert.equal(ui.run("cart[1]"), 1);
  cover.children[0].events.get("error")();
  assert.match(cover.children.find(child => child.className === "media-cover-error").textContent, /Preview unavailable/);
  assert.match(cover.getAttribute("aria-label"), /Preview unavailable.*View photos/);
  assert.equal(cover.children.filter(child => child.className?.includes("media-cover-icon")).length, 1);
  assert.equal(cover.children.find(child => child.className === "product-number").textContent, "NO. 01");
});

test("photo-only covers have one expand icon without a video badge or caption", async () => {
  const ui = await harness();
  const photo = { cloudName: "synthetic-cloud", publicId: "sai-baba-crackers/products/00000000-0000-4000-8000-000000000001",
    resourceType: "image", version: 1234567890, format: "jpg", bytes: 1000, width: 640, height: 480,
    duration: 0, alt: "Synthetic photo", credit: "" };
  ui.respond(async () => Response.json({ year: 2026, revision: 1, products: [{ ...products[0], media: [photo] }] }));
  await ui.emit("#reload-catalogue", "click");
  const cover = ui.get("#products").children[0].children[0];
  assert.equal(cover.children.length, 3);
  assert.equal(cover.children[1].className, "media-cover-icon media-cover-expand");
  assert.equal(cover.children[2].textContent, "NO. 01");
});

test("YouTube galleries load players on opening without autoplay and unload frames on retry, navigation and close", async () => {
  const ui = await harness();
  const youtube = { provider: "youtube", resourceType: "video", videoId: "M7lc1UVf-VE",
    alt: "Illustrative YouTube video", credit: "<script>safe text only</script>" };
  const photo = { cloudName: "synthetic-cloud", publicId: "sai-baba-crackers/products/00000000-0000-4000-8000-000000000001",
    resourceType: "image", version: 1234567890, format: "jpg", bytes: 1000, width: 640, height: 480,
    duration: 0, alt: "Synthetic photo", credit: "" };
  ui.respond(async () => Response.json({ year: 2026, revision: 1, products: [{ ...products[0], media: [youtube, photo] }] }));
  await ui.emit("#reload-catalogue", "click");
  const cover = ui.get("#products").children[0].children[0];
  assert.equal(cover.children[0].src, mediaUrl(youtube));
  assert.equal(cover.children[1].className, "media-cover-icon media-cover-expand");
  assert.equal(cover.children.length, 3);
  assert.equal(cover.children.at(-1).textContent, "NO. 01");
  assert.equal(ui.run("galleryFrame"), null);
  await cover.events.get("click")();
  let stage = ui.get("#product-media-stage").children[0];
  assert.deepEqual(stage.children.map(node => node.tagName), ["IFRAME", "A"]);
  assert.match(ui.get("#product-media-credit").textContent, /<script>safe text only<\/script>/);
  assert.equal(ui.get("#product-media-status").textContent, "Loading YouTube player...");
  assert.equal(ui.get("#retry-product-media").hidden, true);
  let frame = stage.children[0];
  assert.equal(frame.tagName, "IFRAME");
  assert.equal(frame.src, mediaUrl(youtube, "play"));
  assert.equal(frame.autoplay, undefined);
  assert.equal(frame.allow.includes("autoplay"), false);
  assert.equal(frame.allowFullscreen, true);
  assert.equal(frame.referrerPolicy, "strict-origin-when-cross-origin");
  assert.match(frame.title, /Illustrative YouTube video/);
  assert.equal(frame.focused, undefined);
  frame.events.get("load")();
  assert.equal(ui.get("#product-media-status").textContent, "Press play to watch.");
  const link = stage.children[1];
  assert.equal(link.textContent, "Watch on YouTube (new tab)");
  assert.equal(link.href, mediaUrl(youtube, "watch"));
  assert.equal(link.target, "_blank");
  assert.equal(link.rel, "noopener noreferrer");
  frame.events.get("error")();
  assert.match(ui.get("#product-media-status").textContent, /could not load.*Watch on YouTube/);
  assert.equal(ui.get("#retry-product-media").hidden, false);
  await ui.emit("#retry-product-media", "click");
  assert.equal(frame.src, undefined);
  stage = ui.get("#product-media-stage").children[0];
  assert.notEqual(stage.children[0], frame);
  assert.equal(stage.children[0].src, mediaUrl(youtube, "play"));
  assert.equal(ui.get("#retry-product-media").hidden, true);
  frame = stage.children[0];
  await ui.emit("#next-product-media", "click");
  assert.equal(frame.src, undefined);
  assert.equal(ui.get("#product-media-stage").children[0].tagName, "IMG");
  frame.events.get("load")();
  frame.events.get("error")();
  assert.equal(ui.get("#product-media-status").textContent, "Loading photo...");
  assert.equal(ui.get("#retry-product-media").hidden, true);
  await ui.emit("#previous-product-media", "click");
  stage = ui.get("#product-media-stage").children[0];
  frame = stage.children[0];
  assert.equal(frame.src, mediaUrl(youtube, "play"));
  await ui.emit("#product-media-dialog", "close");
  assert.equal(frame.src, undefined);
  frame.events.get("error")();
  assert.equal(ui.get("#retry-product-media").hidden, true);
  assert.equal(ui.get("#product-media-stage").children.length, 0);
  ui.run("updateQuantity(1, 1, false)");
  assert.equal(ui.run("cart[1]"), 1);
});

test("product numbers remain stable on photo, uploaded-video, YouTube and icon covers after filtering and quantity changes", async () => {
  const ui = await harness();
  const photo = { cloudName: "synthetic-cloud", publicId: "sai-baba-crackers/products/00000000-0000-4000-8000-000000000001",
    resourceType: "image", version: 1234567890, format: "jpg", bytes: 1000, width: 640, height: 480,
    duration: 0, alt: "Synthetic photo", credit: "" };
  const video = { ...photo, resourceType: "video", duration: 10, format: "mp4" };
  const youtube = { provider: "youtube", resourceType: "video", videoId: "M7lc1UVf-VE", alt: "Synthetic video", credit: "" };
  const rows = [photo, video, youtube, null].map((asset, index) => ({
    ...products[0], id: index === 3 ? 999999 : index + 10, ...(asset ? { media: [asset] } : {}),
  }));
  ui.respond(async () => Response.json({ year: 2026, revision: 1, products: rows }));
  await ui.emit("#reload-catalogue", "click");
  for (const [index, card] of ui.get("#products").children.entries()) {
    const cover = card.children[0];
    const badge = cover.children.find(node => node.className === "product-number");
    assert.ok(badge);
    assert.equal(cover.children.filter(node => node.className === "product-number").length, 1);
    assert.equal(badge.textContent, `NO. ${rows[index].id}`);
    if (index < 3) {
      assert.equal(cover.children.some(node => node.className?.includes("media-cover-play")), false);
      assert.equal(cover.children.filter(node => node.className?.includes("media-cover-icon")).length, 1);
      cover.children[0].events.get("error")();
      assert.equal(cover.children.find(node => node.className === "product-number"), badge);
      assert.equal(cover.children.some(node => node.className?.includes("media-cover-play")), false);
      assert.equal(cover.children.filter(node => node.className?.includes("media-cover-icon")).length, 1);
    }
  }
  ui.run("query = '11'; renderProducts(); updateQuantity(11, 1, false)");
  assert.equal(ui.get("#products").children.length, 1);
  assert.equal(ui.get("#products").children[0].children[0].children.at(-1).textContent, "NO. 11");
});

test("all product numbers share the original plain top-left label styling without media badges", async () => {
  const css = await readFile(new URL("../vendor-app/styles.css", import.meta.url), "utf8");
  const label = css.match(/\.product-number\s*\{([^}]+)\}/)?.[1];
  assert.ok(label);
  assert.match(label, /top:\s*12px/);
  assert.match(label, /left:\s*12px/);
  assert.match(label, /font-size:\s*8px/);
  assert.match(label, /letter-spacing:\s*1\.4px/);
  assert.match(label, /color:\s*var\(--muted\)/);
  assert.doesNotMatch(label, /(?:border|background|padding)\s*:/);
  assert.doesNotMatch(css, /\.media-cover-number/);
  assert.doesNotMatch(css, /\.media-cover-play/);
  const html = await readFile(new URL("../vendor-app/index.html", import.meta.url), "utf8");
  assert.doesNotMatch(html, /id="media-icon-play"/);
});

test("an empty public catalogue is a valid out-of-stock state, and products can reappear when restocked", async () => {
  const ui = await harness();
  ui.run("updateQuantity(1, 2, false)");
  ui.respond(async () => Response.json({ year: 2026, revision: 2, products: [] }));
  await ui.emit("#reload-catalogue", "click");
  assert.equal(ui.get("#products").children.length, 0);
  assert.equal(ui.get("#review").disabled, true);
  assert.equal(ui.get("#no-results").hidden, false);
  assert.equal(ui.get("#no-results-title").textContent, "No products currently available");
  assert.equal(ui.get("#no-results-message").textContent, "Please check back later or contact the shop.");
  assert.equal(ui.get("#reset-filters").hidden, true);
  assert.match(ui.get("#catalogue-status").textContent, /2026 price list loaded/);
  assert.equal(ui.run("Object.keys(cart).length"), 0);
  ui.respond(async () => Response.json({ year: 2026, revision: 3, products: [products[0]] }));
  await ui.emit("#reload-catalogue", "click");
  assert.equal(ui.get("#products").children.length, 1);
  assert.equal(ui.get("#no-results").hidden, true);
  assert.equal(ui.get("#reset-filters").hidden, false);
  ui.run("query = 'not-a-product'; renderProducts()");
  assert.equal(ui.get("#no-results-title").textContent, "No products found");
  assert.equal(ui.get("#no-results").hidden, false);
});

test("customer rendering also excludes explicitly hidden products if they reach a catalogue response", async () => {
  const ui = await harness();
  ui.respond(async () => Response.json({ year: 2026, revision: 2,
    products: [{ ...products[0], hidden: true }, products[1]] }));
  await ui.emit("#reload-catalogue", "click");
  assert.equal(ui.get("#products").children.length, 1);
  assert.equal(ui.get("#products").children[0].dataset.id, products[1].id);
});

test("catalogue failures are explicit, block checkout, and allow retry without a static-price fallback", async () => {
  const ui = await harness();
  ui.run("updateQuantity(1, 1, false)");
  ui.respond(async () => new Response(JSON.stringify({ error: "Synthetic database outage" }), { status: 503 }));
  await ui.emit("#reload-catalogue", "click");
  assert.equal(ui.get("#review").disabled, true);
  assert.equal(ui.get("#products").children.length, 0);
  assert.match(ui.get("#catalogue-status").textContent, /Synthetic database outage/);
  assert.equal(ui.get("#reload-catalogue").disabled, false);
  ui.respond(async () => new Response(JSON.stringify({ year: 2026, revision: 1, products: [products[0]] })));
  await ui.emit("#reload-catalogue", "click");
  assert.equal(ui.run("cart[1]"), 1);
  assert.equal(ui.get("#review").disabled, false);
});

test("catalogue reload keeps in-memory selections even when browser storage is blocked", async () => {
  const ui = await harness({ unavailableStorage: true });
  ui.run("updateQuantity(1, 2, false)");
  await ui.emit("#reload-catalogue", "click");
  assert.equal(ui.run("cart[1]"), 2);
  assert.equal(ui.get("#review").disabled, false);
});

test("maximum order amount is checked before quantity changes mutate the cart", async () => {
  const ui = await harness({ price: 100000 });
  ui.run("updateQuantity(1, 99, false)");
  // A second maximum-price product would put the combined subtotal above PostgreSQL integer paise.
  ui.run("products.push({ ...products[0], id: 2 }); cart[2] = 99; products.push({ ...products[0], id: 3 })");
  ui.run("updateQuantity(3, 99, false)");
  assert.equal(ui.run("cart[3]"), undefined);
  assert.match(ui.get("#catalogue-status").textContent, /exceeds the supported request value/);
});

function submittedResult(overrides = {}) {
  const orderId = "SBC-00000000-0000-4000-8000-000000000001";
  const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
  const share = {
    orderId, expiresAt,
    url: `https://vendor.example/request/${expiresAt.slice(0, 10).replaceAll("-", "")}.${"a".repeat(43)}`,
  };
  return {
    orderId, share,
    message: `Order ID: ${orderId}\nSynthetic saved message from server.\n#1 Full product details.`,
    summary: `Order ID: ${orderId}\nCustomer: Synthetic Customer\nEstimated total: Rs.59.50\nFull order details: ${share.url}`,
    ...overrides,
  };
}

test("checkout submits catalogue metadata and link consent, and even a short order sends only name, amount and details link", async () => {
  const ui = await harness();
  ui.run("updateQuantity(1, 1, false)");
  ui.respond(async (path, options) => {
    assert.equal(path, "/api/orders");
    const body = JSON.parse(options.body);
    assert.deepEqual(body.catalogue, { year: 2026, revision: 1 });
    assert.deepEqual(body.cart, { 1: 1 });
    assert.equal(body.consent, true);
    assert.equal(body.shareConsent, true);
    assert.equal(body.pdfConsent, undefined);
    return Response.json(submittedResult());
  });
  await ui.emit("#customer-form", "submit");
  assert.match(ui.get("#full-message").value, /Synthetic saved message from server/);
  assert.equal(ui.get("#message-preview").hidden, false);
  assert.equal(ui.get("#customer-form").hidden, true);
  const links = ui.get("#message-links").children;
  assert.equal(links.length, 1);
  assert.equal(links[0].target, "_self");
  assert.match(links[0].href, /^https:\/\/wa\.me\//);
  assert.equal(links[0].clicks, 1);
  const text = new URL(links[0].href).searchParams.get("text");
  assert.match(text, /Customer: Synthetic Customer/);
  assert.match(text, /Estimated total: Rs\.59\.50/);
  assert.ok(text.includes(ui.get("#order-link").href));
  assert.doesNotMatch(text, /Full product details/);
  assert.equal(ui.get("#order-details").hidden, false);
  assert.match(ui.get("#order-expiry").textContent, /IST.*Anyone with the link/);
  assert.match(ui.get("#handoff-instructions").textContent, /name, estimated total, request ID and a link/);
});

test("large yearly catalogues retain the full request and use the same single web-link summary in WhatsApp", async () => {
  const ui = await harness();
  ui.run("updateQuantity(1, 1, false)");
  const id = "SBC-00000000-0000-4000-8000-000000000001";
  const message = `Order ID: ${id}\n${"Synthetic long product details. ".repeat(2500)}`;
  assert.ok(message.length > 65536);
  const result = submittedResult({ message });
  ui.respond(async () => Response.json(result));
  await ui.emit("#customer-form", "submit");
  assert.equal(ui.get("#full-message").value, message);
  assert.equal(ui.get("#message-preview").hidden, false);
  assert.equal(ui.get("#order-link").href, result.share.url);
  assert.equal(ui.get("#whatsapp-message").value, result.summary);
  assert.equal(ui.get("#message-links").children.length, 1);
  assert.equal(new URL(ui.get("#message-links").children[0].href).searchParams.get("text"), result.summary);
});

test("checkout never offers an unverified, missing or omitted-from-summary details link", async () => {
  const valid = submittedResult();
  for (const change of [
    { share: undefined }, { share: { ...valid.share, url: "https://elsewhere.example/request/private" } },
    { share: { ...valid.share, orderId: "another-order" } },
    { share: { ...valid.share, expiresAt: new Date(Date.now() - 1).toISOString() } },
    { summary: `Order ID: ${valid.orderId}\nNo details link.` }, { summary: undefined },
  ]) {
    const ui = await harness();
    ui.run("updateQuantity(1, 1, false)");
    ui.respond(async () => Response.json({ ...valid, ...change }));
    await ui.emit("#customer-form", "submit");
    assert.equal(ui.get("#form-error").hidden, false);
    assert.equal(ui.get("#message-links").children.length, 0);
    assert.notEqual(ui.get("#customer-form").hidden, true);
    assert.equal(ui.run("saving"), false);
  }
});

test("failed link preparation keeps the same request ID for retry before creating a WhatsApp handoff", async () => {
  const ui = await harness();
  ui.run("updateQuantity(1, 1, false)");
  const attempts = [];
  ui.respond(async (_, options) => {
    attempts.push(JSON.parse(options.body));
    return attempts.length === 1 ?
      Response.json({ error: "Your request is saved, but its details link could not be prepared. Retry." }, { status: 503 }) :
      Response.json(submittedResult());
  });
  await ui.emit("#customer-form", "submit");
  assert.match(ui.get("#form-error").textContent, /is saved.*details link/);
  assert.equal(ui.get("#message-links").children.length, 0);
  await ui.emit("#customer-form", "submit");
  assert.equal(attempts.length, 2);
  assert.equal(attempts[0].requestId, attempts[1].requestId);
  assert.equal(ui.get("#message-links").children.length, 1);
});

test("WhatsApp recovery copies the concise link summary without resubmitting and closing clears the detail URL", async () => {
  const copied = [];
  const ui = await harness({ navigator: { clipboard: { writeText: async text => copied.push(text) } } });
  ui.run("updateQuantity(1, 1, false)");
  const result = submittedResult();
  ui.respond(async () => Response.json(result));
  await ui.emit("#customer-form", "submit");
  const count = ui.requests.length;
  await ui.emit("#copy-whatsapp-message", "click");
  assert.deepEqual(copied, [result.summary]);
  assert.equal(ui.requests.length, count);
  const chat = new URL(ui.get("#open-shop-chat").href);
  assert.equal(chat.pathname, `/${vendor.whatsapp}`);
  assert.equal(chat.search, "");
  await ui.emit("#checkout", "close");
  assert.equal(ui.get("#order-details").hidden, true);
  assert.equal(ui.get("#order-link").href, undefined);
  assert.equal(ui.get("#order-expiry").textContent, "");
  assert.equal(ui.get("#whatsapp-message").value, "");
});

test("blocked clipboard recovery selects the existing concise message with its detail link", async () => {
  const ui = await harness();
  ui.run("updateQuantity(1, 1, false)");
  const result = submittedResult();
  ui.respond(async () => Response.json(result));
  await ui.emit("#customer-form", "submit");
  await ui.emit("#copy-whatsapp-message", "click");
  assert.match(ui.get("#whatsapp-copy-status").textContent, /Clipboard access is unavailable/);
  assert.equal(ui.get("#whatsapp-message").selected, true);
  assert.equal(ui.get("#whatsapp-message").value, result.summary);
});
