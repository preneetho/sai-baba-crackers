import { test } from "node:test";
import assert from "node:assert/strict";
import { createOrderEditor } from "../vendor-app/vendor-order-editor.mjs";

function fixture() {
  const document = { createElement: tag => new Node(tag) };
  class Node {
    constructor(tag) {
      this.tag = tag; this.ownerDocument = document; this.children = [];
      this.events = new Map(); this.attributes = new Map(); this.dataset = {};
      this.textContent = ""; this.value = ""; this.disabled = false;
    }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = nodes; }
    get firstChild() { return this.children[0]; }
    get options() { return this.children; }
    setAttribute(key, value) { this.attributes.set(key, value); }
    addEventListener(type, callback) { this.events.set(type, callback); }
    querySelectorAll(selector) {
      const tags = selector.split(",").map(tag => tag.trim());
      return all(this).filter(node => tags.includes(node.tag));
    }
  }
  const form = new Node("form");
  const order = { orderId: "SBC-TEST", revision: 0, status: "New", deliveryCharge: 0,
    discountPercent: 0, fulfilment: "Store pickup", packing: { version: 0, items: [] },
    lineItems: [
      { id: 1, name: "Synthetic one", brand: "Synthetic", unit: "box", quantity: 2, price: 10 },
      { id: 2, name: "Synthetic two", brand: "Synthetic", unit: "box", quantity: 1, price: 20 },
    ] };
  const calls = [];
  const editor = createOrderEditor(order, { year: 2026, revision: 1, products: order.lineItems },
    form, () => {}, (id, state) => calls.push({ id, state }));
  return { form, editor, calls };
}
function all(node) { return node.children.flatMap(child => [child, ...all(child)]); }
const click = node => node.events.get("click")();
const find = (root, tag, text) => all(root).find(node => node.tag === tag && node.textContent === text);
const checkbox = (root, label) => all(root).find(node => node.tag === "input" &&
  node.type === "checkbox" && node.attributes.get("aria-label")?.startsWith(`${label}:`));
const check = (node, value) => { node.checked = value; node.events.get("change")(); };

test("cart controls change pack quantities, disable premature packing and suggest an editable availability reason", () => {
  const { form, editor } = fixture();
  const first = all(form).find(node => node.tag === "fieldset");
  click(find(first, "button", "+"));
  assert.equal(editor.build().items[0].quantity, 3);
  assert.match(editor.build().reason, /Pack quantities changed: #1/);
  assert.equal(checkbox(first, "Packed").disabled, true);
  click(find(first, "button", "-"));
  assert.equal(checkbox(first, "Packed").disabled, false);
  check(checkbox(first, "Not available"), true);
  assert.deepEqual(editor.build().items.map(item => item.id), [2]);
  assert.match(editor.build().reason, /Unavailable: #1/);
  assert.equal(checkbox(first, "Packed").disabled, true);
  assert.equal(first.dataset.unavailable, "true");
  assert.equal(first.dataset.pending, "false");
  const reason = all(form).find(node => node.tag === "textarea");
  reason.value = "Customer asked for a replacement.";
  reason.events.get("input")();
  check(checkbox(first, "Not available"), false);
  click(find(first, "button", "+"));
  assert.equal(editor.build().reason, "Customer asked for a replacement.");
});

test("packed checkbox acknowledgements update pending highlighting without discarding an unsaved order draft", () => {
  const { form, editor, calls } = fixture();
  const first = all(form).find(node => node.tag === "fieldset");
  const second = all(form).filter(node => node.tag === "fieldset")[1];
  click(find(first, "button", "+"));
  assert.equal(second.dataset.pending, "true");
  check(checkbox(second, "Packed"), true);
  assert.deepEqual(calls, [{ id: 2, state: "Packed" }]);
  editor.setPacking({ version: 1, items: [{ id: 2, state: "Packed" }] });
  assert.equal(checkbox(second, "Packed").checked, true);
  assert.equal(second.dataset.pending, "false");
  assert.equal(editor.build().items[0].quantity, 3);
  editor.setBusy(true);
  click(find(first, "button", "+"));
  assert.equal(editor.build().items[0].quantity, 3);
  assert.equal(checkbox(second, "Packed").disabled, true);
  editor.setBusy(false);
  assert.equal(checkbox(second, "Packed").disabled, false);
  check(checkbox(second, "Packed"), false);
  assert.deepEqual(calls[1], { id: 2, state: "Not started" });
  editor.setPacking({ version: 2, items: [] });
  assert.equal(checkbox(second, "Packed").checked, false);
  assert.equal(second.dataset.pending, "true");
});

test("legacy in-progress products appear pending without extra packing buttons", () => {
  const { form, editor } = fixture();
  const first = all(form).find(node => node.tag === "fieldset");
  editor.setPacking({ version: 1, items: [{ id: 1, state: "Packing" }] });
  assert.equal(checkbox(first, "Packed").checked, false);
  assert.equal(first.dataset.pending, "true");
  assert.deepEqual(all(first).filter(node => node.tag === "button").map(node => node.textContent), ["-", "+"]);
});
