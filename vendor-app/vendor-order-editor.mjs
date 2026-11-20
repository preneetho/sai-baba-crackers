import { calculateRevision } from "./order-revision-model.mjs";
import { money } from "./order.mjs";

export function createOrderEditor(order, catalogue, form, onChange) {
  const products = catalogue.products;
  const document = form.ownerDocument;
  const node = (tag, text) => {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    return element;
  };
  const labelled = (text, control) => {
    const label = node("label", text);
    label.append(control);
    return label;
  };
  const number = (value, max, step) => {
    const input = node("input");
    input.type = "number";
    input.min = step === "1" ? "1" : "0";
    input.max = max;
    input.step = step;
    input.required = true;
    input.value = String(value);
    return input;
  };
  let busy = false;
  const draft = order.lineItems.map(item => ({ ...item, included: true }));
  form.replaceChildren();
  const help = node("p", "Uncheck unavailable items, adjust selling packs/prices, or add a replacement. The original request is preserved. The saved coupon percentage is retained; review the delivery charge.");
  help.className = "vendor-muted";
  const rows = node("div");
  rows.className = "vendor-order-edit-items";
  const select = node("select");
  select.append(node("option", "Choose a catalogue product"));
  select.firstChild.value = "";
  for (const product of products.filter(product => product.hidden !== true)) {
    const option = node("option", `#${product.id} ${product.name} | ${product.brand} - ${money(product.price)}`);
    option.value = String(product.id);
    select.append(option);
  }
  const add = node("button", "Add product");
  add.type = "button";
  const delivery = number(order.deliveryCharge, "100000", "0.01");
  const reason = node("textarea");
  reason.required = true;
  reason.maxLength = 500;
  reason.rows = 3;
  const preview = node("p");
  preview.setAttribute("role", "status");
  const save = node("button", "Save order revision");
  save.type = "submit";
  save.className = "vendor-primary";
  const pickup = order.fulfilment === "Store pickup";
  const payload = () => ({
    items: draft.filter(item => item.included).map(({ id, quantity, price }) => ({ id, quantity, price })),
    deliveryCharge: delivery.value === "" ? NaN : Number(delivery.value),
  });
  const changed = () => {
    const input = payload();
    return input.deliveryCharge !== order.deliveryCharge || input.items.length !== order.lineItems.length ||
      input.items.some((item, index) => ["id", "quantity", "price"].some(key => item[key] !== order.lineItems[index]?.[key]));
  };
  const update = () => {
    try {
      const input = payload();
      const amounts = calculateRevision(input.items, order.discountPercent, input.deliveryCharge);
      preview.textContent = `Revised subtotal: ${money(amounts.subtotal)}; discount (${amounts.discountPercent}%): ${money(amounts.discount)}; delivery: ${money(amounts.deliveryCharge)}; total: ${money(amounts.total)}.`;
      save.disabled = busy || !changed();
    } catch (error) {
      preview.textContent = error.message;
      save.disabled = true;
    }
    add.disabled = busy || !select.value || draft.filter(item => item.included).length >= 200;
    for (const option of Array.from(select.options).slice(1)) {
      option.disabled = draft.some(item => item.included && item.id === Number(option.value));
    }
    onChange(changed() || reason.value.length > 0);
  };
  const appendRow = item => {
    const group = node("fieldset");
    group.className = "vendor-order-edit-item";
    group.append(node("legend", `#${item.id} ${item.name} | ${item.brand} (${item.unit})`));
    const available = node("input");
    available.type = "checkbox";
    available.checked = item.included;
    const availability = labelled("Available for this order", available);
    availability.className = "vendor-price-visibility";
    const quantity = number(item.quantity, "99", "1");
    const price = number(item.price, "100000", "0.01");
    const controls = () => {
      quantity.disabled = price.disabled = busy || !item.included;
    };
    available.addEventListener("change", () => {
      if (busy) return;
      item.included = available.checked;
      controls();
      update();
    });
    for (const [input, key] of [[quantity, "quantity"], [price, "price"]]) {
      input.addEventListener("input", () => {
        if (busy) return;
        item[key] = input.value === "" ? NaN : Number(input.value);
        update();
      });
    }
    group.append(availability, labelled("Selling packs", quantity), labelled("Price per pack (Rs.)", price));
    group.syncControls = controls;
    rows.append(group);
    controls();
  };
  draft.forEach(appendRow);
  select.addEventListener("change", update);
  add.addEventListener("click", () => {
    if (busy || !select.value) return;
    const product = products.find(product => product.id === Number(select.value) && product.hidden !== true);
    if (!product) { preview.textContent = "Choose an available catalogue product."; return; }
    let item = draft.find(item => item.id === product.id);
    if (item) {
      item.included = true;
      rows.replaceChildren();
      draft.forEach(appendRow);
    } else {
      item = { id: product.id, name: product.name, brand: product.brand, unit: product.unit, price: product.price, quantity: 1, included: true };
      draft.push(item);
      appendRow(item);
    }
    select.value = "";
    update();
    rows.lastChild.querySelector("input[type=number]").focus();
  });
  delivery.addEventListener("input", update);
  reason.addEventListener("input", update);
  const toolbar = node("div");
  toolbar.className = "vendor-price-toolbar";
  toolbar.append(labelled("Replacement or additional product", select), add);
  form.append(help, rows, toolbar, labelled("Delivery charge (Rs.)", delivery),
    labelled("Reason for changes (shown to the customer)", reason), preview, save);
  delivery.disabled = pickup;
  update();
  return {
    build() {
      const input = payload();
      calculateRevision(input.items, order.discountPercent, input.deliveryCharge);
      return { ...input, reason: reason.value.trim(), orderId: order.orderId,
        expectedRevision: order.revision, expectedStatus: order.status,
        catalogue: { year: catalogue.year, revision: catalogue.revision } };
    },
    setBusy(value) {
      busy = value;
      for (const control of form.querySelectorAll("input, select, textarea, button")) control.disabled = value;
      delivery.disabled = value || pickup;
      for (const group of rows.children) group.syncControls();
      update();
    },
  };
}
