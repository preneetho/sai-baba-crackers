import { vendorSettings, vendorJson, vendorSession, sameOriginMutation, seal, unseal } from "../lib/vendor-auth.mjs";
import { orderBackend } from "../lib/order-backend.mjs";
import { approvedImportMetadata, ImportValidationError, IMPORT_FILE_BYTES, IMPORT_REQUEST_BYTES } from "../lib/approved-import.mjs";
import { validImportSummary } from "../../vendor-app/vendor-model.mjs";

export async function handleVendorImport(request, {
  env = process.env, now = Date.now,
  databaseFactory = async () => (await import("../lib/order-database.mjs")).getOrderDatabase(),
} = {}) {
  const settings = vendorSettings(env);
  if (!settings || new URL(request.url).origin !== settings.origin) {
    return vendorJson({ error: "Vendor access is not configured for this site." }, 503);
  }
  const session = vendorSession(request, settings, now());
  if (!session) return vendorJson({ error: "Your vendor session has expired or access was removed. Sign in again." }, 401);
  if (!["GET", "POST"].includes(request.method)) return vendorJson({ error: "Use GET or POST." }, 405);
  const enabled = orderBackend(env)?.name === "netlify-db" &&
    /^[a-f0-9]{64}$/.test(env.VENDOR_IMPORT_SQL_SHA256 ?? "");
  if (request.method === "GET") return vendorJson({
    enabled, maxFileBytes: IMPORT_FILE_BYTES,
    message: enabled ? "Only the exact owner-approved historical import file can be used." :
      "Historical import is disabled. The owner must configure VENDOR_IMPORT_SQL_SHA256 with the Netlify Database backend and redeploy.",
  });
  if (!sameOriginMutation(request, settings, session)) {
    return vendorJson({ error: "Refresh the dashboard before importing requests." }, 403);
  }
  if (!enabled) return vendorJson({ error: "Historical import is not enabled for this deployment." }, 503);
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
    return vendorJson({ error: "Send the approved import as JSON." }, 415);
  }
  if (Number(request.headers.get("content-length")) > IMPORT_REQUEST_BYTES) {
    return vendorJson({ error: "The import file is too large." }, 413);
  }
  let input;
  try {
    const text = await request.text();
    if (Buffer.byteLength(text) > IMPORT_REQUEST_BYTES) return vendorJson({ error: "The import file is too large." }, 413);
    input = JSON.parse(text);
  } catch {
    return vendorJson({ error: "The import request could not be read." }, 400);
  }
  if (!input || !["preview", "import"].includes(input.action)) {
    return vendorJson({ error: "Preview the approved import before committing it." }, 400);
  }
  let metadata;
  try {
    metadata = approvedImportMetadata(input.sql, env.VENDOR_IMPORT_SQL_SHA256);
  } catch (error) {
    if (!(error instanceof ImportValidationError)) throw error;
    return vendorJson({ error: error.message }, 400);
  }
  if (input.action === "import") {
    const receipt = unseal(input.receipt, "import-preview", settings, now());
    if (input.acknowledge !== true || !receipt || receipt.hash !== metadata.hash ||
        receipt.sub !== session.sub || receipt.csrf !== session.csrf) {
      return vendorJson({ error: "Preview this file again and acknowledge the historical values before importing." }, 403);
    }
  }
  try {
    const result = await (await databaseFactory()).importApprovedSql(
      input.sql, env.VENDOR_IMPORT_SQL_SHA256, session.email, input.action === "preview",
    );
    if (!validImportSummary(result) || result.requests !== metadata.requests ||
        result.items !== metadata.items || result.totalPaise !== metadata.totalPaise ||
        result.unverifiedSourceHashes !== metadata.unverifiedSourceHashes) {
      throw new Error("Historical import was not acknowledged.");
    }
    const summary = Object.fromEntries(["requests", "items", "totalPaise", "newRequests", "newItems",
      "existingRequestsUnchanged", "statusDifferencesPreserved", "statusCounts", "unverifiedSourceHashes"]
      .map(key => [key, result[key]]));
    if (input.action === "preview") return vendorJson({
      ...summary, previewed: true, rolledBack: true,
      receipt: seal({ hash: metadata.hash, sub: session.sub, csrf: session.csrf,
        exp: now() + 15 * 60 * 1000 }, "import-preview", settings),
    });
    return vendorJson({ ...summary, imported: true });
  } catch (error) {
    const code = [error?.code, error?.cause?.code]
      .find(value => typeof value === "string" && /^[A-Z0-9]{5}$/.test(value)) ?? "IMPORT_FAILED";
    console.error("Approved historical import was not confirmed.", {
      code,
    });
    return vendorJson({ error: code === "P0001" ?
      "The import conflicts with the existing register or failed reconciliation. Nothing was overwritten. Ask the owner to reconcile the source." :
      "The database could not confirm the import. Check the register before retrying the same file; matching requests will not be duplicated." },
    code === "P0001" ? 409 : 503);
  }
}

export default async request => handleVendorImport(request);
export const config = {
  path: "/api/vendor-import",
  rateLimit: { windowLimit: 10, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
