import { customerSession } from "./customer-client.mjs";

const note = document.querySelector("#customer-test-note");
try {
  const session = await customerSession();
  if (session.config.mode === "test") {
    note.hidden = false;
    document.querySelector("#submit-requirement").textContent = "Save test request";
    document.querySelector("#submit-requirement").dataset.customerMode = "test";
    document.querySelector("#checkout-agreement").textContent = "By continuing, you agree to save fictional customer details and this test request to your test account. No real order or shared link is created.";
    document.querySelector("#whatsapp-send-help").textContent = "Test mode only. Nothing will be sent to the shop.";
    document.querySelector(".privacy-note").textContent = "Firebase processes the fictional phone number for authentication. Your test request is stored in Netlify Database and is visible only to this customer account, not in the shop's real-order register. No PDF, public details link or WhatsApp handoff is created. Sign out on shared devices.";
    session.sdk.onAuthStateChanged(session.auth, user => {
      document.querySelector("#customer-login-note").hidden = !!user;
      note.textContent = user ? `TEST MODE: signed in as ${user.phoneNumber}. No real order or WhatsApp message will be sent.` :
        "TEST MODE: sign in with a configured Firebase fictional number before saving. No real SMS or orders.";
      const input = document.querySelector('input[name="phone"]');
      if (user && !input.value && session.config.testPhones.includes(user.phoneNumber)) {
        input.value = user.phoneNumber.slice(3);
      }
    }, () => {
      note.textContent = "Your login state could not be confirmed. Reload this page before submitting.";
      document.querySelector("#customer-login-note").hidden = false;
    });
  }
} catch (error) {
  note.hidden = false;
  note.textContent = `${error.message} Your cart is kept. Open My Orders or reload to retry.`;
  document.querySelector("#customer-login-note").hidden = false;
}
