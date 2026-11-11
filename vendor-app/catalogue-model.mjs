import { validProductMedia, copyMedia } from "./media-model.mjs";

export const PRODUCT_TYPES = Object.freeze([
  { id: "sound", label: "Sound" },
  { id: "sky", label: "Sky" },
  { id: "colour-light", label: "Colour & Light" },
  { id: "ground", label: "Ground" },
].map(type => Object.freeze(type)));

export function validProductTypes(types) {
  return types === undefined || (Array.isArray(types) && types.length <= PRODUCT_TYPES.length &&
    [...types].every(id => PRODUCT_TYPES.some(type => type.id === id)) && new Set(types).size === types.length);
}

export function validYear(year) {
  return Number.isInteger(year) && year >= 2000 && year <= 9999;
}

export function validCatalogue(value, { allowEmpty = false } = {}) {
  if (!value || !validYear(value.year) || !Number.isSafeInteger(value.revision) ||
      value.revision < 0 || !Array.isArray(value.products) ||
      value.products.length < (allowEmpty ? 0 : 1) || value.products.length > 200) return false;
  const ids = new Set();
  return value.products.every(product => {
    if (!product || !Number.isSafeInteger(product.id) || product.id < 1 || product.id > 999999 ||
        ids.has(product.id) || !Number.isFinite(product.price) || product.price < 0 ||
        product.price > 100000 || Math.abs(Math.round(product.price * 100) - product.price * 100) > 0.000001 ||
        !["name", "brand", "unit", "category"].every(key => typeof product[key] === "string" &&
          product[key].trim() === product[key] && product[key].length > 0 &&
          product[key].length <= 120 && !/[\u0000-\u001f\u007f]/.test(product[key])) ||
        (product.hidden !== undefined && typeof product.hidden !== "boolean") ||
        !validProductMedia(product.media) || !validProductTypes(product.types)) return false;
    ids.add(product.id);
    return true;
  });
}

export function catalogueProducts(products, publicView = false) {
  return products.filter(product => !publicView || product.hidden !== true)
    .map(({ id, name, brand, unit, price, category, media, hidden, types }) => ({
      id, name, brand, unit, price, category,
      ...(types?.length ? { types: [...types] } : {}),
      ...(!publicView && hidden === true ? { hidden: true } : {}),
      ...(media?.length ? { media: media.map(asset => copyMedia(asset, publicView)) } : {}),
    }));
}
