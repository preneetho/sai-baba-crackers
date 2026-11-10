import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { vendor, products } from "../vendor-app/catalog.mjs";
import { validCatalogue } from "../vendor-app/catalogue-model.mjs";
import { mediaUrl, isYouTubeMedia } from "../vendor-app/media-model.mjs";
import * as order from "../vendor-app/order.mjs";

const tick = () => new Promise(resolve => setImmediate(resolve));
async function harness({ stored, unavailableStorage = false, price = 70 } = {}) {
  class Node {
    constructor(tag = "div") { this.tagName = tag.toUpperCase(); this.children = []; this.events = new Map(); this.dataset = {}; this.value = ""; this.attributes = {}; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    addEventListener(type, callback) { this.events.set(type, callback); }
    setAttribute(key, value) { this.attributes[key] = value; }
    getAttribute(key) { return this.attributes[key]; }
    removeAttribute(key) { delete this.attributes[key]; delete this[key]; }
    focus() { this.focused = true; }
    click() {}
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
      "prepareOrderMessage", "validatePdfLink"].map(key => [key, order[key]])),
    checkCart: order.sanitizeCart, getLines: order.cartLines, getPricing: order.pricing, getTotal: order.total,
    vendor, validCatalogue, mediaUrl, isYouTubeMedia, track() {}, URL, AbortSignal, console, Intl,
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
  assert.equal(cover.children.filter(child => child.className?.includes("media-cover-icon")).length, 2);
  assert.equal(cover.children[1].getAttribute("aria-hidden"), "true");
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
  assert.equal(cover.children.filter(child => child.className?.includes("media-cover-icon")).length, 2);
});

test("photo-only covers have one expand icon without a video badge or caption", async () => {
  const ui = await harness();
  const photo = { cloudName: "synthetic-cloud", publicId: "sai-baba-crackers/products/00000000-0000-4000-8000-000000000001",
    resourceType: "image", version: 1234567890, format: "jpg", bytes: 1000, width: 640, height: 480,
    duration: 0, alt: "Synthetic photo", credit: "" };
  ui.respond(async () => Response.json({ year: 2026, revision: 1, products: [{ ...products[0], media: [photo] }] }));
  await ui.emit("#reload-catalogue", "click");
  const cover = ui.get("#products").children[0].children[0];
  assert.equal(cover.children.length, 2);
  assert.equal(cover.children[1].className, "media-cover-icon media-cover-expand");
});

test("YouTube galleries require explicit loading, retain fallback links and unload frames on retry, navigation and close", async () => {
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
  assert.equal(cover.children.at(-1).className, "media-cover-icon media-cover-play");
  await cover.events.get("click")();
  let stage = ui.get("#product-media-stage").children[0];
  assert.deepEqual(stage.children.map(node => node.tagName), ["IMG", "BUTTON", "A"]);
  assert.match(ui.get("#product-media-credit").textContent, /<script>safe text only<\/script>/);
  stage.children[0].events.get("error")();
  assert.equal(stage.children[0].hidden, true);
  await stage.children[1].events.get("click")();
  let frame = stage.children[0];
  assert.equal(frame.tagName, "IFRAME");
  assert.equal(frame.src, mediaUrl(youtube, "play"));
  assert.equal(frame.autoplay, undefined);
  assert.equal(frame.allow.includes("autoplay"), false);
  assert.equal(frame.allowFullscreen, true);
  assert.equal(frame.referrerPolicy, "strict-origin-when-cross-origin");
  assert.match(frame.title, /Illustrative YouTube video/);
  assert.equal(frame.focused, true);
  const link = stage.children[1];
  assert.equal(link.href, mediaUrl(youtube, "watch"));
  assert.equal(link.target, "_blank");
  assert.equal(link.rel, "noopener noreferrer");
  frame.events.get("error")();
  assert.match(ui.get("#product-media-status").textContent, /could not load.*Watch on YouTube/);
  await ui.emit("#retry-product-media", "click");
  assert.equal(frame.src, undefined);
  stage = ui.get("#product-media-stage").children[0];
  await stage.children[1].events.get("click")();
  frame = stage.children[0];
  await ui.emit("#next-product-media", "click");
  assert.equal(frame.src, undefined);
  assert.equal(ui.get("#product-media-stage").children[0].tagName, "IMG");
  frame.events.get("load")();
  assert.equal(ui.get("#product-media-status").textContent, "Loading photo...");
  await ui.emit("#previous-product-media", "click");
  stage = ui.get("#product-media-stage").children[0];
  await stage.children[1].events.get("click")();
  frame = stage.children[0];
  await ui.emit("#product-media-dialog", "close");
  assert.equal(frame.src, undefined);
  assert.equal(ui.get("#product-media-stage").children.length, 0);
  ui.run("updateQuantity(1, 1, false)");
  assert.equal(ui.run("cart[1]"), 1);
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

test("checkout submits catalogue metadata and server returns the authoritative WhatsApp message", async () => {
  const ui = await harness();
  ui.run("updateQuantity(1, 1, false)");
  ui.respond(async (path, options) => {
    assert.equal(path, "/api/orders");
    const body = JSON.parse(options.body);
    assert.deepEqual(body.catalogue, { year: 2026, revision: 1 });
    assert.deepEqual(body.cart, { 1: 1 });
    return new Response(JSON.stringify({
      orderId: `SBC-${body.requestId.toUpperCase()}`,
      message: `Order ID: SBC-${body.requestId.toUpperCase()}\nSynthetic saved message from server.`,
    }));
  });
  await ui.emit("#customer-form", "submit");
  assert.match(ui.get("#full-message").value, /Synthetic saved message from server/);
  assert.equal(ui.get("#message-preview").hidden, false);
  assert.equal(ui.get("#customer-form").hidden, true);
});

test("large yearly catalogues retain the full request and use a single PDF summary in WhatsApp", async () => {
  const ui = await harness();
  ui.run("updateQuantity(1, 1, false)");
  const id = "SBC-00000000-0000-4000-8000-000000000001";
  const pdf = { url: `https://vendor.example/api/order-pdf?token=20261116.${"a".repeat(43)}`,
    expiresAt: "2026-11-16T00:00:00.000Z" };
  const message = `Order ID: ${id}\n${"Synthetic long product details. ".repeat(2500)}`;
  assert.ok(message.length > 65536);
  ui.respond(async () => new Response(JSON.stringify({
    orderId: id, message, summary: `Order ID: ${id}\nComplete request: ${pdf.url}`, pdf,
  })));
  await ui.emit("#customer-form", "submit");
  assert.equal(ui.get("#full-message").value, message);
  assert.equal(ui.get("#message-preview").hidden, false);
  assert.equal(ui.get("#pdf-link").href, pdf.url);
  assert.equal(ui.get("#whatsapp-message").value.includes(pdf.url), true);
});
