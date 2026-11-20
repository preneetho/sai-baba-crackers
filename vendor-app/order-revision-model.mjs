export function calculateRevision(items, discountPercent, deliveryCharge) {
  const cents = value => {
    const result = Math.round(value * 100);
    if (!Number.isFinite(value) || value < 0 || value > 100000 ||
        Math.abs(result / 100 - value) > 0.0000001) throw new Error("Use amounts from Rs.0 to Rs.100,000 with at most two decimal places.");
    return result;
  };
  if (!Array.isArray(items) || items.length < 1 || items.length > 200) {
    throw new Error("Keep at least one available item, or cancel the request if nothing can be supplied.");
  }
  const ids = new Set();
  let subtotalPaise = 0;
  const lines = items.map(item => {
    if (!item || !Number.isSafeInteger(item.id) || item.id < 1 || ids.has(item.id) ||
        !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 99) {
      throw new Error("Use distinct products with quantities from 1 to 99 selling packs.");
    }
    ids.add(item.id);
    const amountPaise = cents(item.price) * item.quantity;
    subtotalPaise += amountPaise;
    return { ...item, amount: amountPaise / 100 };
  });
  if (!Number.isInteger(discountPercent) || discountPercent < 0 || discountPercent > 100) {
    throw new Error("The saved discount percentage is invalid. Reload the request.");
  }
  const discountPaise = Math.round(subtotalPaise * discountPercent / 100);
  const deliveryPaise = cents(deliveryCharge);
  const totalPaise = subtotalPaise - discountPaise + deliveryPaise;
  if (!Number.isSafeInteger(subtotalPaise) || subtotalPaise > 2147483647 || totalPaise > 2147483647) {
    throw new Error("The revised amount exceeds the order register's limit.");
  }
  return {
    items: lines, subtotal: subtotalPaise / 100, discountPercent,
    discount: discountPaise / 100, deliveryCharge, total: totalPaise / 100,
  };
}

export function revisionInputError(input) {
  if (!input || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0 ||
      typeof input.reason !== "string" || !input.reason.trim() || input.reason.trim().length > 500 ||
      /[\u0000-\u0008\u000b-\u001f\u007f]/.test(input.reason)) return "Enter a revision reason (up to 500 characters) and reload the saved order version.";
  if (!Number.isInteger(input.catalogue?.year) || input.catalogue.year < 2000 || input.catalogue.year > 9999 ||
      !Number.isSafeInteger(input.catalogue.revision) || input.catalogue.revision < 1) return "Reload the replacement catalogue before saving.";
  try { calculateRevision(input.items, 0, input.deliveryCharge); }
  catch (error) { return error.message; }
  return "";
}

export function validRevisionView(order) {
  if (!Number.isSafeInteger(order.revision) || order.revision < 0 || !Array.isArray(order.revisionHistory)) return false;
  const validSnapshot = snapshot => {
    try {
      const result = calculateRevision(snapshot.items, snapshot.discountPercent, snapshot.deliveryCharge);
      const discountPaise = Math.round(snapshot.discount * 100);
      return result.items.every((item, index) =>
        ["name", "brand", "unit"].every(key => typeof item[key] === "string" && item[key].length <= 240) &&
        item.name.trim() && item.unit.trim() && item.amount === snapshot.items[index].amount) &&
        result.subtotal === snapshot.subtotal && Number.isFinite(snapshot.discount) &&
        snapshot.discount >= 0 && snapshot.discount <= snapshot.subtotal &&
        Math.abs(discountPaise / 100 - snapshot.discount) <= 0.0000001 &&
        Math.round(snapshot.total * 100) === Math.round(snapshot.subtotal * 100) -
          discountPaise + Math.round(snapshot.deliveryCharge * 100) &&
        Math.abs(Math.round(snapshot.total * 100) / 100 - snapshot.total) <= 0.0000001;
    } catch { return false; }
  };
  if (!validSnapshot({ ...order, items: order.lineItems })) return false;
  return (order.revisionHistory.length === 0 || order.revisionHistory.length === order.revision + 1) &&
    order.revisionHistory.every((entry, index) => entry?.revision === index &&
      typeof entry.changedAt === "string" && Number.isFinite(Date.parse(entry.changedAt)) &&
      typeof entry.reason === "string" && entry.reason.trim().length > 0 && entry.reason.length <= 500 &&
      validSnapshot(entry));
}

export function revisionAcknowledged(order, input) {
  return validRevisionView(order) && order.orderId === input.orderId &&
    order.revision === input.expectedRevision + 1 && order.status === input.expectedStatus &&
    order.deliveryCharge === input.deliveryCharge && order.lineItems.length === input.items.length &&
    order.lineItems.every((item, index) => ["id", "quantity", "price"].every(key => item[key] === input.items[index][key])) &&
    order.revisionHistory.length === order.revision + 1 &&
    order.revisionHistory.at(-1).reason === input.reason.trim();
}

export function revisionFields(order) {
  const lines = items => items.map(({ id, name, brand, unit, quantity, price, amount }) =>
    ({ id, name, brand, unit, quantity, price, amount }));
  return {
    revision: order.revision, lineItems: lines(order.lineItems),
    revisionHistory: order.revisionHistory.map(({ revision, changedAt, reason, items,
      subtotal, discountPercent, discount, deliveryCharge, total }) =>
      ({ revision, changedAt, reason, items: lines(items), subtotal, discountPercent, discount, deliveryCharge, total })),
  };
}
