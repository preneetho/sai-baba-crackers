import { initializeBrowserCustomer } from "./browser-customer.mjs";

initializeBrowserCustomer().catch(() => {
  console.error("Phone-entry controls could not be initialized.");
  const status = document.querySelector("#browser-session-status");
  status.textContent = "Phone-entry controls could not load. Reload this page before continuing.";
  document.querySelector("main").inert = true;
});
