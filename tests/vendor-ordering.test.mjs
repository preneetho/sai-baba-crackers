import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { products, categories, vendor } from "../vendor-app/catalog.mjs";
import {
  sanitizeCart, cartLines, pricing, total, money, validateCustomer, createRequirement,
  whatsappUrl, prepareMessages, localDate,
} from "../vendor-app/order.mjs";
import { initializeFireworks } from "../vendor-app/hero-fireworks.mjs";

const customer = {
  name: "Ravi Kumar", phone: "9876543210",
  address: "Flat 12, Example Street\nSanathnagar, Hyderabad 500018",
  fulfilment: "pickup", preferredDate: "2026-11-05", notes: "Please confirm stock.",
};
const today = "2026-11-02";

test("header video is finite, silent, mobile-compatible and ready for progressive playback", async () => {
  const html = await readFile(new URL("../vendor-app/index.html", import.meta.url), "utf8");
  assert.match(html, /<video id="hero-fireworks" muted playsinline preload="none" data-src="\.\/diwali-fireworks\.mp4"/);
  assert.doesNotMatch(html, /\bloop\b|<video[^>]*\ssrc=/);
  assert.match(html, /<img src="\.\/diwali-fireworks-poster\.png" alt="" width="420" height="340"/);
  assert.match(html, /<button id="fireworks-toggle"[^>]*aria-controls="hero-fireworks" hidden>Play fireworks/);
  const app = await readFile(new URL("../vendor-app/app.mjs", import.meta.url), "utf8");
  assert.match(app, /renderCategories\(\);\s*renderProducts\(\);\s*renderCart\(\);\s*initializeFireworks\(\);\s*$/);
  assert.equal([...app.matchAll(/initializeFireworks\(\)/g)].length, 1);
  const mp4 = await readFile(new URL("../vendor-app/diwali-fireworks.mp4", import.meta.url));
  assert.ok(mp4.length < 180 * 1024, "decorative video must stay below 180 KB");
  function boxes(start, end) {
    const result = [];
    for (let offset = start; offset < end;) {
      const size = mp4.readUInt32BE(offset);
      assert.ok(size >= 8 && offset + size <= end, "invalid MP4 box");
      result.push({ type: mp4.toString("ascii", offset + 4, offset + 8), offset, data: offset + 8, end: offset + size });
      offset += size;
    }
    return result;
  }
  const top = boxes(0, mp4.length);
  const movie = top.find(box => box.type === "moov");
  assert.ok(movie.offset < top.find(box => box.type === "mdat").offset, "metadata must precede video data for mobile startup");
  const children = boxes(movie.data, movie.end);
  const timing = children.find(box => box.type === "mvhd");
  assert.equal(mp4[timing.data], 0);
  const duration = mp4.readUInt32BE(timing.data + 16) / mp4.readUInt32BE(timing.data + 12);
  assert.equal(duration, 4);
  const tracks = children.filter(box => box.type === "trak");
  assert.equal(tracks.length, 1, "the decorative clip must have no audio track");
  const track = boxes(tracks[0].data, tracks[0].end);
  const dimensions = track.find(box => box.type === "tkhd");
  assert.equal(mp4.readUInt32BE(dimensions.end - 8) / 65536, 420);
  assert.equal(mp4.readUInt32BE(dimensions.end - 4) / 65536, 340);
  const media = track.find(box => box.type === "mdia");
  const mediaChildren = boxes(media.data, media.end);
  const handler = mediaChildren.find(box => box.type === "hdlr");
  assert.equal(mp4.toString("ascii", handler.data + 8, handler.data + 12), "vide");
  const info = mediaChildren.find(box => box.type === "minf");
  const table = boxes(info.data, info.end).find(box => box.type === "stbl");
  const descriptions = boxes(table.data, table.end).find(box => box.type === "stsd");
  const sample = boxes(descriptions.data + 8, descriptions.end)[0];
  assert.equal(sample.type, "avc1", "use widely supported H.264");
  const codec = boxes(sample.data + 78, sample.end).find(box => box.type === "avcC");
  assert.equal(mp4[codec.data + 1], 66, "H.264 Baseline is required for mobile compatibility");
  const poster = await readFile(new URL("../vendor-app/diwali-fireworks-poster.png", import.meta.url));
  assert.deepEqual([...poster.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(poster.readUInt32BE(16), 420);
  assert.equal(poster.readUInt32BE(20), 340);
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

test("fireworks start only in view, stay muted and support pause, replay and offscreen stopping", async () => {
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

test("blocked autoplay preserves the poster and allows a user-initiated retry", async t => {
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

test("reduced motion never requests video and changing the preference stops playback", async () => {
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

test("hidden tabs do not start playback and pending playback cannot override a stop", async () => {
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

test("video decoding errors keep the still image visible and make a reload possible", async t => {
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
  const html = await readFile(new URL("../vendor-app/index.html", import.meta.url), "utf8");
  const metadata = new Map([...html.matchAll(/<meta (?:property|name)="([^"]+)" content="([^"]*)"[^>]*>/g)]
    .map(([, name, content]) => [name, content]));
  const image = new URL(metadata.get("og:image"));
  assert.equal(image.href, "https://saibabacrackers.netlify.app/diwali-crackers-square.png");
  assert.equal(metadata.get("og:url"), "https://saibabacrackers.netlify.app/");
  assert.equal(metadata.get("og:type"), "website");
  assert.equal(metadata.get("og:image:type"), "image/png");
  assert.equal(metadata.get("twitter:card"), "summary");
  assert.equal(metadata.get("twitter:image"), image.href);
  assert.ok(metadata.get("og:image:alt").includes("Diwali crackers"));
  assert.equal(metadata.get("twitter:image:alt"), metadata.get("og:image:alt"));
  assert.match(html, /<img class="brand-mark" src="\.\/sai-baba-logo\.png"/);
  assert.match(html, /<link rel="icon" type="image\/png" href="\.\/sai-baba-logo\.png"/);
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
    assert.ok(text.includes("Estimated total after discount: Rs.314.50"));
    assert.ok(text.includes(`Address: ${customer.address}`));
    if (fulfilment === "delivery") {
      assert.ok(text.includes("Fulfilment: Free home delivery"));
      assert.ok(text.includes("Home delivery charge: Rs.0.00 (FREE)"));
      assert.ok(text.includes("Preferred delivery date: 2026-11-05"));
      assert.ok(text.includes("delivery arrangements."));
      assert.ok(!text.includes("pickup"));
    } else {
      assert.ok(text.includes("Fulfilment: Store pickup"));
      assert.ok(text.includes("Preferred pickup date: 2026-11-05"));
      assert.ok(!text.includes("delivery charge"));
      assert.ok(!text.includes("delivery arrangements."));
    }
    const withoutDate = createRequirement({ 18: 1 },
      { ...customer, fulfilment, preferredDate: "" }, today);
    assert.ok(!withoutDate.includes("Preferred "));
    assert.ok(withoutDate.includes("Estimated total after discount: Rs.21.25"));
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
  for (const content of ["Ravi Kumar", "+91 9876543210", "2026-11-05",
    "#1 Ground Chakkar Big | STANDARD", "Pack: 10 pcs / box",
    "2 selling unit(s) x Rs.70 = Rs.140", "#12 Flower Pot Special",
    `Address: ${customer.address}`, "Subtotal: Rs.370.00", "Discount applied (15%): -Rs.55.50",
    "Estimated total after discount: Rs.314.50", "Please confirm stock.", "not a confirmed order"]) {
    assert.ok(message.includes(content), content);
  }
  assert.throws(() => createRequirement({}, customer, today), /at least one/);
  const fractional = createRequirement({ 18: 1 }, customer, today);
  assert.ok(fractional.includes("Discount applied (15%): -Rs.3.75"));
  assert.ok(fractional.includes("Estimated total after discount: Rs.21.25"));
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

function assertLosslessSplit(text, maximum = 1800) {
  const messages = prepareMessages(text, vendor.whatsapp, maximum);
  assert.ok(messages.length > 1);
  const reconstructed = messages.map((message, index) => {
    assert.ok(message.url.length <= maximum, `part ${index + 1} exceeds encoded URL limit`);
    assert.equal(new URL(message.url).searchParams.get("text"), message.text);
    const prefix = `Requirement - part ${index + 1} of ${messages.length}\nPlease send all parts.\n\n`;
    assert.ok(message.text.startsWith(prefix));
    return message.text.slice(prefix.length);
  }).join("");
  assert.equal(reconstructed, text);
}

test("a basket containing all 68 products preserves both fulfilment options when split", () => {
  const cart = Object.fromEntries(products.map(product => [product.id, 99]));
  for (const fulfilment of ["delivery", "pickup"]) {
    const text = createRequirement(cart, { ...customer, fulfilment }, today);
    assertLosslessSplit(text);
    for (const product of products) assert.ok(text.includes(`#${product.id} ${product.name}`));
    assert.ok(text.includes(`Address: ${customer.address}`));
  }
});

test("Unicode customer details, long notes and huge individual lines split losslessly", () => {
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
