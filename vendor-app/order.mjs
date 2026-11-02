import { products, vendor } from "./catalog.mjs";

export const MAX_QUANTITY = 99;
export const CART_KEY = "sai-baba-cart-v1";
export const DISCOUNT_PERCENT = 15;
const byId = new Map(products.map(product => [product.id, product]));
export const money = value => new Intl.NumberFormat("en-IN", {
  style: "currency", currency: "INR",
  minimumFractionDigits: Number.isInteger(value) ? 0 : 2, maximumFractionDigits: 2,
}).format(value);

export function sanitizeCart(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The saved cart is not valid. Start a new selection.");
  }
  const cart = {};
  for (const [id, quantity] of Object.entries(value)) {
    if (!/^[1-9]\d*$/.test(id) || !byId.has(Number(id)) ||
        !Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
      throw new Error("The saved cart contains an invalid product or quantity. Start a new selection.");
    }
    cart[id] = quantity;
  }
  return cart;
}

export function cartLines(cart) {
  return Object.entries(sanitizeCart(cart)).map(([id, quantity]) => ({
    ...byId.get(Number(id)), quantity, amount: byId.get(Number(id)).price * quantity,
  }));
}

export function pricing(cart) {
  const subtotalPaise = cartLines(cart).reduce((sum, line) => sum + line.amount * 100, 0);
  const discountPaise = Math.round(subtotalPaise * DISCOUNT_PERCENT / 100);
  return {
    subtotal: subtotalPaise / 100,
    discount: discountPaise / 100,
    total: (subtotalPaise - discountPaise) / 100,
  };
}

export function total(cart) {
  return pricing(cart).total;
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

export function createRequirement(cart, input, today) {
  const lines = cartLines(cart);
  if (!lines.length) throw new Error("Add at least one product to your requirement.");
  const customer = validateCustomer(input, today);
  const amounts = pricing(cart);
  const delivery = customer.fulfilment === "delivery";
  const arrangement = delivery ? "delivery" : "pickup";
  return [
    `New requirement - ${vendor.name} (${vendor.year} catalogue)`,
    "",
    `Customer: ${customer.name}`,
    `Mobile: +91 ${customer.phone}`,
    `Fulfilment: ${delivery ? "Free home delivery" : "Store pickup"}`,
    `Address: ${customer.address}`,
    ...(customer.preferredDate ? [`Preferred ${arrangement} date: ${customer.preferredDate}`] : []),
    "",
    ...lines.map(line => `#${line.id} ${line.name} | ${line.brand}\nPack: ${line.unit}\n${line.quantity} selling unit(s) x Rs.${line.price} = Rs.${line.amount}\n`),
    `Subtotal: Rs.${amounts.subtotal.toFixed(2)}`,
    `Discount applied (${DISCOUNT_PERCENT}%): -Rs.${amounts.discount.toFixed(2)}`,
    ...(delivery ? ["Home delivery charge: Rs.0.00 (FREE)"] : []),
    `Estimated total after discount: Rs.${amounts.total.toFixed(2)}`,
    ...(customer.notes ? ["", `Notes: ${customer.notes}`] : []),
    "",
    `Please confirm availability, final price and ${arrangement} arrangements.`,
    "This is an enquiry, not a confirmed order. No payment has been made.",
  ].join("\n");
}

export function whatsappUrl(message, phone = vendor.whatsapp) {
  if (!/^[1-9]\d{7,14}$/.test(phone)) throw new Error("The vendor WhatsApp number must include its country code.");
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

// Bound the encoded URL, not character count; Unicode can expand substantially.
export function prepareMessages(text, phone = vendor.whatsapp, maxLength = 1800) {
  if (!text) throw new Error("The requirement message is empty.");
  if (whatsappUrl(text, phone).length <= maxLength) {
    return [{ text, url: whatsappUrl(text, phone) }];
  }
  const prefix = (part, count) => `Requirement - part ${part} of ${count}\nPlease send all parts.\n\n`;
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
  if (chunks.length > 999) throw new Error("This requirement is too large to share. Reduce the notes or selection.");
  return chunks.map((content, index) => {
    const message = prefix(index + 1, chunks.length) + content;
    return { text: message, url: whatsappUrl(message, phone) };
  });
}
