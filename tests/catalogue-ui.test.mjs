import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { vendor, products } from "../vendor-app/catalog.mjs";
import { validCatalogue, PRODUCT_TYPES } from "../vendor-app/catalogue-model.mjs";
import { mediaUrl, isYouTubeMedia } from "../vendor-app/media-model.mjs";
import * as order from "../vendor-app/order.mjs";
import * as offers from "../vendor-app/offers-model.mjs";
import { renderOfferWidgets } from "../vendor-app/offer-widgets.mjs";

const tick = () => new Promise(resolve => setImmediate(resolve));
const text = node => (node.textContent ?? "") + node.children.map(text).join(" ");
async function harness({ stored, unavailableStorage = false, price = 70, navigator = {} } = {}) {
  let document;
  class Node {
    constructor(tag = "div") { this.ownerDocument = document; this.tagName = tag.toUpperCase(); this.children = []; this.events = new Map(); this.dataset = {}; this.value = ""; this.attributes = {}; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    addEventListener(type, callback) { this.events.set(type, callback); }
    setAttribute(key, value) { this.attributes[key] = value; }
    getAttribute(key) { return this.attributes[key]; }
    removeAttribute(key) { delete this.attributes[key]; delete this[key]; }
    focus() { this.focused = true; }
    scrollIntoView() { this.scrolled = true; }
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
  let offerResponse = async (path, options) => options?.method === "POST" ?
    Response.json({ error: "This coupon is invalid or no longer active." }, { status: 400 }) :
    Response.json({ offers: offers.DEFAULT_OFFERS, version: null });
  let respond = async () => new Response(JSON.stringify({
    year: 2026, revision: 1, products: [{ ...products[0], price }],
  }));
  const context = vm.createContext({
    customerAuthorization: async () => ({ headers: {}, isTest: false }),
    ...offers,
    renderOfferWidgets, initializeOfferCarousel: () => () => {},
    ...Object.fromEntries(["CART_KEY", "MAX_QUANTITY", "money", "localDate", "validateCustomer",
      "prepareOrderMessage", "validateOrderShareLink"].map(key => [key, order[key]])),
    checkCart: order.sanitizeCart, getLines: order.cartLines, getPricing: order.pricing, getTotal: order.total,
    vendor, validCatalogue, PRODUCT_TYPES, mediaUrl, isYouTubeMedia, track() {}, URL, AbortSignal, console, Intl, navigator,
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
    fetch: async (path, options) => {
      requests.push({ path, ...options });
      if (path === "/api/offers") return offerResponse(path, options);
      return respond(path, options);
    },
  });
  document = context.document;
  document.defaultView = { navigator };
  const source = await readFile(new URL("../vendor-app/app.mjs", import.meta.url), "utf8");
  vm.runInContext(source.replace(/^import .*;\r?\n/gm, ""), context);
  await tick();
  return {
    get, storage, requests, events, context, run: source => vm.runInContext(source, context),
    respond(callback) { respond = callback; },
    respondOffers(callback) { offerResponse = callback; },
    async emit(selector, type) { await get(selector).events.get(type)({ preventDefault() {}, target: get(selector), currentTarget: get(selector) }); await tick(); },
  };
}

test("cart coupon apply/remove updates post-discount delivery progress and pickup/delivery totals", async () => {
  const ui = await harness();
  ui.run(`offers = { coupons: [{ code: "SALE15", percent: 15, enabled: true }], freeDeliveryMinimum: 2500, deliveryFee: 100 }`);
  ui.run("updateQuantity(1, 2, false)");
  ui.get("#coupon-code").value = "invalid";
  await ui.emit("#coupon-form", "submit");
  assert.match(ui.get("#coupon-status").textContent, /invalid/);
  assert.equal(ui.run("total(cart)"), 140);
  ui.get("#coupon-code").value = "sale15";
  await ui.emit("#coupon-form", "submit");
  assert.equal(ui.run("total(cart)"), 119);
  assert.equal(ui.get("#cart-total").textContent, order.money(119));
  assert.equal(ui.get("#cart-details-label").textContent, "Coupon SALE15 (15%)");
  assert.equal(ui.get("#cart-savings").textContent, `Save ${order.money(21)}`);
  assert.ok(ui.get("#cart-pricing").children[0].children.every(row => row.className !== "cart-total"));
  assert.match(ui.get("#delivery-progress-text").textContent, /2,381/);
  ui.get("#fulfilment-delivery").checked = true;
  ui.get("#customer-form").elements.fulfilment.value = "delivery";
  ui.run("updateFulfilment()");
  assert.equal(ui.get("#checkout-total").textContent, order.money(219));
  ui.get("#fulfilment-delivery").checked = false;
  ui.get("#customer-form").elements.fulfilment.value = "pickup";
  ui.run("updateFulfilment()");
  assert.equal(ui.get("#checkout-total").textContent, order.money(119));
  await ui.emit("#remove-coupon", "click");
  assert.equal(ui.run("total(cart)"), 140);
  assert.equal(ui.run("couponCode"), "");
  assert.equal(ui.get("#cart-total").textContent, order.money(140));
  assert.equal(ui.get("#cart-details-label").textContent, "Coupon & price details");
  assert.equal(ui.get("#cart-savings").textContent, "");
});

test("cart keeps total and Continue outside the initially collapsed coupon and price details", async () => {
  const html = await readFile(new URL("../vendor-app/order/index.html", import.meta.url), "utf8");
  const details = html.match(/<details id="cart-details"[\s\S]*?<\/details>/)?.[0];
  assert.ok(details);
  assert.doesNotMatch(details.split(">")[0], /\bopen\b/);
  assert.match(details, /id="coupon-form"/);
  assert.match(details, /id="coupon-status"/);
  assert.match(details, /id="cart-pricing"/);
  assert.doesNotMatch(details, /id="cart-total"|id="review"|id="delivery-progress-text"/);
  assert.match(html, /<\/details>\s*<div class="cart-total">/);
});

test("unlisted coupons are verified on entry, survive offer reloads and stop applying when disabled", async () => {
  const ui = await harness();
  const coupon = { code: "FRIENDS20", percent: 20, enabled: true, showOnWebsite: false };
  let enabled = true;
  const settings = { offers: { coupons: [], freeDeliveryMinimum: 2500, deliveryFee: 100 }, version: "version-1" };
  ui.respondOffers(async (path, options) => {
    if (options?.method !== "POST") return Response.json(settings);
    assert.deepEqual(JSON.parse(options.body), { code: "FRIENDS20", version: "version-1" });
    return enabled ? Response.json({ coupon, version: settings.version }) :
      Response.json({ error: "This coupon is invalid or no longer active." }, { status: 400 });
  });
  await ui.emit("#reload-offers", "click");
  ui.run("updateQuantity(1, 2, false)");
  ui.get("#coupon-code").value = "friends20";
  const applying = ui.emit("#coupon-form", "submit");
  assert.equal(ui.get("#review").disabled, true);
  assert.equal(ui.get("#apply-coupon").disabled, true);
  await applying;
  assert.equal(ui.run("total(cart)"), 112);
  assert.equal(ui.run("couponCode"), "FRIENDS20");
  assert.equal(ui.get("#shop-offers-ribbon").hidden, false);
  assert.equal(ui.get("#shop-offers").children.length, 1, "The delivery card stays visible without advertised coupons");
  assert.doesNotMatch(text(ui.get("#shop-offers")), /FRIENDS20/);
  await ui.emit("#reload-offers", "click");
  assert.equal(ui.run("total(cart)"), 112);
  assert.equal(ui.get("#shop-offers-ribbon").hidden, false);
  enabled = false;
  await ui.emit("#reload-offers", "click");
  assert.equal(ui.run("couponCode"), "");
  assert.equal(ui.run("total(cart)"), 140);
  assert.match(ui.get("#coupon-status").textContent, /no longer active/);
});

test("shopping offer cards advertise only public coupons, copy their codes and disappear after a settings failure", async () => {
  let copied;
  const ui = await harness({ navigator: { clipboard: { async writeText(code) { copied = code; } } } });
  ui.respondOffers(async () => Response.json({
    offers: { coupons: [
      { code: "SALE15", percent: 15, enabled: true },
      { code: "FRIENDS20", percent: 20, enabled: true, showOnWebsite: false },
      { code: "OLD50", percent: 50, enabled: false },
    ], freeDeliveryMinimum: 2500, deliveryFee: 100 }, version: "version-1",
  }));
  await ui.emit("#reload-offers", "click");
  const cards = ui.get("#shop-offers").children;
  assert.equal(cards.length, 2);
  assert.match(text(cards[0]), /15% off.*SALE15/);
  assert.match(text(cards[1]), /Free delivery.*2,500.*after coupon discount.*100/);
  assert.doesNotMatch(text(ui.get("#shop-offers")), /FRIENDS20|OLD50/);
  await cards[0].children[1].events.get("click")();
  assert.equal(copied, "SALE15");
  assert.match(ui.get("#shop-coupon-copy-status").textContent, /SALE15 copied/);
  ui.respondOffers(async () => Response.json({ error: "Settings unavailable." }, { status: 503 }));
  await ui.emit("#reload-offers", "click");
  assert.equal(ui.get("#shop-offers-ribbon").hidden, true);
  assert.match(ui.get("#offer-status").textContent, /unavailable/);
  assert.equal(ui.get("#reload-offers").hidden, false);
});

test("changed offers during private coupon lookup block checkout until current rules are reloaded", async () => {
  const ui = await harness();
  ui.run("updateQuantity(1, 2, false)");
  ui.respondOffers(async () => Response.json({ error: "Offers changed. Reload offers.", offersChanged: true }, { status: 409 }));
  ui.get("#coupon-code").value = "FRIENDS20";
  await ui.emit("#coupon-form", "submit");
  assert.equal(ui.get("#review").disabled, true);
  assert.equal(ui.get("#reload-offers").hidden, false);
  assert.equal(ui.run("couponCode"), "");
  assert.match(ui.get("#offer-status").textContent, /changed/);
});

test("category tiles and type counts combine with search, sorting and clear filters without changing the cart", async () => {
  const ui = await harness();
  const rows = [
    { ...products[0], id: 1, category: "Sparklers", types: ["colour-light", "ground"], price: 100 },
    { ...products[0], id: 2, category: "Sparklers", types: ["ground"], price: 50 },
    { ...products[0], id: 3, category: "Crackers", types: ["sound"] },
    { ...products[0], id: 4, name: "Synthetic Rocket", category: "Rockets", types: ["sky", "colour-light"] },
    { ...products[0], id: 5, category: "Novelties" },
    { ...products[0], id: 6, category: "Hidden category", hidden: true, types: ["sky"] },
  ];
  ui.respond(async () => Response.json({ year: 2026, revision: 1, products: rows }));
  await ui.emit("#reload-catalogue", "click");
  assert.equal(ui.get("#catalogue-discovery").hidden, false);
  assert.equal(ui.get("#categories").children.length, 5);
  assert.deepEqual(ui.get("#product-types").children.map(node => node.textContent),
    ["All types (5)", "Sound (1)", "Sky (1)", "Colour & Light (2)", "Ground (2)"]);
  const category = name => ui.get("#categories").children.find(node => node.dataset.category === name);
  const type = id => ui.get("#product-types").children.find(node => node.dataset.type === id);
  await category("Sparklers").events.get("click")();
  assert.equal(category("Sparklers").getAttribute("aria-pressed"), "true");
  assert.equal(ui.get("#results-count").focused, true);
  assert.equal(ui.get("#results-count").scrolled, true);
  assert.equal(type("ground").textContent, "Ground (2)");
  assert.equal(type("sky").disabled, true);
  await type("ground").events.get("click")();
  ui.get("#sort").value = "low";
  await ui.emit("#sort", "change");
  assert.deepEqual(ui.get("#products").children.map(node => node.dataset.id), [2, 1]);
  await type("colour-light").events.get("click")();
  assert.deepEqual(ui.get("#products").children.map(node => node.dataset.id), [1]);
  assert.equal(type("colour-light").getAttribute("aria-pressed"), "true");
  assert.match(ui.get("#products").children[0].children[1].children.find(node => node.className === "product-type-labels").textContent,
    /Colour & Light.*Ground/);
  ui.run("updateQuantity(1, 2, false)");
  assert.equal(ui.run("total(cart)"), 200);
  ui.get("#search").value = "Synthetic Rocket";
  await ui.emit("#search", "input");
  assert.equal(ui.get("#products").children.length, 0);
  assert.equal(ui.get("#no-results").hidden, false);
  assert.equal(type("colour-light").disabled, false);
  assert.equal(ui.get("#clear-filters").hidden, false);
  await ui.emit("#reset-filters", "click");
  assert.equal(ui.get("#search").value, "");
  assert.equal(ui.get("#products").children.length, 5);
  assert.equal(ui.get("#clear-filters").hidden, true);
  assert.equal(type("").getAttribute("aria-pressed"), "true");
  assert.equal(ui.run("cart[1]"), 2);
  assert.equal(ui.run("total(cart)"), 200);
});

test("category tiles always use default category icons while photos and video thumbnails stay on product cards", async () => {
  const ui = await harness();
  const video = { provider: "youtube", resourceType: "video", videoId: "M7lc1UVf-VE", alt: "Synthetic video", credit: "" };
  const photo = { cloudName: "synthetic-cloud", publicId: "sai-baba-crackers/products/00000000-0000-4000-8000-000000000001",
    resourceType: "image", version: 1234567890, format: "jpg", bytes: 1000, width: 640, height: 480,
    duration: 0, alt: "Synthetic photo", credit: "" };
  ui.respond(async () => Response.json({ year: 2026, revision: 1, products: [
    { ...products[0], media: [photo, video] },
    { ...products[1], category: "Rockets", media: [video] },
    { ...products[2], category: "Crackers", name: "Synthetic Atom Bomb", media: [photo] },
  ] }));
  await ui.emit("#reload-catalogue", "click");
  const tile = ui.get("#categories").children.find(node => node.dataset.category === products[0].category);
  const art = tile.children[0];
  assert.equal(art.children[0].tagName, "SVG");
  assert.equal(art.children[0].children[0].getAttribute("href"), "#product-art-chakkar");
  assert.equal(art.getAttribute("aria-hidden"), "true");
  assert.equal(art.children.length, 1);
  const descendants = node => [node, ...node.children.flatMap(descendants)];
  assert.equal(descendants(ui.get("#categories")).some(node => node.tagName === "IMG"), false);
  const categoryIcon = name => ui.get("#categories").children.find(node => node.dataset.category === name)
    .children[0].children[0].children[0].getAttribute("href");
  assert.equal(categoryIcon("All products"), "#product-art-fountain");
  assert.equal(categoryIcon("Crackers"), "#product-art-crackers");
  assert.equal(ui.get("#products").children[0].children[0].children[0].src, mediaUrl(photo));
  assert.equal(ui.get("#products").children[1].children[0].children[0].src, mediaUrl(video));
  assert.equal(ui.get("#categories").children.find(node => node.dataset.category === "Rockets").children[0].children[0].tagName, "SVG");
  await tile.events.get("click")();
  assert.equal(ui.get("#products").children.length, 1);
  assert.equal(ui.get("#products").children[0].children[0].children[0].src, mediaUrl(photo));
  assert.equal(categoryIcon(products[0].category), "#product-art-chakkar");
});

test("untagged catalogues remain browsable and loading failures or empty catalogues hide stale discovery controls", async () => {
  const ui = await harness();
  assert.equal(ui.get("#products").children.length, 1);
  assert.equal(ui.get("#product-types").children[0].disabled, false);
  assert.equal(ui.get("#product-types").children.slice(1).every(node => node.disabled), true);
  ui.respond(async () => Response.json({ error: "Synthetic catalogue outage" }, { status: 503 }));
  await ui.emit("#reload-catalogue", "click");
  assert.equal(ui.get("#catalogue-discovery").hidden, true);
  assert.equal(ui.get("#categories").children.length, 0);
  assert.equal(ui.get("#product-types").children.length, 0);
  assert.equal(ui.get("#clear-filters").hidden, true);
  ui.respond(async () => Response.json({ year: 2026, revision: 2, products: [] }));
  await ui.emit("#reload-catalogue", "click");
  assert.equal(ui.get("#catalogue-discovery").hidden, true);
  assert.equal(ui.get("#categories").children.length, 0);
  assert.equal(ui.get("#no-results-title").textContent, "No products currently available");
  assert.equal(ui.get("#reset-filters").hidden, true);
});

test("customer catalogue is loaded dynamically and saved carts are bound to its year and revision", async () => {
  const ui = await harness({ stored: { year: 2026, revision: 1, cart: { 1: 2 } }, price: 99.95 });
  assert.equal(ui.get("#products").children.length, 1);
  assert.equal(ui.get("#review").disabled, false);
  assert.equal(ui.get("year-label").textContent, 2026);
  assert.equal(ui.run("total(cart)"), 199.9);
  ui.run("updateQuantity(1, 1, false)");
  assert.deepEqual(JSON.parse(ui.storage.get(order.CART_KEY)), { year: 2026, revision: 1, cart: { 1: 3 } });
  ui.respond(async () => new Response(JSON.stringify({ year: 2027, revision: 2, products: [products[0]] })));
  await ui.emit("#reload-catalogue", "click");
  assert.equal(ui.get("#review").disabled, true);
  assert.match(ui.get("#storage-warning").children[0].textContent, /select your items again/);
  assert.equal(ui.get("year-label").textContent, 2027);
  ui.run("updateQuantity(1, 1, false)");
  assert.equal(ui.get("#storage-warning").hidden, true);
  assert.deepEqual(JSON.parse(ui.storage.get(order.CART_KEY)), { year: 2027, revision: 2, cart: { 1: 1 } });
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
  assert.equal(ui.get("#products").children[0].children[1].children[0].children[0].textContent, "NO. 01");
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
  assert.equal(ui.get("#products").children[0].children[1].children[0].children[0].textContent, "NO. 01");
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
  assert.equal(ui.get("#products").children[0].children[1].children[0].children[0].textContent, "NO. 01");
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
  assert.equal(cover.children.length, 2);
  assert.equal(ui.get("#products").children[0].children[1].children[0].children[0].textContent, "NO. 01");
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

test("product numbers stay outside photo, video, YouTube and icon covers, including preview failures and filtering", async () => {
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
    const metadata = card.children[1].children[0];
    const badge = metadata.children.find(node => node.className === "product-number");
    assert.ok(badge);
    assert.equal(cover.children.some(node => node.className === "product-number"), false);
    assert.equal(metadata.children.filter(node => node.className === "product-number").length, 1);
    assert.equal(cover.children.some(node => node.className === "art-category"), false);
    assert.equal(badge.textContent, `NO. ${rows[index].id}`);
    if (index < 3) {
      assert.equal(cover.children.some(node => node.className?.includes("media-cover-play")), false);
      assert.equal(cover.children.filter(node => node.className?.includes("media-cover-icon")).length, 1);
      cover.children[0].events.get("error")();
      assert.equal(metadata.children.find(node => node.className === "product-number"), badge);
      assert.equal(cover.children.some(node => node.className === "product-number"), false);
      assert.equal(cover.children.some(node => node.className?.includes("media-cover-play")), false);
      assert.equal(cover.children.filter(node => node.className?.includes("media-cover-icon")).length, 1);
    }
  }
  ui.run("query = '11'; renderProducts(); updateQuantity(11, 1, false)");
  assert.equal(ui.get("#products").children.length, 1);
  assert.equal(ui.get("#products").children[0].children[1].children[0].children[0].textContent, "NO. 11");
});

test("compact product cards omit category text but preserve the number, brand, name, selling pack and category navigation", async () => {
  const ui = await harness();
  const card = ui.get("#products").children[0];
  const content = text(card);
  for (const value of ["NO. 01", products[0].brand, products[0].name, products[0].unit]) assert.ok(content.includes(value));
  assert.equal(content.includes(products[0].category), false);
  assert.ok(text(ui.get("#categories")).includes(products[0].category));
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
  assert.equal(ui.get("#catalogue-status").hidden, true);
  assert.equal(ui.get("#reload-catalogue").hidden, true);
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
  assert.equal(ui.get("#catalogue-status").hidden, false);
  assert.equal(ui.get("#reload-catalogue").hidden, false);
  assert.equal(ui.get("#reload-catalogue").disabled, false);
  ui.respond(async () => new Response(JSON.stringify({ year: 2026, revision: 1, products: [products[0]] })));
  await ui.emit("#reload-catalogue", "click");
  assert.equal(ui.run("cart[1]"), 1);
  assert.equal(ui.get("#review").disabled, false);
  assert.equal(ui.get("#catalogue-status").hidden, true);
  assert.equal(ui.get("#reload-catalogue").hidden, true);
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

test("checkout requires customer verification without losing the cart or submitting an order", async () => {
  const ui = await harness();
  ui.run("updateQuantity(1, 2, false)");
  ui.context.customerAuthorization = async () => {
    throw Object.assign(new Error("Sign in to verify your mobile."), { code: "CUSTOMER_SIGN_IN_REQUIRED" });
  };
  await ui.emit("#customer-form", "submit");
  assert.equal(ui.get("#customer-login-note").hidden, false);
  assert.match(ui.get("#form-error").textContent, /Sign in/);
  assert.equal(ui.run("cart[1]"), 2);
  assert.equal(ui.requests.filter(request => request.path === "/api/orders").length, 0);
});

test("test checkout sends the identity token and shows history without WhatsApp, telemetry or bearer links", async () => {
  const ui = await harness();
  ui.run("updateQuantity(1, 2, false)");
  ui.context.customerAuthorization = async () => ({ headers: { Authorization: "Bearer synthetic-token" }, isTest: true });
  ui.respond(async () => Response.json({
    orderId: "SBC-00000000-0000-4000-8000-000000000001",
    message: "Order ID: SBC-00000000-0000-4000-8000-000000000001\nSynthetic test request",
    summary: "Order ID: SBC-00000000-0000-4000-8000-000000000001\nSynthetic test request",
    isTest: true,
  }));
  let savedEvents = 0;
  ui.context.track = () => savedEvents++;
  await ui.emit("#customer-form", "submit");
  assert.equal(ui.requests.find(request => request.path === "/api/orders").headers.Authorization, "Bearer synthetic-token");
  assert.equal(ui.get("#message-title").textContent, "Test request saved");
  assert.equal(ui.get("#message-links").children[0].href, "/account/");
  assert.equal(ui.get("#message-links").children[0].clicks, undefined);
  assert.equal(ui.get("#order-details").hidden, true);
  assert.equal(ui.get("#whatsapp-recovery").hidden, true);
  assert.equal(savedEvents, 0);
});

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
  assert.match(ui.get("#handoff-instructions").textContent, /Tap Send in WhatsApp/);
  assert.equal(ui.get("#checkout-step").textContent, "STEP 3 OF 3");
  assert.equal(ui.get("#back-to-cart").hidden, true);
});

test("checkout separates cart review from compact details and preserves the draft when going back", async () => {
  const ui = await harness();
  ui.run("updateQuantity(1, 2, false)");
  await ui.emit("#review", "click");
  assert.equal(ui.get("#checkout").open, true);
  assert.equal(ui.get("#checkout-title").textContent, "Your details");
  assert.equal(ui.get("#checkout-step").textContent, "STEP 2 OF 3");
  assert.equal(ui.get("#checkout-summary").children.length, 1);
  assert.equal(ui.get("#checkout-summary").children[0].className, "pricing-summary");
  assert.equal(ui.get("#checkout-total").textContent, order.money(140));
  assert.equal(ui.get("#checkout-title").focused, true);
  let resets = 0;
  ui.get("#customer-form").reset = () => resets++;
  await ui.emit("#back-to-cart", "click");
  await ui.emit("#checkout", "close");
  assert.equal(resets, 0);
  ui.run("updateQuantity(1, 1, true)");
  await ui.emit("#review", "click");
  assert.equal(ui.get("#checkout-total").textContent, order.money(210));
  await ui.emit("#close-checkout", "click");
  await ui.emit("#checkout", "close");
  assert.equal(resets, 1);
});

test("saving blocks backwards navigation and optional-field validation reveals its collapsed section", async () => {
  const ui = await harness();
  ui.run("setSaving(true)");
  assert.equal(ui.get("#back-to-cart").disabled, true);
  assert.equal(ui.get("#close-checkout").disabled, true);
  await ui.emit("#back-to-cart", "click");
  assert.equal(ui.run("returningToCart"), false);
  ui.run("setSaving(false)");
  assert.equal(ui.get("#submit-requirement").textContent, "Save & open WhatsApp");
  const details = {};
  ui.get("#customer-form").closest = () => details;
  await ui.emit("#customer-form", "invalid");
  assert.equal(details.open, true);
});

test("checkout uses visible submit agreement without a checkbox and keeps long disclosures optional", async () => {
  const html = await readFile(new URL("../vendor-app/order/index.html", import.meta.url), "utf8");
  assert.doesNotMatch(html, /id="consent"|type="checkbox"/);
  assert.match(html, /By continuing, you agree to save your details with the shop/);
  assert.match(html, /Anyone with the link can view them/);
  assert.match(html, /aria-describedby="checkout-agreement whatsapp-send-help"/);
  assert.match(html, /<details id="extra-details"/);
  assert.match(html, /<summary>Privacy and sharing details<\/summary>/);
  assert.match(html, /<details id="complete-request"/);
  assert.ok(html.indexOf('id="storage-warning"') > html.indexOf('id="cart-drawer"'));
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

test("requotes after an uncertain save retain the request ID even if the coupon is disabled", async () => {
  const ui = await harness();
  let uuid = 0;
  ui.context.crypto.randomUUID = () => `00000000-0000-4000-8000-${String(++uuid).padStart(12, "0")}`;
  ui.run(`offers = { coupons: [{ code: "SALE15", percent: 15, enabled: true }], freeDeliveryMinimum: 2500, deliveryFee: 100 };
    offerVersion = "version-1"; couponCode = "SALE15"; updateQuantity(1, 1, false)`);
  const attempts = [];
  ui.respond(async (_, options) => {
    attempts.push(JSON.parse(options.body));
    return Response.json({ error: "Your request is saved, but its details link could not be prepared. Retry." }, { status: 503 });
  });
  await ui.emit("#customer-form", "submit");
  ui.run('offers.coupons[0].enabled = false; offers.deliveryFee = 120; offerVersion = "version-2"; couponCode = ""');
  await ui.emit("#customer-form", "submit");
  assert.equal(attempts[0].requestId, attempts[1].requestId);
  assert.equal(attempts[1].offerVersion, "version-2");
  assert.equal(attempts[1].couponCode, "");
  assert.equal(ui.get("#message-links").children.length, 0);
  ui.run("updateQuantity(1, 1, false)");
  await ui.emit("#customer-form", "submit");
  assert.notEqual(attempts[2].requestId, attempts[1].requestId);
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
