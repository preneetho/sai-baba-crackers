import { validOffers, validOfferVersion, isPublicCoupon } from "./offers-model.mjs";
import { money } from "./order.mjs";
import { renderOfferWidgets, initializeOfferCarousel } from "./offer-widgets.mjs";

const panel = document.getElementById("home-offers");
const status = document.getElementById("home-offers-status");
const retry = document.getElementById("home-offers-retry");
const list = document.getElementById("home-coupons");
const updateCarousel = initializeOfferCarousel(list, document.getElementById("home-offers-toggle"),
  document.getElementById("home-offers-dots"));
async function load() {
  retry.disabled = true;
  status.textContent = "Loading current offers...";
  try {
    const response = await fetch("/api/offers", { cache: "no-store", signal: AbortSignal.timeout(25000) });
    const result = await response.json();
    if (!response.ok || !validOffers(result.offers) || !validOfferVersion(result.version)) {
      throw new Error("Current offers could not be loaded. Check the cart before submitting.");
    }
    renderOfferWidgets(list, result.offers, document.getElementById("home-coupon-copy-status"));
    document.getElementById("home-coupon-help").textContent = result.offers.coupons.some(isPublicCoupon) ?
      "Enter one code in your cart. Discounts are not applied automatically." : "No coupon offers currently available.";
    const { freeDeliveryMinimum, deliveryFee } = result.offers;
    const delivery = freeDeliveryMinimum > 0 && deliveryFee > 0 ?
      `Free delivery on billed amounts of ${money(freeDeliveryMinimum)} or more after coupon discount. Below this, delivery is ${money(deliveryFee)}.` :
      "Free home delivery on all billed amounts.";
    for (const node of document.querySelectorAll("[data-delivery-terms]")) {
      node.textContent = `${delivery} Store pickup is free. We deliver across Hyderabad and aim for same-day delivery, subject to availability and shop confirmation.`;
    }
    status.textContent = "";
    panel.hidden = false;
    updateCarousel();
    retry.hidden = true;
  } catch (error) {
    status.textContent = error.message;
    panel.hidden = true;
    updateCarousel();
    retry.hidden = false;
  } finally { retry.disabled = false; }
}
retry.addEventListener("click", load);
load();
