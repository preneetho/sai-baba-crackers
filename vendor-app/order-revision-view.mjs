import { money, sellingPack } from "./order.mjs";

function revisionChanges(previous, current) {
  const before = new Map(previous.items.map(item => [item.id, item]));
  const after = new Map(current.items.map(item => [item.id, item]));
  const changes = [];
  for (const [id, item] of before) {
    const updated = after.get(id);
    if (!updated) {
      changes.push(`Removed: #${id} ${item.name} (${sellingPack(item.unit, item.quantity).count}; ${money(item.amount)}).`);
      continue;
    }
    const fields = [];
    if (item.quantity !== updated.quantity) fields.push(`quantity ${sellingPack(item.unit, item.quantity).count} to ${sellingPack(updated.unit, updated.quantity).count}`);
    if (item.price !== updated.price) fields.push(`unit price ${money(item.price)} to ${money(updated.price)}`);
    for (const key of ["name", "brand", "unit"]) {
      if (item[key] !== updated[key]) fields.push(`${key === "unit" ? "pack" : key}: ${item[key]} to ${updated[key]}`);
    }
    if (fields.length) changes.push(`Changed: #${id} ${updated.name} - ${fields.join("; ")}. Line total ${money(item.amount)} to ${money(updated.amount)}.`);
  }
  for (const [id, item] of after) {
    if (!before.has(id)) changes.push(`Added: #${id} ${item.name} (${sellingPack(item.unit, item.quantity).count}; ${money(item.amount)}).`);
  }
  const itemCount = changes.length;
  for (const [key, label] of [["deliveryCharge", "Delivery fee"], ["discount", "Discount"], ["subtotal", "Subtotal"]]) {
    if (previous[key] !== current[key]) changes.push(`${label}: ${money(previous[key])} to ${money(current[key])}.`);
  }
  if (previous.discountPercent !== current.discountPercent) {
    changes.push(`Discount percentage: ${previous.discountPercent}% to ${current.discountPercent}%.`);
  }
  const delta = Math.round(current.total * 100) - Math.round(previous.total * 100);
  const total = delta === 0 ? "total unchanged" :
    `total ${delta < 0 ? "reduced" : "increased"} by ${money(Math.abs(delta) / 100)}`;
  return { changes, summary: `${itemCount} product line${itemCount === 1 ? "" : "s"} changed; ${total}.` };
}

export function renderRevisionHistory(order, container) {
  const document = container.ownerDocument;
  container.replaceChildren();
  const heading = document.createElement("h4");
  heading.textContent = "Item and price revision history";
  container.append(heading);
  if (!order.revisionHistory?.length) {
    const note = document.createElement("p");
    note.textContent = "No item or price changes have been recorded. This is the original customer request.";
    container.append(note);
    return;
  }
  if (order.revisionHistory.length > 1) {
    const latest = order.revisionHistory.at(-1);
    const overview = document.createElement("section");
    overview.className = "revision-change-summary";
    const title = document.createElement("h5");
    title.textContent = `Latest update - revision ${latest.revision}`;
    const comparison = revisionChanges(order.revisionHistory.at(-2), latest);
    const summary = document.createElement("p");
    summary.textContent = `${comparison.summary} Compared with the previous version.`;
    const reason = document.createElement("p");
    reason.textContent = `Shop's reason: ${latest.reason}`;
    const list = document.createElement("ul");
    for (const change of comparison.changes) {
      const item = document.createElement("li");
      item.textContent = change;
      list.append(item);
    }
    overview.append(title, summary, reason, list);
    container.append(overview);
  }
  for (const [index, revision] of order.revisionHistory.entries()) {
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    const date = new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short",
    }).format(new Date(revision.changedAt));
    summary.textContent = `${revision.revision === 0 ? "Original request" : `Revision ${revision.revision}`}${revision.revision === order.revision ? " (latest)" : ""} - ${date} IST - ${money(revision.total)}`;
    const reason = document.createElement("p");
    reason.textContent = revision.reason;
    const items = document.createElement("pre");
    items.className = "order-revision-items";
    items.textContent = revision.items.map(item =>
      `#${item.id} ${item.name} | ${item.brand}\n${sellingPack(item.unit).description}\n${sellingPack(item.unit, item.quantity).count} x ${money(item.price)} = ${money(item.amount)}`).join("\n\n");
    const amounts = document.createElement("p");
    amounts.textContent = `Subtotal: ${money(revision.subtotal)}; discount (${revision.discountPercent}%): ${money(revision.discount)}; delivery: ${money(revision.deliveryCharge)}; total: ${money(revision.total)}.`;
    details.append(summary, reason, items, amounts);
    if (index > 0) {
      const comparison = revisionChanges(order.revisionHistory[index - 1], revision);
      const changes = document.createElement("ul");
      changes.className = "revision-change-summary";
      const title = document.createElement("p");
      title.textContent = `Changes from previous version: ${comparison.summary}`;
      details.append(title);
      for (const change of comparison.changes) {
        const item = document.createElement("li");
        item.textContent = change;
        changes.append(item);
      }
      details.append(changes);
    }
    container.append(details);
  }
}
