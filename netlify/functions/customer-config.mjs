import { customerSettings, customerJson } from "../lib/customer-auth.mjs";

export function handleCustomerConfig(request, { env = process.env } = {}) {
  if (request.method !== "GET") return customerJson({ error: "Use GET." }, 405);
  if (new URL(request.url).search) return customerJson({ error: "Configuration does not accept query parameters." }, 400);
  try {
    const settings = customerSettings(env);
    return customerJson(settings.mode === "off" ? { mode: "off" } :
      { mode: "test", firebase: settings.firebase, testPhones: settings.testPhones });
  } catch (error) {
    console.error("Customer login configuration is incomplete.");
    return customerJson({ error: error.message }, 503);
  }
}
export default request => handleCustomerConfig(request);
export const config = { path: "/api/customer-config" };
