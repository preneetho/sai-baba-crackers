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

test("cart controls change pack quantities, disable premature packing and suggest an editable availability reason", () => {
  const { form, editor } = fixture();
  const first = all(form).find(node => node.tag === "fieldset");
  click(find(first, "button", "+"));
  assert.equal(editor.build().items[0].quantity, 3);
  assert.match(editor.build().reason, /Pack quantities changed: #1/);
  assert.equal(find(first, "button", "Packed").disabled, true);
  click(find(first, "button", "-"));
  assert.equal(find(first, "button", "Packed").disabled, false);
  click(find(first, "button", "Mark not available"));
  assert.deepEqual(editor.build().items.map(item => item.id), [2]);
  assert.match(editor.build().reason, /Unavailable: #1/);
  assert.equal(find(first, "button", "Packed").disabled, true);
  const reason = all(form).find(node => node.tag === "textarea");
  reason.value = "Customer asked for a replacement.";
  reason.events.get("input")();
  click(find(first, "button", "Restore item"));
  click(find(first, "button", "+"));
  assert.equal(editor.build().reason, "Customer asked for a replacement.");
});

test("packing acknowledgements update product buttons without discarding an unsaved order draft", () => {
  const { form, editor, calls } = fixture();
  const first = all(form).find(node => node.tag === "fieldset");
  const second = all(form).filter(node => node.tag === "fieldset")[1];
  click(find(first, "button", "+"));
  click(find(second, "button", "Packed"));
  assert.deepEqual(calls, [{ id: 2, state: "Packed" }]);
  editor.setPacking({ version: 1, items: [{ id: 2, state: "Packed" }] });
  assert.equal(find(second, "button", "Packed").attributes.get("aria-pressed"), "true");
  assert.equal(editor.build().items[0].quantity, 3);
  editor.setBusy(true);
  click(find(first, "button", "+"));
  assert.equal(editor.build().items[0].quantity, 3);
  assert.equal(find(second, "button", "Packing").disabled, true);
  editor.setBusy(false);
  assert.equal(find(second, "button", "Packing").disabled, false);
});
