import { createHash, randomBytes } from "node:crypto";
import { getStore } from "@netlify/blobs";
import { validOrder } from "../../vendor-app/vendor-model.mjs";

export const SHARE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const TOKEN = /^(\d{8})\.[A-Za-z0-9_-]{43}$/;
const KEY = /^shares\/(\d{8})\/[a-f0-9]{64}$/;
const FIELDS = ["orderId", "createdAt", "status", "name", "phone", "fulfilment", "total",
  "address", "preferredDate", "items", "subtotal", "discountPercent", "discount", "deliveryCharge", "notes", "couponCode"];
const day = date => date.toISOString().slice(0, 10).replaceAll("-", "");
const shareStore = () => getStore({ name: "order-shares", consistency: "strong" });
const iso = value => typeof value === "string" && Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value;

export function shareKey(token) {
  if (typeof token !== "string" || !TOKEN.test(token)) return null;
  const date = new Date(`${token.slice(0, 4)}-${token.slice(4, 6)}-${token.slice(6, 8)}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || day(date) !== token.slice(0, 8)) return null;
  return `shares/${token.slice(0, 8)}/${createHash("sha256").update(token).digest("hex")}`;
}

function validMetadata(metadata, key) {
  return iso(metadata?.expiresAt) && key.startsWith(`shares/${day(new Date(metadata.expiresAt))}/`);
}

export async function saveOrderShare({ order, origin, source = "vendor" }, { store = shareStore(), now = () => new Date() } = {}) {
  if (!validOrder(order, true) || !["vendor", "submission"].includes(source)) throw new Error("The shared request snapshot is invalid.");
  const sharedAt = now().toISOString();
  const expiresAt = new Date(Date.parse(sharedAt) + SHARE_TTL_MS).toISOString();
  const token = `${day(new Date(expiresAt))}.${randomBytes(32).toString("base64url")}`;
  const snapshot = { order: Object.fromEntries(FIELDS.filter(key => order[key] !== undefined).map(key => [key, order[key]])), sharedAt, expiresAt, source };
  const { modified } = await store.setJSON(shareKey(token), snapshot, { metadata: { expiresAt }, onlyIfNew: true });
  if (!modified) throw new Error("The shared request write was not acknowledged.");
  return { orderId: order.orderId, url: new URL(`/request/${token}`, origin).href, expiresAt };
}

export async function readOrderShare(token, { store = shareStore(), now = () => new Date() } = {}) {
  const key = shareKey(token);
  if (!key) return { status: 400 };
  const entry = await store.getWithMetadata(key, { type: "json", consistency: "strong" });
  if (!entry) return { status: 404 };
  if (!validMetadata(entry.metadata, key)) throw new Error("Invalid shared request metadata.");
  if (Date.parse(entry.metadata.expiresAt) <= now().getTime()) {
    try { await store.delete(key); }
    catch { console.error("Expired shared request deletion failed; access was denied. Scheduled cleanup will retry."); }
    return { status: 410 };
  }
  const snapshot = entry.data;
  if (!snapshot || !validOrder(snapshot.order, true) || !iso(snapshot.sharedAt) ||
      (snapshot.source !== undefined && !["vendor", "submission"].includes(snapshot.source)) ||
      snapshot.expiresAt !== entry.metadata.expiresAt ||
      Date.parse(snapshot.expiresAt) - Date.parse(snapshot.sharedAt) !== SHARE_TTL_MS) {
    throw new Error("Invalid shared request snapshot.");
  }
  return { status: 200, snapshot };
}

export async function removeExpiredOrderShares({ store = shareStore(), now = () => new Date() } = {}) {
  const instant = now();
  const today = day(instant);
  let deleted = 0;
  for await (const { blobs } of store.list({ prefix: "shares/", paginate: true })) {
    for (const { key } of blobs) {
      const match = KEY.exec(key);
      if (!match) throw new Error("Unexpected object in the private shared request store.");
      if (match[1] > today) continue;
      const entry = await store.getMetadata(key);
      if (!entry) continue;
      if (!validMetadata(entry.metadata, key)) throw new Error("Invalid shared request expiry metadata.");
      if (Date.parse(entry.metadata.expiresAt) > instant.getTime()) continue;
      await store.delete(key);
      deleted++;
    }
  }
  return deleted;
}
