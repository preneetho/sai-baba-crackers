export const ORDER_STATUSES = Object.freeze([
  "New", "Contacted", "Confirmed", "Preparing", "Out for delivery",
  "Ready for pickup", "Completed", "Cancelled",
]);
export const ORDER_ID = /^SBC-[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/;
export const PAGE_SIZE = 25;

export function validOrder(order, full = false) {
  if (!order || !ORDER_ID.test(order.orderId ?? "") || !ORDER_STATUSES.includes(order.status) ||
      typeof order.createdAt !== "string" || !Number.isFinite(Date.parse(order.createdAt)) ||
      new Date(order.createdAt).toISOString() !== order.createdAt ||
      !["name", "phone", "fulfilment"].every(key => typeof order[key] === "string") ||
      !Number.isFinite(order.total) || order.total < 0) return false;
  if (!full) return true;
  return ["address", "preferredDate", "items", "notes"].every(key => typeof order[key] === "string") &&
    ["subtotal", "discountPercent", "discount", "deliveryCharge"].every(key =>
      Number.isFinite(order[key]) && order[key] >= 0);
}
