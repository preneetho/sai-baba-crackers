export const PACKING_STATES = Object.freeze(["Not started", "Packing", "Packed"]);

export function validPacking(value) {
  return value && Number.isSafeInteger(value.version) && value.version >= 0 &&
    Array.isArray(value.items) && value.items.length <= 200 &&
    new Set(value.items.map(item => item?.id)).size === value.items.length &&
    value.items.every(item => Number.isSafeInteger(item?.id) && item.id > 0 &&
      PACKING_STATES.includes(item.state));
}

export function validPackingInput(input) {
  return input && Number.isSafeInteger(input.expectedRevision) && input.expectedRevision >= 0 &&
    Number.isSafeInteger(input.expectedPackingVersion) && input.expectedPackingVersion >= 0 &&
    Number.isSafeInteger(input.productId) && input.productId > 0 && PACKING_STATES.includes(input.state);
}
