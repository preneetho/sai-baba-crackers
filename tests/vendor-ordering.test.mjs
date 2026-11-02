import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { products, categories, vendor } from "../vendor-app/catalog.mjs";
import {
  sanitizeCart, cartLines, pricing, total, money, validateCustomer, createRequirement,
  whatsappUrl, prepareMessages, localDate,
} from "../vendor-app/order.mjs";

const customer = {
  name: "Ravi Kumar", phone: "9876543210",
  address: "Flat 12, Example Street\nSanathnagar, Hyderabad 500018",
  fulfilment: "pickup", preferredDate: "2026-11-05", notes: "Please confirm stock.",
};
const today = "2026-11-02";

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
