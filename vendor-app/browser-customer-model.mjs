import { CART_KEY, validateOrderShareLink } from "./order.mjs";
import { ORDER_STATUSES } from "./vendor-model.mjs";
import { validRevisionView } from "./order-revision-model.mjs";

const PHONE_KEY = "sai-baba-browser-phone-v1";
const HISTORY_PREFIX = "sai-baba-browser-requests-v1:";
const MAX_HISTORY = 50;
const ORDER_ID = /^SBC-[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/;

export function normalizeBrowserPhone(value) {
  let digits = String(value).replace(/[\s()+-]/g, "");
  if (/^91[6-9]\d{9}$/.test(digits)) digits = digits.slice(2);
  if (!/^[6-9]\d{9}$/.test(digits)) throw new Error("Enter a valid 10-digit Indian mobile number.");
  return digits;
}

export function validateDemoProfile(result, phone) {
  const profile = result?.profile;
  if (!result || result.mode !== "demo" || result.verified !== false || result.phone !== phone ||
      (profile !== null && (!profile || typeof profile.name !== "string" || profile.name.length > 80 ||
        typeof profile.address !== "string" || profile.address.length > 500 ||
        !["delivery", "pickup"].includes(profile.fulfilment)))) {
    throw new Error("Saved customer details could not be verified. Enter your details manually or retry.");
  }
  return profile;
}

function validCustomerOrder(order, phone) {
  return !!order && (order.revision === undefined || validRevisionView(order)) && order.phone === `+91 ${phone}` &&
    ["orderId", "createdAt", "status", "name", "address", "items", "notes", "fulfilment", "preferredDate"].every(key => typeof order[key] === "string") &&
    /^[A-Za-z0-9_-]{1,100}$/.test(order.orderId) && Number.isFinite(Date.parse(order.createdAt)) &&
    ORDER_STATUSES.includes(order.status) &&
    ["total", "subtotal", "discount", "deliveryCharge"].every(key => Number.isFinite(order[key]) && order[key] >= 0) &&
    Array.isArray(order.statusHistory) && order.statusHistory.every(entry => entry &&
      typeof entry.changedAt === "string" && Number.isFinite(Date.parse(entry.changedAt)) &&
      (entry.fromStatus === null || ORDER_STATUSES.includes(entry.fromStatus)) && ORDER_STATUSES.includes(entry.toStatus));
}

export function validateDemoOrder(result, phone, orderId) {
  if (!result || result.mode !== "demo" || result.verified !== false ||
      !validCustomerOrder(result.order, phone) || result.order.orderId !== orderId) {
    throw new Error("The order details could not be verified. Retry or contact the shop.");
  }
  return result.order;
}

export function validateDemoHistory(result, phone, page) {
  if (!result || result.mode !== "demo" || result.verified !== false || result.page !== page ||
      result.pageSize !== 20 || !Number.isSafeInteger(result.total) || result.total < 0 ||
      !Array.isArray(result.orders) || result.orders.length > 20 ||
      result.orders.some(order => !validCustomerOrder(order, phone))) {
    throw new Error("The order history response could not be verified. Retry or contact the shop.");
  }
  return result;
}

export function createBrowserCustomerStore({ session, storage, origin, cryptoImpl = globalThis.crypto }) {
  let phone = "";
  let historyKey = "";
  function readHistory() {
    if (!historyKey) throw new Error("Enter your mobile number before viewing browser requests.");
    const entries = JSON.parse(storage.getItem(historyKey) ?? "[]");
    if (!Array.isArray(entries) || entries.length > MAX_HISTORY) throw new Error("Saved links are unreadable. Use Clear saved links on this device to clear them.");
    return entries.map(entry => {
      if (!entry || !ORDER_ID.test(entry.orderId)) throw new Error("Saved links contain an invalid reference. Use Clear saved links on this device to clear them.");
      const share = validateOrderShareLink(entry, origin, entry.orderId, Date.parse(entry.expiresAt) - 1);
      return { orderId: entry.orderId, ...share };
    });
  }
  return {
    get phone() { return phone; },
    get cartKey() { return historyKey ? `${CART_KEY}:${historyKey.slice(HISTORY_PREFIX.length)}` : null; },
    async enter(value) {
      const normalized = normalizeBrowserPhone(value);
      const digest = await cryptoImpl.subtle.digest("SHA-256", new TextEncoder().encode(normalized));
      const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
      session.setItem(PHONE_KEY, normalized);
      phone = normalized;
      historyKey = HISTORY_PREFIX + hash;
      return phone;
    },
    async restore() {
      const previous = session.getItem(PHONE_KEY);
      return previous ? this.enter(previous) : "";
    },
    end() {
      session.removeItem(PHONE_KEY);
      phone = "";
      historyKey = "";
    },
    history: readHistory,
    remember(orderId, share) {
      if (!ORDER_ID.test(orderId)) throw new Error("The saved request reference is invalid.");
      const confirmed = validateOrderShareLink({ ...share, orderId }, origin, orderId);
      const entries = readHistory().filter(entry => entry.orderId !== orderId);
      entries.unshift({ orderId, ...confirmed });
      storage.setItem(historyKey, JSON.stringify(entries.slice(0, MAX_HISTORY)));
    },
    forget() {
      if (!historyKey) throw new Error("Enter your mobile number before clearing browser requests.");
      storage.removeItem(historyKey);
    },
  };
}
