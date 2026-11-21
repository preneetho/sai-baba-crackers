import { calculateRevision } from "./order-revision-model.mjs";
import { money } from "./order.mjs";
import { validPacking } from "./order-packing-model.mjs";

export function createOrderEditor(order, catalogue, form, onChange, onPacking) {
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
  let pendingPacking = null;
  const draft = order.lineItems.map(item => ({ ...item, included: true }));
  form.replaceChildren();
  const help = node("p", "Packed autosaves. Qty / Not available: Save changes.");
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
  let reasonEdited = false;
  const preview = node("p");
  preview.setAttribute("role", "status");
  const progress = node("p");
  progress.className = "vendor-packing-progress";
  progress.setAttribute("role", "status");
  const save = node("button", "Save order changes");
  save.type = "submit";
  save.className = "vendor-primary vendor-order-save";
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
    if (!reasonEdited) {
      const selected = draft.filter(item => item.included);
      const changes = [
        ["Unavailable", order.lineItems.filter(saved => !selected.some(item => item.id === saved.id))],
        ["Added products", selected.filter(item => !order.lineItems.some(saved => saved.id === item.id))],
        ["Pack quantities changed", selected.filter(item => order.lineItems.some(saved => saved.id === item.id && saved.quantity !== item.quantity))],
        ["Pack prices adjusted", selected.filter(item => order.lineItems.some(saved => saved.id === item.id && saved.price !== item.price))],
      ].filter(([, items]) => items.length).map(([label, items]) =>
        `${label}: ${items.slice(0, 3).map(item => `#${item.id}`).join(", ")}${items.length > 3 ? ` and ${items.length - 3} more` : ""}.`);
      if (Number(delivery.value) !== order.deliveryCharge) changes.push("Delivery charge adjusted.");
      reason.value = changes.join(" ");
    }
    try {
      const input = payload();
      const amounts = calculateRevision(input.items, order.discountPercent, input.deliveryCharge);
      preview.textContent = `Revised subtotal: ${money(amounts.subtotal)}; discount (${amounts.discountPercent}%): ${money(amounts.discount)}; delivery: ${money(amounts.deliveryCharge)}; total: ${money(amounts.total)}.`;
      save.textContent = `Save changes - ${money(amounts.total)}`;
      save.disabled = busy || pendingPacking !== null || !changed();
    } catch (error) {
      preview.textContent = error.message;
      save.disabled = true;
    }
    save.hidden = !changed();
    add.disabled = busy || !select.value || draft.filter(item => item.included).length >= 200;
    for (const option of Array.from(select.options).slice(1)) {
      option.disabled = draft.some(item => item.included && item.id === Number(option.value));
    }
    const savedPacked = order.packing?.items.filter(item => item.state === "Packed").length ?? 0;
    progress.textContent = validPacking(order.packing) ?
      `${savedPacked} / ${order.lineItems.length} packed. Yellow = pending.` :
      "Packing progress is unavailable. Reload the order before marking products.";
    for (const group of rows.children) group.syncControls();
    onChange(changed() || reason.value.length > 0);
  };
  const appendRow = item => {
    const group = node("fieldset");
    group.className = "vendor-order-edit-item";
    group.append(node("legend", `#${item.id} ${item.name}`));
    const meta = node("div");
    meta.className = "vendor-cart-product-meta";
    const stateLabel = node("span");
    stateLabel.className = "vendor-cart-item-state";
    meta.append(node("span", `${item.brand} | ${item.unit}`), stateLabel);
    const availability = node("input");
    availability.type = "checkbox";
    availability.setAttribute("aria-label", `Not available: ${item.name}`);
    const quantity = number(item.quantity, "99", "1");
    quantity.setAttribute("aria-label", `Selling packs for ${item.name}`);
    const price = number(item.price, "100000", "0.01");
    const minus = node("button", "-");
    const plus = node("button", "+");
    for (const [button, direction] of [[minus, -1], [plus, 1]]) {
      button.type = "button";
      button.setAttribute("aria-label", `${direction > 0 ? "Increase" : "Decrease"} packs for ${item.name}`);
      button.addEventListener("click", () => {
        if (busy || !item.included || !Number.isInteger(item.quantity)) return;
        const next = item.quantity + direction;
        if (next < 1 || next > 99) return;
        item.quantity = next;
        quantity.value = String(next);
        update();
      });
    }
    const quantityControls = node("div");
    quantityControls.className = "vendor-cart-quantity";
    quantityControls.append(minus, quantity, plus);
    const total = node("p");
    total.className = "vendor-cart-line-total";
    const priceSummary = node("summary");
    const actions = node("div");
    actions.className = "vendor-cart-item-actions";
    const original = order.lineItems.find(saved => saved.id === item.id);
    const packed = node("input");
    packed.type = "checkbox";
    packed.setAttribute("aria-label", `Packed: ${item.name}`);
    packed.addEventListener("change", () => {
      if (packed.disabled) return;
      onPacking(item.id, packed.checked ? "Packed" : "Not started");
      controls();
    });
    const packingHelp = node("p");
    packingHelp.className = "vendor-muted";
    const controls = () => {
      quantity.disabled = price.disabled = busy || !item.included;
      availability.disabled = busy;
      availability.checked = !item.included;
      group.dataset.unavailable = String(!item.included);
      minus.disabled = busy || !item.included || !Number.isInteger(item.quantity) || item.quantity <= 1;
      plus.disabled = busy || !item.included || !Number.isInteger(item.quantity) || item.quantity >= 99;
      const savingPacking = pendingPacking?.productId === item.id;
      const state = savingPacking ? pendingPacking.state :
        order.packing?.items.find(mark => mark.id === item.id)?.state ?? "Not started";
      const quantityMatches = original && original.quantity === item.quantity;
      packed.checked = state === "Packed" && item.included && quantityMatches;
      packed.disabled = busy || pendingPacking !== null || !onPacking ||
        !validPacking(order.packing) || !item.included || !quantityMatches;
      group.dataset.pending = String(item.included && !packed.checked);
      stateLabel.textContent = !item.included ? "Unavailable" : savingPacking ? "Saving..." :
        packed.checked ? "Packed" : "Pending";
      packingHelp.textContent = item.included && !quantityMatches ?
        "Save quantity changes before marking packed." : "";
      packingHelp.hidden = !packingHelp.textContent;
      total.textContent = !item.included ? "Excluded" :
        Number.isFinite(item.price) && Number.isInteger(item.quantity) ?
          money(Math.round(item.price * 100) * item.quantity / 100) :
          "Enter a valid quantity and price.";
      priceSummary.textContent = Number.isFinite(item.price) ? `Price ${money(item.price)}` : "Fix price";
    };
    availability.addEventListener("change", () => {
      if (busy) return;
      item.included = !availability.checked;
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
    const priceDetails = node("details");
    priceDetails.className = "vendor-cart-price";
    priceDetails.append(priceSummary, labelled("Price per pack (Rs.)", price));
    const quantityLabel = labelled("Qty", quantityControls);
    quantityLabel.className = "vendor-cart-quantity-label";
    for (const [text, checkbox] of [["Packed", packed], ["Not available", availability]]) {
      const label = labelled(text, checkbox);
      label.className = "vendor-item-check";
      actions.append(label);
    }
    actions.append(priceDetails);
    group.append(meta, quantityLabel, total, actions, packingHelp);
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
  reason.addEventListener("input", () => { reasonEdited = true; update(); });
  const toolbar = node("div");
  toolbar.className = "vendor-price-toolbar";
  toolbar.append(labelled("Replacement or additional product", select), add);
  form.append(help, progress, rows, toolbar, labelled("Delivery charge (Rs.)", delivery),
    labelled("Reason for changes (shown to the customer)", reason), preview, save);
  delivery.disabled = pickup;
  update();
  return {
    setPacking(packing) {
      if (!validPacking(packing)) throw new Error("Packing progress could not be verified.");
      order.packing = packing;
      pendingPacking = null;
      update();
    },
    setPackingBusy(value, productId, state) {
      pendingPacking = value ? { productId, state } : null;
      update();
    },
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
