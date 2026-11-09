import { createHash } from "node:crypto";
import { ORDER_ID, ORDER_STATUSES } from "../../vendor-app/vendor-model.mjs";

export const IMPORT_FILE_BYTES = 512000;
export const IMPORT_REQUEST_BYTES = 524288;

export class ImportValidationError extends Error {}
export class ImportPreviewRollback extends Error {
  constructor(result) {
    super("Roll back the approved import preview.");
    this.result = result;
  }
}

export function approvedImportMetadata(statement, expectedHash) {
  if (typeof expectedHash !== "string" || !/^[a-f0-9]{64}$/.test(expectedHash)) {
    throw new ImportValidationError("The owner has not approved an import file.");
  }
  if (typeof statement !== "string" || Buffer.byteLength(statement) > IMPORT_FILE_BYTES ||
      createHash("sha256").update(statement).digest("hex") !== expectedHash) {
    throw new ImportValidationError("This file does not match the owner-approved import. Use the original file without editing it.");
  }
  const encoded = statement.match(/convert_from\(decode\('([a-f0-9]+)', 'hex'\)/)?.[1];
  let source;
  try {
    source = JSON.parse(Buffer.from(encoded ?? "", "hex").toString("utf8"));
  } catch {
    throw new ImportValidationError("Use a validated historical order import file, not general SQL.");
  }
  if (!Array.isArray(source) || !source.length || source.length > 100 ||
      !source.every(order => order && ORDER_ID.test(order.order_id ?? "") &&
        /^[a-f0-9]{64}$/.test(order.fingerprint ?? "") &&
        typeof order.created_at === "string" && Number.isFinite(Date.parse(order.created_at)) &&
        new Date(order.created_at).toISOString() === order.created_at &&
        ORDER_STATUSES.includes(order.status) &&
        typeof order.original_payload_hash_verified === "boolean" &&
        Number.isSafeInteger(order.total_paise) && order.total_paise >= 0 && order.total_paise <= 2147483647 &&
        Array.isArray(order.items) && order.items.length > 0) ||
      new Set(source.map(order => order.order_id)).size !== source.length) {
    throw new ImportValidationError("The approved file has invalid historical request metadata.");
  }
  const items = source.reduce((sum, order) => sum + order.items.length, 0);
  if (items > 2000) throw new ImportValidationError("Import at most 2,000 items in one approved batch.");
  return {
    source, hash: expectedHash, requests: source.length, items,
    totalPaise: source.reduce((sum, order) => sum + order.total_paise, 0),
    unverifiedSourceHashes: source.filter(order => !order.original_payload_hash_verified).length,
  };
}
