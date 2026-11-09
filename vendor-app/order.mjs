import { products, vendor } from "./catalog.mjs";

export const MAX_QUANTITY = 99;
export const CART_KEY = "sai-baba-cart-v2";
export const DISCOUNT_PERCENT = 15;
export const MAX_WHATSAPP_URL_LENGTH = 1800;
export const money = value => new Intl.NumberFormat("en-IN", {
  style: "currency", currency: "INR",
  minimumFractionDigits: Number.isInteger(value) ? 0 : 2, maximumFractionDigits: 2,
}).format(value);

export function sanitizeCart(value, catalogue = products) {
  const byId = new Map(catalogue.map(product => [product.id, product]));
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The saved cart is not valid. Start a new cart.");
  }
  const cart = {};
  for (const [id, quantity] of Object.entries(value)) {
    if (!/^[1-9]\d*$/.test(id) || !byId.has(Number(id)) ||
        !Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
      throw new Error("The saved cart contains an invalid product or quantity. Start a new cart.");
    }
    cart[id] = quantity;
  }
  return cart;
}

export function cartLines(cart, catalogue = products) {
  const byId = new Map(catalogue.map(product => [product.id, product]));
  return Object.entries(sanitizeCart(cart, catalogue)).map(([id, quantity]) => ({
    ...byId.get(Number(id)), quantity, amount: Math.round(byId.get(Number(id)).price * 100) * quantity / 100,
  }));
}

export function pricing(cart, catalogue = products) {
  const subtotalPaise = cartLines(cart, catalogue).reduce((sum, line) => sum + Math.round(line.amount * 100), 0);
  if (!Number.isSafeInteger(subtotalPaise) || subtotalPaise > 2147483647) {
    throw new Error("This cart exceeds the supported request value. Reduce the quantities or contact the shop.");
  }
  const discountPaise = Math.round(subtotalPaise * DISCOUNT_PERCENT / 100);
  return {
    subtotal: subtotalPaise / 100,
    discount: discountPaise / 100,
    total: (subtotalPaise - discountPaise) / 100,
  };
}

export function total(cart, catalogue = products) {
  return pricing(cart, catalogue).total;
}

export function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function validateCustomer(input, today = localDate()) {
  const name = String(input.name ?? "").trim();
  const phone = String(input.phone ?? "").trim();
  const address = String(input.address ?? "").replace(/\r\n?/g, "\n").trim();
  const fulfilment = String(input.fulfilment ?? "");
  const preferredDate = String(input.preferredDate ?? "").trim();
  const notes = String(input.notes ?? "").trim();
  if (fulfilment !== "delivery" && fulfilment !== "pickup") {
    throw new Error("Choose free home delivery or store pickup.");
  }
  if (name.length < 2 || name.length > 80 || /[\r\n]/.test(name)) {
    throw new Error("Enter a customer name between 2 and 80 characters.");
  }
  const normalizedPhone = phone.replace(/[\s()-]/g, "").replace(/^(?:\+91|91)(?=\d{10}$)/, "");
  if (!/^[6-9]\d{9}$/.test(normalizedPhone)) {
    throw new Error("Enter a valid 10-digit Indian mobile number.");
  }
  if (address.length < 10 || address.length > 500) {
    throw new Error("Enter your full address between 10 and 500 characters.");
  }
  if (preferredDate && (!/^\d{4}-\d{2}-\d{2}$/.test(preferredDate) ||
      !Number.isFinite(Date.parse(`${preferredDate}T00:00:00Z`)) ||
      new Date(`${preferredDate}T00:00:00Z`).toISOString().slice(0, 10) !== preferredDate ||
      preferredDate < today)) {
    throw new Error(`Choose today or a future date for ${fulfilment === "delivery" ? "delivery" : "pickup"}.`);
  }
  if (notes.length > 500) throw new Error("Keep notes to 500 characters or fewer.");
  return { name, phone: normalizedPhone, address, fulfilment, preferredDate, notes };
}

export function createRequirement(cart, input, today, catalogue = { products, year: vendor.year }) {
  const lines = cartLines(cart, catalogue.products);
  if (!lines.length) throw new Error("Add at least one product to your cart.");
  const customer = validateCustomer(input, today);
  const amounts = pricing(cart, catalogue.products);
  const delivery = customer.fulfilment === "delivery";
  const arrangement = delivery ? "delivery" : "pickup";
  return [
    `New order request - ${vendor.name} (${catalogue.year})`,
    "",
    `Customer: ${customer.name}`,
    `Mobile: +91 ${customer.phone}`,
    `Delivery option: ${delivery ? "Free home delivery" : "Store pickup"}`,
    `Address: ${customer.address}`,
    ...(customer.preferredDate ? [`Preferred ${arrangement} date: ${customer.preferredDate}`] : []),
    "",
    ...lines.map(line => `#${line.id} ${line.name} | ${line.brand}\nPack: ${line.unit}\n${line.quantity} pack${line.quantity === 1 ? "" : "s"} x Rs.${line.price} = Rs.${line.amount}\n`),
    `Subtotal: Rs.${amounts.subtotal.toFixed(2)}`,
    `Discount applied (${DISCOUNT_PERCENT}%): -Rs.${amounts.discount.toFixed(2)}`,
    ...(delivery ? ["Delivery fee: Rs.0.00 (FREE)"] : []),
    `Estimated total: Rs.${amounts.total.toFixed(2)}`,
    ...(customer.notes ? ["", `Notes: ${customer.notes}`] : []),
    "",
    `Please confirm availability, final price and ${arrangement} arrangements.`,
    "This is an order request, not a confirmed order. No payment has been made.",
  ].join("\n");
}

export function whatsappUrl(message, phone = vendor.whatsapp) {
  if (!/^[1-9]\d{7,14}$/.test(phone)) throw new Error("The vendor WhatsApp number must include its country code.");
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

export function prepareOrderMessage(text, summary, phone = vendor.whatsapp, maxLength = MAX_WHATSAPP_URL_LENGTH) {
  if (typeof text !== "string" || !text) throw new Error("The order request message is empty.");
  const fullUrl = new URL(whatsappUrl(text, phone)).href;
  if (fullUrl.length <= maxLength) return { text, url: fullUrl, isSummary: false };
  if (typeof summary !== "string" || !summary) {
    throw new Error("The order tracker did not provide a WhatsApp summary. Keep checkout open and retry, or contact the shop.");
  }
  const url = new URL(whatsappUrl(summary, phone)).href;
  if (url.length > maxLength) {
    throw new Error("The order summary is too long to open in WhatsApp. Keep checkout open and contact the shop.");
  }
  return { text: summary, url, isSummary: true };
}

export function validatePdfLink(pdf, origin) {
  const error = "Your order request is saved, but its PDF link could not be confirmed. Keep checkout open and retry.";
  if (!pdf || typeof pdf.url !== "string" || typeof pdf.expiresAt !== "string") throw new Error(error);
  let url;
  try {
    url = new URL(pdf.url);
  } catch {
    throw new Error(error);
  }
  const expiry = new Date(pdf.expiresAt);
  const token = url.searchParams.get("token") ?? "";
  if (url.origin !== origin || url.username || url.password || url.hash || url.pathname !== "/api/order-pdf" ||
      [...url.searchParams].length !== 1 || !/^\d{8}\.[A-Za-z0-9_-]{43}$/.test(token) ||
      !Number.isFinite(expiry.getTime()) || expiry.toISOString() !== pdf.expiresAt ||
      token.slice(0, 8) !== pdf.expiresAt.slice(0, 10).replaceAll("-", "")) {
    throw new Error(error);
  }
  return { url: url.href, expiresAt: pdf.expiresAt };
}

// Bound the encoded URL, not character count; Unicode can expand substantially.
export function prepareMessages(text, phone = vendor.whatsapp, maxLength = MAX_WHATSAPP_URL_LENGTH) {
  if (!text) throw new Error("The order request message is empty.");
  if (whatsappUrl(text, phone).length <= maxLength) {
    return [{ text, url: whatsappUrl(text, phone) }];
  }
  const prefix = (part, count) => `Order request - part ${part} of ${count}\nPlease send all parts.\n\n`;
  const budget = maxLength - whatsappUrl(prefix(999, 999), phone).length;
  if (budget < 20) throw new Error("The WhatsApp URL limit is too small.");
  const chunks = [];
  let chunk = "";
  let size = 0;
  for (const line of text.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
    const lineSize = encodeURIComponent(line).length;
    if (chunk && size + lineSize > budget) {
      chunks.push(chunk);
      chunk = "";
      size = 0;
    }
    for (const character of line) {
      const length = encodeURIComponent(character).length;
      if (size + length > budget) {
        chunks.push(chunk);
        chunk = "";
        size = 0;
      }
      chunk += character;
      size += length;
    }
  }
  if (chunk) chunks.push(chunk);
  if (chunks.length > 999) throw new Error("This order request is too large to share. Reduce the notes or items in your cart.");
  return chunks.map((content, index) => {
    const message = prefix(index + 1, chunks.length) + content;
    return { text: message, url: whatsappUrl(message, phone) };
  });
}
