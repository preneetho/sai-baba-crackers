import { test } from "node:test";
import assert from "node:assert/strict";
import { products, categories, vendor } from "../vendor-app/catalog.mjs";
import {
  sanitizeCart, cartLines, total, validateCustomer, createRequirement,
  whatsappUrl, prepareMessages, localDate,
} from "../vendor-app/order.mjs";

const customer = { name: "Ravi Kumar", phone: "9876543210", pickup: "2026-11-05", notes: "Please confirm stock." };
const today = "2026-11-02";

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
  assert.equal(total({ 1: 2, 12: 1 }), 370);
  assert.equal(cartLines({ 1: 2 })[0].unit, "10 pcs / box");
  assert.equal(total({}), 0);
  assert.equal(total({ 32: 99 }), 594000);
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
  assert.equal(validateCustomer({ ...customer, pickup: "", notes: "" }, today).pickup, "");
  assert.equal(validateCustomer({ ...customer, pickup: today }, today).pickup, today);
  assert.equal(localDate(new Date(2026, 10, 2, 0, 15)), today);
});

test("invalid names, phones, dates and oversized notes fail explicitly", () => {
  for (const change of [{ name: "" }, { name: "A" }, { name: "A\nCustomer" },
    { name: "a".repeat(81) }, { phone: "1234567890" }, { phone: "98765" },
    { phone: "+1 9876543210" }, { pickup: "2026-11-01" }, { pickup: "2027-02-29" },
    { pickup: "not-a-date" }, { notes: "a".repeat(501) }]) {
    assert.throws(() => validateCustomer({ ...customer, ...change }, today));
  }
});

test("message contains every detail, line amount, pack, brand and estimated total", () => {
  const message = createRequirement({ 1: 2, 12: 1 }, customer, today);
  for (const content of ["Ravi Kumar", "+91 9876543210", "2026-11-05",
    "#1 Ground Chakkar Big | STANDARD", "Pack: 10 pcs / box",
    "2 selling unit(s) x Rs.70 = Rs.140", "#12 Flower Pot Special",
    "Estimated total: Rs.370", "Please confirm stock.", "not a confirmed order"]) {
    assert.ok(message.includes(content), content);
  }
  assert.throws(() => createRequirement({}, customer, today), /at least one/);
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

test("a basket containing all 68 products is split without losing any details", () => {
  const cart = Object.fromEntries(products.map(product => [product.id, 99]));
  const text = createRequirement(cart, customer, today);
  assertLosslessSplit(text);
  for (const product of products) assert.ok(text.includes(`#${product.id} ${product.name}`));
});

test("Unicode customer details, long notes and huge individual lines split losslessly", () => {
  const text = createRequirement({ 1: 2 }, {
    ...customer, name: "రవి కుమార్", notes: "దీపావళి 🎉 ".repeat(35),
  }, today);
  assertLosslessSplit(text);
  assertLosslessSplit("🎉".repeat(500));
  assertLosslessSplit("first line\n\n" + "long note ".repeat(500) + "\nlast line\n");
  assert.throws(() => prepareMessages(""), /empty/);
  assert.throws(() => prepareMessages("x".repeat(100), vendor.whatsapp, 25), /too small/);
});
