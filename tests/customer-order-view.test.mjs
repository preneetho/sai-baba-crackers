import { test } from "node:test";
import assert from "node:assert/strict";
import { renderCustomerOrderTable, renderCustomerOrderDetails, prefillCustomerDetails } from "../vendor-app/browser-customer.mjs";
import { validateDemoProfile } from "../vendor-app/browser-customer-model.mjs";
import { validRevisionView, revisionAcknowledged } from "../vendor-app/order-revision-model.mjs";
import { renderRevisionHistory } from "../vendor-app/order-revision-view.mjs";
import { sellingPack } from "../vendor-app/order.mjs";

function dom() {
  const document = { createElement: tag => new Node(tag) };
  class Node {
    constructor(tag) { this.tag = tag; this.ownerDocument = document; this.children = []; this.dataset = {}; this.events = new Map(); this.textContent = ""; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    setAttribute() {}
    addEventListener(type, callback) { this.events.set(type, callback); }
  }
  return { document, root: new Node("div") };
}
const text = node => node.textContent + node.children.map(text).join(" ");
const order = {
  orderId: "SBC-TEST", createdAt: "2026-11-20T04:00:00.000Z", status: "Confirmed", total: 140,
  subtotal: 140, discount: 0, deliveryCharge: 0, name: "Synthetic", phone: "+91 9876543210",
  address: "Synthetic address", notes: "<script>not executable</script>", fulfilment: "Store pickup",
  preferredDate: "", items: "Product 1 | 2 packs",
  statusHistory: [
    { changedAt: "2026-11-20T04:00:00.000Z", fromStatus: null, toStatus: "New" },
    { changedAt: "2026-11-20T05:00:00.000Z", fromStatus: "New", toStatus: "Confirmed" },
  ],
};

test("saved details prefill editable name/address/delivery fields without changing phone or overwriting edits", () => {
  const form = { elements: {
    name: { value: "", readOnly: false }, address: { value: "", readOnly: false },
    fulfilment: { value: "" }, phone: { value: "9876543210", readOnly: true },
  } };
  const profile = { name: "Synthetic returning customer", address: "Saved synthetic address", fulfilment: "delivery" };
  prefillCustomerDetails(form, profile, new Set());
  assert.equal(form.elements.name.value, profile.name);
  assert.equal(form.elements.address.value, profile.address);
  assert.equal(form.elements.fulfilment.value, "delivery");
  assert.equal(form.elements.name.readOnly, false);
  assert.equal(form.elements.address.readOnly, false);
  assert.equal(form.elements.phone.value, "9876543210");
  form.elements.name.value = "Edited customer";
  form.elements.fulfilment.value = "pickup";
  prefillCustomerDetails(form, profile, new Set(["name", "fulfilment"]));
  assert.equal(form.elements.name.value, "Edited customer");
  assert.equal(form.elements.fulfilment.value, "pickup");
});

test("saved profile validation rejects another phone's data and malformed delivery choices", () => {
  const result = { phone: "9876543210", mode: "demo", verified: false,
    profile: { name: "Synthetic", address: "Synthetic address", fulfilment: "pickup" } };
  assert.deepEqual(validateDemoProfile(result, result.phone), result.profile);
  assert.throws(() => validateDemoProfile(result, "9876543211"), /could not be verified/);
  assert.throws(() => validateDemoProfile({ ...result, profile: { ...result.profile, fulfilment: "courier" } }, result.phone));
});

test("customer table has date/status/amount columns and one activation per row or reference click", () => {
  const { root } = dom();
  const selected = [];
  renderCustomerOrderTable([order], root, id => selected.push(id));
  const row = root.children[0];
  assert.equal(row.children.length, 4);
  assert.match(text(row.children[1]), /20.*Nov.*2026/);
  assert.equal(text(row.children[2]), "Confirmed");
  assert.match(text(row.children[3]), /140/);
  const button = row.children[1].children[0];
  button.events.get("click")();
  row.events.get("click")({ target: { closest: () => button } });
  assert.deepEqual(selected, ["SBC-TEST"]);
  row.events.get("click")({ target: { closest: () => null } });
  assert.deepEqual(selected, ["SBC-TEST", "SBC-TEST"]);
});

test("detail view shows saved items and genuine status changes while rendering customer content as text", () => {
  const { root } = dom();
  renderCustomerOrderDetails(order, root);
  const content = text(root);
  assert.match(content, /Confirmed/);
  assert.match(content, /Product 1 \| 2 packs/);
  assert.match(content, /Request recorded: New/);
  assert.match(content, /New to Confirmed/);
  assert.match(content, /<script>not executable<\/script>/);
  assert.ok(!root.children.some(node => node.tag === "script"));
  assert.match(content, /No item or price changes have been recorded/);
});

test("customer detail history shows original and latest line-item snapshots with literal revision reasons", () => {
  const { root } = dom();
  const original = { items: [{ id: 1, name: "Original pack", brand: "Synthetic", unit: "Box",
    quantity: 2, price: 70, amount: 140 }], subtotal: 140, discountPercent: 0, discount: 0, deliveryCharge: 0, total: 140 };
  const latest = { ...original, items: [{ ...original.items[0], name: "Replacement pack", quantity: 1, amount: 70 }], subtotal: 70, total: 70 };
  renderCustomerOrderDetails({ ...order, revision: 1, revisionHistory: [
    { ...original, revision: 0, changedAt: order.createdAt, reason: "Original customer request." },
    { ...latest, revision: 1, changedAt: order.createdAt, reason: "<script>Unavailability reason</script>" },
  ] }, root);
  const content = text(root);
  assert.match(content, /Original request/);
  assert.match(content, /Revision 1 \(latest\)/);
  assert.match(content, /Original pack/);
  assert.match(content, /Replacement pack/);
  assert.match(content, /<script>Unavailability reason<\/script>/);
});

test("pack descriptions distinguish selling boxes, packets and pieces without guessing ambiguous pack contents", () => {
  assert.deepEqual(sellingPack("10 pcs / box", 3), { noun: "box", count: "3 boxes", description: "1 box = 10 pieces" });
  assert.equal(sellingPack("5 boxes / packet", 2).description, "1 packet = 5 boxes");
  assert.equal(sellingPack("1 piece", 2).count, "2 pieces");
  assert.equal(sellingPack("5 pieces", 2).count, "2 packs");
  assert.equal(sellingPack("Assorted special", 2).description, "1 pack = Assorted special");
});

test("revision comparisons highlight removed, added and changed lines, fees and net changes against the previous version", () => {
  const { root } = dom();
  const item = { id: 1, name: "Original <item>", brand: "Synthetic", unit: "10 pcs / box",
    quantity: 2, price: 100, amount: 200 };
  const original = { items: [item, { ...item, id: 2 }], subtotal: 400, discountPercent: 0,
    discount: 0, deliveryCharge: 100, total: 500, revision: 0, changedAt: order.createdAt, reason: "Original request." };
  const first = { ...original, revision: 1, reason: "Changed availability", items: [
    { ...item, quantity: 1, price: 90, amount: 90 }, { ...item, id: 3, amount: 200 },
  ], subtotal: 290, deliveryCharge: 0, total: 290 };
  const second = { ...first, revision: 2, reason: "Delivery correction", deliveryCharge: 50, total: 340 };
  renderRevisionHistory({ revision: 2, revisionHistory: [original, first, second] }, root);
  const latest = root.children.find(node => node.tag === "section");
  assert.match(text(latest), /0 product lines changed; total increased by.*50/);
  assert.match(text(latest), /Delivery fee:.*0 to.*50/);
  assert.doesNotMatch(text(latest), /Removed:/);
  const history = text(root);
  assert.match(history, /3 product lines changed; total reduced by.*210/);
  assert.match(history, /Removed: #2/);
  assert.match(history, /Added: #3/);
  assert.match(history, /quantity 2 boxes to 1 box; unit price.*100 to.*90/);
  assert.match(history, /Original <item>/);
  assert.ok(root.children.filter(node => node.tag === "details").every(node => !node.open));
  assert.doesNotMatch(history, /Accept revised order/);
  const unchanged = dom().root;
  renderRevisionHistory({ revision: 1, revisionHistory: [original, { ...original, revision: 1 }] }, unchanged);
  assert.match(text(unchanged), /0 product lines changed; total unchanged/);
});

test("revision validation preserves recorded manual discounts but rejects inconsistent amounts and wrong save acknowledgements", () => {
  const item = { id: 1, name: "Synthetic pack", brand: "", unit: "Box", quantity: 1, price: 100, amount: 100 };
  const amounts = { items: [item], subtotal: 100, discountPercent: 0, discount: 10, deliveryCharge: 0, total: 90 };
  const original = { ...order, ...amounts, lineItems: [item], revision: 0, revisionHistory: [] };
  assert.equal(validRevisionView(original), true);
  assert.equal(validRevisionView({ ...original, total: 91 }), false);
  assert.equal(validRevisionView({ ...original, lineItems: [{ ...item, amount: 99 }] }), false);
  const revised = { ...original, revision: 1, revisionHistory: [
    { ...amounts, revision: 0, changedAt: order.createdAt, reason: "Original customer request." },
    { ...amounts, revision: 1, changedAt: order.createdAt, reason: "Agreed price correction." },
  ] };
  const input = { orderId: order.orderId, expectedRevision: 0, expectedStatus: order.status,
    deliveryCharge: 0, items: [{ id: 1, quantity: 1, price: 100 }], reason: "Agreed price correction." };
  assert.equal(revisionAcknowledged(revised, input), true);
  assert.equal(revisionAcknowledged(revised, { ...input, items: [{ id: 1, quantity: 2, price: 100 }] }), false);
  assert.equal(revisionAcknowledged(revised, { ...input, reason: "Another reason." }), false);
});
