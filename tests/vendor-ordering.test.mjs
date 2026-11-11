import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { products, categories, vendor } from "../vendor-app/catalog.mjs";
import {
  sanitizeCart, cartLines, pricing, total, money, validateCustomer, createRequirement,
  whatsappUrl, prepareMessages, prepareOrderMessage, MAX_WHATSAPP_URL_LENGTH, localDate,
} from "../vendor-app/order.mjs";
import { initializeFireworks } from "../vendor-app/hero-fireworks.mjs";

const customer = {
  name: "Ravi Kumar", phone: "9876543210",
  address: "Flat 12, Example Street\nSanathnagar, Hyderabad 500018",
  fulfilment: "pickup", preferredDate: "2026-11-05", notes: "Please confirm stock.",
};
const today = "2026-11-02";

test("shopping, cart and checkout use familiar ecommerce labels without implying confirmation", async () => {
  const html = await readFile(new URL("../vendor-app/order/index.html", import.meta.url), "utf8");
  assert.match(html, /<a class="header-cart" href="#requirement">Cart /);
  assert.match(html, /id="requirement-title">Your cart<\/h2>/);
  assert.match(html, /id="mobile-cart"[^>]*>[\s\S]*?<span>View cart &#8594;<\/span><\/a>/);
  assert.match(html, /<button id="review" class="button primary wide" type="button" disabled>Continue to checkout <span aria-hidden="true">&#8594;<\/span><\/button>/);
  assert.match(html, /id="checkout-title"[^>]*>Your details<\/h2>/);
  assert.match(html, /aria-label="Close checkout"/);
  assert.match(html, /id="message-title"[^>]*>Order request saved<\/h3>/);
  assert.match(html, /Your request needs shop confirmation\./);
  assert.doesNotMatch(html, />View list|Your festive list|Review your requirement|>Clear selection|>Order confirmed|>Pay now/);
});

test("the store-pickup option provides the collection address on selection without preselecting fulfilment", async () => {
  const html = await readFile(new URL("../vendor-app/order/index.html", import.meta.url), "utf8");
  const app = await readFile(new URL("../vendor-app/app.mjs", import.meta.url), "utf8");
  const pickup = html.match(/<label class="fulfilment-option"><input id="fulfilment-pickup"[\s\S]*?<\/label>/)?.[0];
  assert.ok(pickup);
  assert.match(pickup, /value="pickup" required/);
  assert.match(app, /method === "pickup" \?\s*"Collect from Industrial Estate, Main Road, Sanath Nagar\. The shop will confirm timing\."/);
  assert.match(html, /id="fulfilment-help"/);
  assert.doesNotMatch(pickup, /\bchecked\b/);
});

test("the WhatsApp action explicitly explains the customer's final Send step", async () => {
  const html = await readFile(new URL("../vendor-app/order/index.html", import.meta.url), "utf8");
  const app = await readFile(new URL("../vendor-app/app.mjs", import.meta.url), "utf8");
  assert.match(html, /id="submit-requirement"[^>]*aria-describedby="checkout-agreement whatsapp-send-help">Save &amp; open WhatsApp<\/button>/);
  assert.match(html, /id="whatsapp-send-help"[^>]*>Tap Send in WhatsApp\. Your request needs shop confirmation\./);
  assert.match(app, /"Saving order request\.\.\." : "Save & open WhatsApp"/);
  assert.match(app, /"Open WhatsApp \\u2197"/);
  assert.doesNotMatch(html + app, /Order confirmed|Pay now/);
});

test("the active checkout uses one WhatsApp message and retains the complete request for copy/download", async () => {
  const html = await readFile(new URL("../vendor-app/order/index.html", import.meta.url), "utf8");
  const app = await readFile(new URL("../vendor-app/app.mjs", import.meta.url), "utf8");
  assert.match(app, /prepareOrderMessage\(result\.summary\)/);
  assert.match(app, /link\.target = "_self"/);
  assert.match(app, /replaceChildren\(link\)/);
  assert.match(html, /share them through a link valid for 7 days/);
  assert.doesNotMatch(app, /prepareMessages|Send part|Send every part|split into/);
  assert.match(app, /\$\("#full-message"\)\.value = fullMessage/);
  assert.match(app, /clipboard\.writeText\(fullMessage\)/);
  assert.match(html, /A read-only copy is stored privately on Netlify/);
  assert.match(app, /shareConsent: true/);
  assert.doesNotMatch(app, /pdfConsent: true/);
  assert.match(app, /validateOrderShareLink\(result\.share, window\.location\.origin, orderId\)/);
  assert.match(html, /id="copy-message"[^>]*>Copy full order request<\/button>/);
});

test("long-cart totals and checkout product names can wrap on narrow screens", async () => {
  const css = await readFile(new URL("../vendor-app/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.cart-total\s*\{[^}]*flex-wrap: wrap;/);
  assert.match(css, /\.review-line > span\s*\{[^}]*min-width: 0;[^}]*overflow-wrap: anywhere;/);
});

test("WhatsApp recovery reuses the prepared details-link summary and offers a phone-only chat without resubmitting", async () => {
  const html = await readFile(new URL("../vendor-app/order/index.html", import.meta.url), "utf8");
  const app = await readFile(new URL("../vendor-app/app.mjs", import.meta.url), "utf8");
  assert.match(html, /id="whatsapp-recovery"[^>]*>[\s\S]*?<summary>WhatsApp closed or did not open\?<\/summary>/);
  assert.match(html, /id="copy-whatsapp-message"[^>]*type="button"/);
  assert.match(html, /id="open-shop-chat"[^>]*target="_self"/);
  assert.match(html, /id="whatsapp-message"[^>]*readonly/);
  assert.match(app, /\$\("#whatsapp-message"\)\.value = message\.text/);
  assert.match(app, /const chatUrl = new URL\(message\.url\);\s*chatUrl\.search = "";/);
  assert.match(app, /clipboard\.writeText\(\$\("#whatsapp-message"\)\.value\)/);
  assert.match(app, /\$\("#whatsapp-message"\)\.select\(\)/);
  assert.match(app, /\$\("#whatsapp-message"\)\.value = ""/);
  assert.match(html, /There is no need to submit again/);
});

test("a single clear-cart action stays above the scrollable cart items", async () => {
  const html = await readFile(new URL("../vendor-app/order/index.html", import.meta.url), "utf8");
  assert.match(html, /<button id="clear-cart-top" class="text-button" type="button" hidden>Clear cart<\/button>/);
  assert.doesNotMatch(html, /id="clear-cart"/);
  assert.ok(html.indexOf('id="clear-cart-top"') < html.indexOf('id="cart-items"'));
});

test("shopping retains its original static artwork and only the homepage adds canvas fireworks", async () => {
  const html = await readFile(new URL("../vendor-app/order/index.html", import.meta.url), "utf8");
  assert.match(html, /<img class="hero-fireworks" src="\/diwali-fireworks\.png" alt="" width="420" height="340"/);
  assert.doesNotMatch(html, /<video\b|\.gif\b|\.mp4\b/);
  assert.doesNotMatch(html, /<canvas\b|data-fireworks-toggle/);
  const home = await readFile(new URL("../vendor-app/index.html", import.meta.url), "utf8");
  assert.equal([...home.matchAll(/<canvas\b/g)].length, 1);
  assert.match(home, /class="fireworks-stage" aria-hidden="true">[\s\S]*?<canvas[^>]*data-fireworks/);
  assert.match(home, /<button[^>]*data-fireworks-toggle hidden>Pause fireworks/);
  const app = await readFile(new URL("../vendor-app/app.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(app, /initializeFireworks|hero-fireworks\.mjs/);
  const image = await readFile(new URL("../vendor-app/diwali-fireworks.png", import.meta.url));
  assert.ok(image.length < 60 * 1024, "header image must stay below 60 KB");
  assert.deepEqual([...image.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(image.readUInt32BE(16), 420);
  assert.equal(image.readUInt32BE(20), 340);
  const illustration = await readFile(new URL("../vendor-app/modern-fireworks.svg", import.meta.url), "utf8");
  assert.ok(Buffer.byteLength(illustration) < 5 * 1024, "new static artwork must stay below 5 KB");
  assert.doesNotMatch(illustration, /<script\b|<image\b|https?:\/\/(?!www.w3.org)/);
});

test("selected product cards highlight their full surface and artwork without changing card geometry", async () => {
  const css = await readFile(new URL("../vendor-app/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.product-card\.in-cart\s*\{[^}]*border-color: var\(--selected-border\);[^}]*background: var\(--selected-surface\);[^}]*box-shadow: inset 0 0 0 1px var\(--selected-border\);/);
  assert.match(css, /\.product-card\.in-cart \.product-art\s*\{[^}]*background: var\(--selected-art\);/);
  assert.match(css, /\.product-card\.in-cart \.quantity-control > span\s*\{[^}]*font-weight: 750;/);
});

function fireworksFixture(reduced = false) {
  const classes = new Set();
  const frame = { classList: { add: name => classes.add(name), remove: name => classes.delete(name) } };
  const attributes = new Map();
  const video = Object.assign(new EventTarget(), {
    parentElement: frame, dataset: { src: "./diwali-fireworks.mp4" },
    paused: true, ended: false, muted: false, currentTime: 0, error: null,
    plays: 0, loads: 0, playError: null,
    hasAttribute: name => attributes.has(name),
    removeAttribute: name => attributes.delete(name),
    pause() { this.paused = true; this.dispatchEvent(new Event("pause")); },
    load() { this.loads++; },
    async play() {
      this.plays++;
      if (this.playError) throw this.playError;
      this.paused = false;
      this.ended = false;
      this.dispatchEvent(new Event("playing"));
    },
  });
  Object.defineProperty(video, "src", { set: value => attributes.set("src", value) });
  const button = Object.assign(new EventTarget(), { hidden: true, textContent: "Play fireworks" });
  const motion = Object.assign(new EventTarget(), { matches: reduced });
  let intersection;
  const root = Object.assign(new EventTarget(), {
    hidden: false,
    querySelector: selector => selector === "#hero-fireworks" ? video : button,
    defaultView: {
      matchMedia: () => motion,
      IntersectionObserver: class {
        constructor(callback) { intersection = callback; }
        observe(element) { assert.equal(element, frame); }
      },
    },
  });
  initializeFireworks(root);
  return {
    video, button, motion, root, classes,
    visible(value) { intersection([{ isIntersecting: value, intersectionRatio: value ? 1 : 0 }]); },
    click() { button.dispatchEvent(new Event("click")); },
    reduced(value) { motion.matches = value; motion.dispatchEvent(new Event("change")); },
    hidden(value) { root.hidden = value; root.dispatchEvent(new Event("visibilitychange")); },
  };
}

test("legacy cached-page fireworks support visibility, mute, pause and replay", async () => {
  const scene = fireworksFixture();
  assert.equal(scene.video.hasAttribute("src"), false);
  scene.visible(true);
  await Promise.resolve();
  assert.equal(scene.video.plays, 1);
  assert.equal(scene.video.muted, true);
  assert.equal(scene.button.textContent, "Pause fireworks");
  assert.ok(scene.classes.has("is-playing"));
  scene.click();
  assert.equal(scene.video.paused, true);
  assert.equal(scene.classes.has("is-playing"), false);
  scene.click();
  assert.equal(scene.video.plays, 2);
  scene.video.currentTime = 4;
  scene.video.ended = true;
  scene.video.paused = true;
  scene.video.dispatchEvent(new Event("ended"));
  assert.equal(scene.button.textContent, "Replay fireworks");
  scene.click();
  assert.equal(scene.video.currentTime, 0);
  assert.equal(scene.video.plays, 3);
  scene.visible(false);
  assert.equal(scene.video.paused, true);
  scene.visible(true);
  assert.equal(scene.video.plays, 3, "scrolling back must not repeatedly autoplay");
});

test("legacy cached-page blocked autoplay preserves the poster and manual retry", async t => {
  const warning = t.mock.method(console, "warn", () => {});
  const scene = fireworksFixture();
  scene.video.playError = new DOMException("Autoplay blocked", "NotAllowedError");
  scene.visible(true);
  await Promise.resolve();
  assert.equal(scene.classes.has("is-playing"), false);
  assert.equal(scene.button.textContent, "Play fireworks");
  assert.equal(warning.mock.callCount(), 1);
  scene.video.playError = null;
  scene.click();
  await Promise.resolve();
  assert.equal(scene.video.plays, 2);
  assert.ok(scene.classes.has("is-playing"));
});

test("legacy cached-page reduced motion prevents video requests and stops playback", async () => {
  const scene = fireworksFixture(true);
  scene.visible(true);
  assert.equal(scene.video.plays, 0);
  assert.equal(scene.video.hasAttribute("src"), false);
  assert.equal(scene.button.hidden, true);
  scene.reduced(false);
  await Promise.resolve();
  assert.equal(scene.video.plays, 1);
  scene.reduced(true);
  assert.equal(scene.video.paused, true);
  assert.equal(scene.video.hasAttribute("src"), false);
  assert.equal(scene.video.loads, 1);
  assert.equal(scene.classes.has("is-playing"), false);
  assert.equal(scene.button.hidden, true);
});

test("legacy cached-page playback respects hidden tabs and pending stops", async () => {
  const scene = fireworksFixture();
  scene.hidden(true);
  scene.visible(true);
  assert.equal(scene.video.plays, 0);
  scene.hidden(false);
  assert.equal(scene.video.plays, 1);
  scene.hidden(true);
  assert.equal(scene.video.paused, true);
  scene.hidden(false);
  assert.equal(scene.video.plays, 1);
  let finish;
  scene.video.play = () => new Promise(resolve => { finish = resolve; });
  scene.click();
  scene.visible(false);
  scene.video.paused = false;
  scene.video.dispatchEvent(new Event("playing"));
  finish();
  await Promise.resolve();
  assert.equal(scene.video.paused, true);
  assert.equal(scene.classes.has("is-playing"), false);
});

test("legacy cached-page decoding errors preserve the poster and retry", async t => {
  const warning = t.mock.method(console, "warn", () => {});
  const scene = fireworksFixture();
  scene.visible(true);
  scene.video.error = { code: 3 };
  scene.video.dispatchEvent(new Event("error"));
  assert.equal(scene.video.paused, true);
  assert.equal(scene.classes.has("is-playing"), false);
  assert.equal(warning.mock.callCount(), 1);
  scene.click();
  await Promise.resolve();
  assert.equal(scene.video.loads, 1);
  assert.equal(scene.video.plays, 2);
});

test("legacy GIF URLs retain a small finite animation and matching fallback", async () => {
  const gif = await readFile(new URL("../vendor-app/diwali-header.gif", import.meta.url));
  assert.equal(gif.toString("ascii", 0, 6), "GIF89a");
  assert.equal(gif.readUInt16LE(6), 420);
  assert.equal(gif.readUInt16LE(8), 340);
  assert.ok(gif.length < 100 * 1024, "decorative GIF must stay below 100 KB");
  let offset = 13 + ((gif[10] & 128) ? 3 * (2 ** ((gif[10] & 7) + 1)) : 0);
  let frames = 0;
  let duration = 0;
  let ended = false;
  function skipBlocks() {
    while (true) {
      assert.ok(offset < gif.length, "truncated GIF sub-block");
      const length = gif[offset++];
      if (length === 0) return;
      offset += length;
      assert.ok(offset <= gif.length, "truncated GIF data");
    }
  }
  while (offset < gif.length) {
    const marker = gif[offset++];
    if (marker === 0x3b) {
      ended = true;
      break;
    }
    if (marker === 0x21) {
      const label = gif[offset++];
      if (label === 0xf9) {
        assert.equal(gif[offset], 4);
        duration += gif.readUInt16LE(offset + 2) * 10;
      } else if (label === 0xff) {
        const application = gif.toString("ascii", offset + 1, offset + 1 + gif[offset]);
        assert.ok(!["NETSCAPE2.0", "ANIMEXTS1.0"].includes(application), "header GIF must not loop");
      }
      skipBlocks();
    } else {
      assert.equal(marker, 0x2c, "unexpected GIF block");
      frames++;
      const packed = gif[offset + 8];
      offset += 9 + ((packed & 128) ? 3 * (2 ** ((packed & 7) + 1)) : 0);
      offset++;
      skipBlocks();
    }
  }
  assert.ok(ended && frames > 1, "header GIF must contain an animation");
  assert.ok(duration > 0 && duration <= 5000, "automatic animation must finish within five seconds");
  const still = await readFile(new URL("../vendor-app/diwali-header-still.png", import.meta.url));
  assert.deepEqual([...still.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(still.readUInt32BE(16), 420);
  assert.equal(still.readUInt32BE(20), 340);
});

test("social previews use a square Diwali PNG without changing the website logo", async () => {
  const html = await readFile(new URL("../vendor-app/order/index.html", import.meta.url), "utf8");
  const metadata = new Map([...html.matchAll(/<meta (?:property|name)="([^"]+)" content="([^"]*)"[^>]*>/g)]
    .map(([, name, content]) => [name, content]));
  const image = new URL(metadata.get("og:image"));
  assert.equal(image.href, "https://saibabacrackers.netlify.app/diwali-crackers-square.png");
  assert.equal(metadata.get("og:url"), "https://saibabacrackers.netlify.app/order/");
  assert.equal(metadata.get("og:type"), "website");
  assert.equal(metadata.get("og:image:type"), "image/png");
  assert.equal(metadata.get("twitter:card"), "summary");
  assert.equal(metadata.get("twitter:image"), image.href);
  assert.ok(metadata.get("og:image:alt").includes("Diwali crackers"));
  assert.equal(metadata.get("twitter:image:alt"), metadata.get("og:image:alt"));
  assert.match(html, /<img class="brand-mark" src="\/sai-baba-logo\.png"/);
  assert.match(html, /<link rel="icon" type="image\/png" href="\/sai-baba-logo\.png"/);
  const png = await readFile(new URL(`../vendor-app${image.pathname}`, import.meta.url));
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.toString("ascii", 12, 16), "IHDR");
  assert.equal(png.readUInt32BE(16), 800);
  assert.equal(png.readUInt32BE(20), 800);
  assert.equal(metadata.get("og:image:width"), String(png.readUInt32BE(16)));
  assert.equal(metadata.get("og:image:height"), String(png.readUInt32BE(20)));
});

test("catalogue contains all 68 numbered products and the PDF's exact rates", () => {
  assert.deepEqual(products.map(product => product.id), Array.from({ length: 68 }, (_, index) => index + 1));
  assert.deepEqual(products.map(product => product.price), [
    70, 155, 240, 225, 300, 70, 170, 90, 200, 60, 170, 230, 425, 455, 350, 525,
    50, 25, 50, 60, 20, 55, 65, 140, 170, 220, 130, 750, 650, 1300, 3000, 6000,
    35, 140, 120, 450, 110, 200, 175, 175, 275, 275, 325, 260, 180, 230, 500, 500,
    250, 100, 225, 600, 160, 220, 250, 245, 300, 110, 120, 260, 120, 450,
    120, 300, 450, 900, 1600, 3500,
  ]);
  for (const product of products) {
    assert.ok(product.name && product.brand && product.unit);
    assert.ok(categories.includes(product.category));
    assert.ok(Number.isSafeInteger(product.price));
  }
  assert.equal(vendor.whatsapp, "919849293951");
});

test("quantities count selling units rather than pieces", () => {
  assert.equal(total({ 1: 2, 12: 1 }), 314.5);
  assert.equal(cartLines({ 1: 2 })[0].unit, "10 pcs / box");
  assert.equal(total({}), 0);
  assert.equal(total({ 32: 99 }), 504900);
});

test("15% discount is applied once to the subtotal, with paise preserved", () => {
  assert.deepEqual(pricing({ 1: 2, 12: 1 }), { subtotal: 370, discount: 55.5, total: 314.5 });
  assert.deepEqual(pricing({ 18: 1 }), { subtotal: 25, discount: 3.75, total: 21.25 });
  assert.deepEqual(pricing({ 21: 1 }), { subtotal: 20, discount: 3, total: 17 });
  assert.deepEqual(pricing({}), { subtotal: 0, discount: 0, total: 0 });
  assert.ok(money(314.5).endsWith("314.50"));
  assert.ok(money(21.25).endsWith("21.25"));
  assert.ok(money(70).endsWith("70"));
  for (const quantity of [1, 2, 17, 99]) {
    const cart = Object.fromEntries(products.map(product => [product.id, quantity]));
    const amounts = pricing(cart);
    const subtotalPaise = products.reduce((sum, product) => sum + product.price * quantity * 100, 0);
    assert.equal(Math.round(amounts.discount * 100), Math.round(subtotalPaise * 15 / 100));
    assert.equal(Math.round(amounts.total * 100) + Math.round(amounts.discount * 100), subtotalPaise);
  }
});

test("invalid saved carts cannot change the catalogue or inject quantities", () => {
  for (const value of [null, [], "bad", { 999: 1 }, { 1: 0 }, { 1: -1 }, { 1: 1.5 },
    { 1: "2" }, { 1: 100 }, { 1: NaN }, { "01": 1 }, { "<img>": 1 }]) {
    assert.throws(() => sanitizeCart(value));
  }
  assert.deepEqual(sanitizeCart({ 1: 2, 68: 99 }), { 1: 2, 68: 99 });
});

test("customer validation accepts formatted Indian phones and optional fields", () => {
  for (const phone of ["9876543210", "+91 98765 43210", "919876543210", "(98765) 43210"]) {
    assert.equal(validateCustomer({ ...customer, phone }, today).phone, "9876543210");
  }
  assert.equal(validateCustomer({ ...customer, preferredDate: "", notes: "" }, today).preferredDate, "");
  assert.equal(validateCustomer({ ...customer, preferredDate: today }, today).preferredDate, today);
  assert.equal(localDate(new Date(2026, 10, 2, 0, 15)), today);
});

test("invalid names, phones, addresses, dates and oversized notes fail explicitly", () => {
  for (const change of [{ name: "" }, { name: "A" }, { name: "A\nCustomer" },
    { name: "a".repeat(81) }, { phone: "1234567890" }, { phone: "98765" },
    { phone: "+1 9876543210" }, { address: undefined }, { address: "" },
    { address: " \n " }, { address: "Too short" }, { address: "a".repeat(501) },
    { preferredDate: "2026-11-01" }, { preferredDate: "2027-02-29" },
    { preferredDate: "not-a-date" }, { notes: "a".repeat(501) }]) {
    assert.throws(() => validateCustomer({ ...customer, ...change }, today));
  }
});

test("delivery or pickup is an explicit required choice", () => {
  for (const fulfilment of [undefined, "", "courier", "Delivery", " pickup "]) {
    assert.throws(() => validateCustomer({ ...customer, fulfilment }, today),
      /Choose free home delivery or store pickup/);
  }
  for (const fulfilment of ["delivery", "pickup"]) {
    assert.equal(validateCustomer({ ...customer, fulfilment }, today).fulfilment, fulfilment);
    assert.throws(() => validateCustomer({ ...customer, fulfilment, address: "" }, today), /address/);
    assert.throws(() => validateCustomer({ ...customer, fulfilment, preferredDate: "2026-11-01" }, today),
      new RegExp(`future date for ${fulfilment === "delivery" ? "delivery" : "pickup"}`));
  }
});

test("free home delivery and pickup retain the same 15% discounted total", () => {
  for (const fulfilment of ["delivery", "pickup"]) {
    const text = createRequirement({ 1: 2, 12: 1 }, { ...customer, fulfilment }, today);
    assert.ok(text.includes("Discount applied (15%): -Rs.55.50"));
    assert.ok(text.includes("Estimated total: Rs.314.50"));
    assert.ok(text.includes(`Address: ${customer.address}`));
    if (fulfilment === "delivery") {
      assert.ok(text.includes("Delivery option: Free home delivery"));
      assert.ok(text.includes("Delivery fee: Rs.0.00 (FREE)"));
      assert.ok(text.includes("Preferred delivery date: 2026-11-05"));
      assert.ok(text.includes("delivery arrangements."));
      assert.ok(!text.includes("pickup"));
    } else {
      assert.ok(text.includes("Delivery option: Store pickup"));
      assert.ok(text.includes("Preferred pickup date: 2026-11-05"));
      assert.ok(!text.includes("Delivery fee"));
      assert.ok(!text.includes("delivery arrangements."));
    }
    const withoutDate = createRequirement({ 18: 1 },
      { ...customer, fulfilment, preferredDate: "" }, today);
    assert.ok(!withoutDate.includes("Preferred "));
    assert.ok(withoutDate.includes("Estimated total: Rs.21.25"));
  }
});

test("addresses retain multiline and Unicode text while normalizing line endings", () => {
  assert.equal(validateCustomer({ ...customer, address: `  ${customer.address.replace("\n", "\r\n")}  ` }, today).address,
    customer.address);
  for (const length of [10, 500]) {
    assert.equal(validateCustomer({ ...customer, address: "a".repeat(length) }, today).address.length, length);
  }
  const address = "ఇంటి నంబర్ 12\nహైదరాబాద్ 500018";
  assert.equal(validateCustomer({ ...customer, address }, today).address, address);
});

test("message contains every detail, line amount, pack, brand and estimated total", () => {
  const message = createRequirement({ 1: 2, 12: 1 }, customer, today);
  for (const content of [`New order request - ${vendor.name} (${vendor.year})`, "Ravi Kumar", "+91 9876543210", "2026-11-05",
    "#1 Ground Chakkar Big | STANDARD", "Pack: 10 pcs / box",
    "2 packs x Rs.70 = Rs.140", "1 pack x Rs.230 = Rs.230", "#12 Flower Pot Special",
    `Address: ${customer.address}`, "Subtotal: Rs.370.00", "Discount applied (15%): -Rs.55.50",
    "Estimated total: Rs.314.50", "Please confirm stock.",
    "This is an order request, not a confirmed order. No payment has been made."]) {
    assert.ok(message.includes(content), content);
  }
  assert.throws(() => createRequirement({}, customer, today), /at least one/);
  const fractional = createRequirement({ 18: 1 }, customer, today);
  assert.ok(fractional.includes("Discount applied (15%): -Rs.3.75"));
  assert.ok(fractional.includes("Estimated total: Rs.21.25"));
});

test("WhatsApp links encode customer content without permitting URL injection", () => {
  const text = "Ravi & family + #1\nNotes: https://example.com/?a=1&b=2";
  const url = new URL(whatsappUrl(text));
  assert.equal(url.host, "wa.me");
  assert.equal(url.pathname, "/919849293951");
  assert.equal(url.searchParams.get("text"), text);
  assert.equal([...url.searchParams.keys()].length, 1);
  assert.throws(() => whatsappUrl(text, "123?bad=true"));
});

test("short requirements use one unmodified message", () => {
  const message = createRequirement({ 1: 1 }, customer, today);
  const result = prepareMessages(message);
  assert.equal(result.length, 1);
  assert.equal(result[0].text, message);
});

test("single-message checkout keeps short requests unchanged and switches only above the encoded URL limit", () => {
  const text = "x".repeat(MAX_WHATSAPP_URL_LENGTH - whatsappUrl("").length);
  const summary = "Order request summary";
  const atLimit = prepareOrderMessage(text, summary);
  assert.equal(atLimit.isSummary, false);
  assert.equal(atLimit.text, text);
  assert.equal(atLimit.url.length, MAX_WHATSAPP_URL_LENGTH);
  const aboveLimit = prepareOrderMessage(text + "x", summary);
  assert.equal(aboveLimit.isSummary, true);
  assert.equal(aboveLimit.text, summary);
  assert.equal(new URL(aboveLimit.url).searchParams.get("text"), summary);
  assert.ok(aboveLimit.url.length <= MAX_WHATSAPP_URL_LENGTH);
  const withApostrophe = text.slice(0, -1) + "'";
  assert.equal(whatsappUrl(withApostrophe).length, MAX_WHATSAPP_URL_LENGTH);
  assert.ok(new URL(whatsappUrl(withApostrophe)).href.length > MAX_WHATSAPP_URL_LENGTH);
  assert.equal(prepareOrderMessage(withApostrophe, summary).isSummary, true);
  const short = createRequirement({ 1: 1 }, customer, today);
  assert.equal(prepareOrderMessage(short).text, short);
});

test("Unicode uses the encoded link budget and long orders never silently split or lose a missing summary", () => {
  const text = "🎉".repeat(200);
  assert.ok(text.length < MAX_WHATSAPP_URL_LENGTH);
  assert.ok(whatsappUrl(text).length > MAX_WHATSAPP_URL_LENGTH);
  const summary = "Order ID: SBC-123\nCustomer: రవి";
  assert.equal(prepareOrderMessage(text, summary).text, summary);
  for (const invalid of [undefined, null, "", 42, {}]) {
    assert.throws(() => prepareOrderMessage(text, invalid), /did not provide a WhatsApp summary/);
  }
  assert.throws(() => prepareOrderMessage(text, "x".repeat(2000)), /summary is too long/);
  assert.throws(() => prepareOrderMessage(""), /empty/);
});

function assertLosslessSplit(text, maximum = 1800) {
  const messages = prepareMessages(text, vendor.whatsapp, maximum);
  assert.ok(messages.length > 1);
  const reconstructed = messages.map((message, index) => {
    assert.ok(message.url.length <= maximum, `part ${index + 1} exceeds encoded URL limit`);
    assert.equal(new URL(message.url).searchParams.get("text"), message.text);
    const prefix = `Order request - part ${index + 1} of ${messages.length}\nPlease send all parts.\n\n`;
    assert.ok(message.text.startsWith(prefix));
    return message.text.slice(prefix.length);
  }).join("");
  assert.equal(reconstructed, text);
}

test("the legacy splitter preserves all 68 products and both fulfilment options for cached pages", () => {
  const cart = Object.fromEntries(products.map(product => [product.id, 99]));
  for (const fulfilment of ["delivery", "pickup"]) {
    const text = createRequirement(cart, { ...customer, fulfilment }, today);
    assertLosslessSplit(text);
    for (const product of products) assert.ok(text.includes(`#${product.id} ${product.name}`));
    assert.ok(text.includes(`Address: ${customer.address}`));
  }
});

test("the legacy splitter retains Unicode customer details, long notes and huge individual lines losslessly", () => {
  const text = createRequirement({ 1: 2 }, {
    ...customer, name: "రవి కుమార్", address: "హైదరాబాద్ 500018\n".repeat(25),
    notes: "దీపావళి 🎉 ".repeat(35),
  }, today);
  assertLosslessSplit(text);
  assertLosslessSplit("🎉".repeat(500));
  assertLosslessSplit("first line\n\n" + "long note ".repeat(500) + "\nlast line\n");
  assert.throws(() => prepareMessages(""), /empty/);
  assert.throws(() => prepareMessages("x".repeat(100), vendor.whatsapp, 25), /too small/);
});
