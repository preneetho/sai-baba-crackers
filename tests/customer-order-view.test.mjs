import { test } from "node:test";
import assert from "node:assert/strict";
import { renderCustomerOrderTable, renderCustomerOrderDetails } from "../vendor-app/browser-customer.mjs";

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
  assert.match(content, /Product and price revisions are not tracked yet/);
});
