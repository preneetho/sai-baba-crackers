import { createHash, createHmac } from "node:crypto";
import { getStore } from "@netlify/blobs";

export const PDF_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const TOKEN = /^(\d{8})\.[A-Za-z0-9_-]{43}$/;
const KEY = /^receipts\/(\d{8})\/[a-f0-9]{64}$/;
const ORDER_ID = /^SBC-[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/;
const day = date => date.toISOString().slice(0, 10).replaceAll("-", "");

export function pdfStore() {
  return getStore({ name: "order-pdfs", consistency: "strong" });
}

export function pdfKey(token) {
  if (typeof token !== "string" || !TOKEN.test(token)) return null;
  const date = `${token.slice(0, 4)}-${token.slice(4, 6)}-${token.slice(6, 8)}`;
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || day(parsed) !== token.slice(0, 8)) return null;
  return `receipts/${token.slice(0, 8)}/${createHash("sha256").update(token).digest("hex")}`;
}

function validMetadata(metadata, key) {
  if (!metadata || !ORDER_ID.test(metadata.orderId) || typeof metadata.expiresAt !== "string") return false;
  const expiry = new Date(metadata.expiresAt);
  return Number.isFinite(expiry.getTime()) && expiry.toISOString() === metadata.expiresAt &&
    key.startsWith(`receipts/${day(expiry)}/`);
}

export async function saveOrderPdf({ order, message, savedAt, origin, secret }, {
  store = pdfStore(), now = () => new Date(),
  generatePdf = async (...args) => (await import("./pdf.mjs")).generateOrderPdf(...args),
} = {}) {
  const expiresAt = new Date(savedAt.getTime() + PDF_TTL_MS).toISOString();
  if (new Date(expiresAt).getTime() <= now().getTime()) {
    const error = new Error("This order's seven-day PDF link has expired. Contact the shop with the request ID.");
    error.code = "PDF_EXPIRED";
    throw error;
  }
  const signature = createHmac("sha256", secret).update(JSON.stringify([
    "order-pdf-v1", order.orderId, order.fingerprint, savedAt.toISOString(), expiresAt,
  ])).digest("base64url");
  const token = `${day(new Date(expiresAt))}.${signature}`;
  const key = pdfKey(token);
  const existing = await store.getMetadata(key);
  if (existing && (!validMetadata(existing.metadata, key) ||
      existing.metadata.orderId !== order.orderId || existing.metadata.expiresAt !== expiresAt)) {
    throw new Error("The stored order PDF metadata is inconsistent.");
  }
  if (!existing) {
    const pdf = await generatePdf(message, order.orderId, savedAt.toISOString());
    const { modified } = await store.set(key, new Blob([pdf], { type: "application/pdf" }), {
      metadata: { orderId: order.orderId, expiresAt }, onlyIfNew: true,
    });
    if (!modified) {
      const confirmed = await store.getMetadata(key);
      if (!confirmed || !validMetadata(confirmed.metadata, key) ||
          confirmed.metadata.orderId !== order.orderId || confirmed.metadata.expiresAt !== expiresAt) {
        throw new Error("The order PDF write was not acknowledged.");
      }
    }
  }
  const url = new URL("/api/order-pdf", origin);
  url.searchParams.set("token", token);
  return { url: url.href, expiresAt };
}

export async function readOrderPdf(token, { store = pdfStore(), now = () => new Date() } = {}) {
  const key = pdfKey(token);
  if (!key) return { status: 400 };
  const entry = await store.getWithMetadata(key, { type: "arrayBuffer", consistency: "strong" });
  if (!entry) return { status: 404 };
  if (!validMetadata(entry.metadata, key)) throw new Error("Invalid order PDF metadata.");
  if (new Date(entry.metadata.expiresAt).getTime() <= now().getTime()) {
    try {
      await store.delete(key);
    } catch {
      console.error("Expired order PDF deletion failed; access was denied. Scheduled cleanup will retry.");
    }
    return { status: 410 };
  }
  const data = Buffer.from(entry.data);
  if (data.subarray(0, 5).toString() !== "%PDF-") throw new Error("Invalid stored order PDF content.");
  return { status: 200, data, orderId: entry.metadata.orderId };
}

export async function removeExpiredOrderPdfs({ store = pdfStore(), now = () => new Date() } = {}) {
  const instant = now();
  const today = day(instant);
  let deleted = 0;
  for await (const { blobs } of store.list({ prefix: "receipts/", paginate: true })) {
    for (const { key } of blobs) {
      const match = KEY.exec(key);
      if (!match) throw new Error("Unexpected object in the private order PDF store.");
      if (match[1] > today) continue;
      if (match[1] === today) {
        const entry = await store.getMetadata(key);
        if (!entry) continue;
        if (!validMetadata(entry.metadata, key)) throw new Error("Invalid order PDF expiry metadata.");
        if (new Date(entry.metadata.expiresAt).getTime() > instant.getTime()) continue;
      }
      await store.delete(key);
      deleted++;
    }
  }
  return deleted;
}
