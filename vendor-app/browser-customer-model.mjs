import { validateOrderShareLink } from "./order.mjs";

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

export function createBrowserCustomerStore({ session, storage, origin, cryptoImpl = globalThis.crypto }) {
  let phone = "";
  let historyKey = "";
  function readHistory() {
    if (!historyKey) throw new Error("Enter your mobile number before viewing browser requests.");
    const entries = JSON.parse(storage.getItem(historyKey) ?? "[]");
    if (!Array.isArray(entries) || entries.length > MAX_HISTORY) throw new Error("Browser history is unreadable. Use Forget history to clear it.");
    return entries.map(entry => {
      if (!entry || !ORDER_ID.test(entry.orderId)) throw new Error("Browser history has an invalid reference. Use Forget history to clear it.");
      const share = validateOrderShareLink(entry, origin, entry.orderId, Date.parse(entry.expiresAt) - 1);
      return { orderId: entry.orderId, ...share };
    });
  }
  return {
    get phone() { return phone; },
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
