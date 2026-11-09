import { validProductMedia, copyMedia } from "./media-model.mjs";

export function validYear(year) {
  return Number.isInteger(year) && year >= 2000 && year <= 9999;
}

export function validCatalogue(value) {
  if (!value || !validYear(value.year) || !Number.isSafeInteger(value.revision) ||
      value.revision < 0 || !Array.isArray(value.products) ||
      value.products.length < 1 || value.products.length > 200) return false;
  const ids = new Set();
  return value.products.every(product => {
    if (!product || !Number.isSafeInteger(product.id) || product.id < 1 || product.id > 999999 ||
        ids.has(product.id) || !Number.isFinite(product.price) || product.price < 0 ||
        product.price > 100000 || Math.abs(Math.round(product.price * 100) - product.price * 100) > 0.000001 ||
        !["name", "brand", "unit", "category"].every(key => typeof product[key] === "string" &&
          product[key].trim() === product[key] && product[key].length > 0 &&
          product[key].length <= 120 && !/[\u0000-\u001f\u007f]/.test(product[key])) ||
        !validProductMedia(product.media)) return false;
    ids.add(product.id);
    return true;
  });
}

export function catalogueProducts(products, publicView = false) {
  return products.map(({ id, name, brand, unit, price, category, media }) => ({
    id, name, brand, unit, price, category,
    ...(media?.length ? { media: media.map(asset => copyMedia(asset, publicView)) } : {}),
  }));
}
