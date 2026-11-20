import { money } from "./order.mjs";

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
  for (const revision of order.revisionHistory) {
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
      `#${item.id} ${item.name} | ${item.brand}\nPack: ${item.unit}\n${item.quantity} x ${money(item.price)} = ${money(item.amount)}`).join("\n\n");
    const amounts = document.createElement("p");
    amounts.textContent = `Subtotal: ${money(revision.subtotal)}; discount (${revision.discountPercent}%): ${money(revision.discount)}; delivery: ${money(revision.deliveryCharge)}; total: ${money(revision.total)}.`;
    details.append(summary, reason, items, amounts);
    container.append(details);
  }
}
