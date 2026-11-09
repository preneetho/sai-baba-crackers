export const ORDER_STATUSES = Object.freeze([
  "New", "Contacted", "Confirmed", "Preparing", "Out for delivery",
  "Ready for pickup", "Completed", "Cancelled",
]);
export const ORDER_ID = /^SBC-[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/;
export const PAGE_SIZE = 25;

export function validImportSummary(result) {
  return Boolean(result && ["requests", "items", "totalPaise", "newRequests", "newItems",
    "existingRequestsUnchanged", "statusDifferencesPreserved", "unverifiedSourceHashes"]
    .every(key => Number.isSafeInteger(result[key]) && result[key] >= 0) &&
    result.requests > 0 && result.requests <= 100 && result.items > 0 && result.items <= 2000 &&
    result.newRequests + result.existingRequestsUnchanged === result.requests &&
    result.newItems <= result.items && result.statusDifferencesPreserved <= result.requests &&
    result.unverifiedSourceHashes <= result.requests && result.statusCounts &&
    typeof result.statusCounts === "object" && !Array.isArray(result.statusCounts) &&
    Object.keys(result.statusCounts).every(status => ORDER_STATUSES.includes(status) &&
      Number.isInteger(result.statusCounts[status]) && result.statusCounts[status] >= 0) &&
    Object.values(result.statusCounts).reduce((sum, count) => sum + count, 0) === result.requests);
}

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
