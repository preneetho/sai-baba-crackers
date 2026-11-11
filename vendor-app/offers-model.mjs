export const DEFAULT_OFFERS = Object.freeze({
  coupons: Object.freeze([]), freeDeliveryMinimum: 0, deliveryFee: 0,
});
export const validOfferVersion = value => value === null ||
  (typeof value === "string" && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value));
export const normalizeCoupon = value => typeof value === "string" ? value.trim().toUpperCase() : "";
export const isPublicCoupon = coupon => coupon.enabled && coupon.showOnWebsite !== false;
const amount = value => Number.isFinite(value) && value >= 0 && value <= 10000000 &&
  Math.abs(Math.round(value * 100) / 100 - value) < 0.0000001;

export function validOffers(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === 3 && Array.isArray(value.coupons) && value.coupons.length <= 20 &&
    amount(value.freeDeliveryMinimum) && amount(value.deliveryFee) &&
    value.coupons.every(coupon => coupon &&
      Object.keys(coupon).every(key => ["code", "percent", "enabled", "showOnWebsite"].includes(key)) &&
      typeof coupon.code === "string" && /^[A-Z0-9][A-Z0-9_-]{1,23}$/.test(coupon.code) &&
      Number.isInteger(coupon.percent) && coupon.percent >= 1 && coupon.percent <= 100 &&
      typeof coupon.enabled === "boolean" &&
      (!Object.hasOwn(coupon, "showOnWebsite") || typeof coupon.showOnWebsite === "boolean")) &&
    new Set(value.coupons.map(coupon => coupon.code)).size === value.coupons.length);
}

export function checkOffers(value) {
  if (!validOffers(value)) {
    throw new Error("Use up to 20 unique coupon codes (2-24 letters, numbers, - or _), whole discounts from 1-100%, and non-negative rupee amounts with at most two decimal places.");
  }
  return value;
}

export function couponOffer(offers, code) {
  checkOffers(offers);
  if (typeof code !== "string" || code.length > 24) throw new Error("Enter a valid coupon code.");
  const normalized = normalizeCoupon(code);
  if (!normalized) return null;
  const coupon = offers.coupons.find(value => value.enabled && value.code === normalized);
  if (!coupon) throw new Error("This coupon is invalid or no longer active. Check the code or remove it.");
  return coupon;
}
