import { sheetSettings } from "./sheets.mjs";

export function orderBackend(env) {
  const name = env.ORDER_BACKEND ?? "sheets";
  if (name === "sheets") {
    const connection = sheetSettings(env);
    return connection ? { name, connection, secret: connection.secret, maxPage: 400 } : null;
  }
  if (name === "netlify-db" && typeof env.ORDER_PDF_SECRET === "string" && env.ORDER_PDF_SECRET.length >= 32) {
    return { name, secret: env.ORDER_PDF_SECRET, maxPage: 100000 };
  }
  return null;
}
