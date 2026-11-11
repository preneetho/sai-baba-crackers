import { validOffers, validOfferVersion, isPublicCoupon } from "./offers-model.mjs";
import { money } from "./order.mjs";

const panel = document.getElementById("home-offers");
const status = document.getElementById("home-offers-status");
const retry = document.getElementById("home-offers-retry");
async function load() {
  retry.disabled = true;
  status.textContent = "Loading current offers...";
  try {
    const response = await fetch("/api/offers", { cache: "no-store", signal: AbortSignal.timeout(25000) });
    const result = await response.json();
    if (!response.ok || !validOffers(result.offers) || !validOfferVersion(result.version)) {
      throw new Error("Current offers could not be loaded. Check the cart before submitting.");
    }
    const list = document.getElementById("home-coupons");
    list.replaceChildren(...result.offers.coupons.filter(isPublicCoupon).map(coupon => {
      const item = document.createElement("li");
      const label = document.createElement("span");
      label.textContent = `${coupon.percent}% off with code ${coupon.code}`;
      const copy = document.createElement("button");
      copy.type = "button";
      copy.className = "button secondary";
      copy.textContent = "Copy code";
      copy.setAttribute("aria-label", `Copy coupon ${coupon.code}`);
      copy.addEventListener("click", async () => {
        copy.disabled = true;
        const feedback = document.getElementById("home-coupon-copy-status");
        try {
          if (!navigator.clipboard?.writeText) throw new Error("Clipboard access is unavailable.");
          await navigator.clipboard.writeText(coupon.code);
          copy.textContent = "Copied";
          feedback.textContent = `${coupon.code} copied. Paste it into the coupon field in your cart.`;
        } catch {
          copy.textContent = "Copy code";
          feedback.textContent = `Could not copy automatically. Select and copy ${coupon.code} above.`;
        } finally { copy.disabled = false; }
      });
      item.append(label, copy);
      return item;
    }));
    document.getElementById("home-coupon-help").textContent = list.children.length ?
      "Enter one code in your cart. Discounts are not applied automatically." : "No coupon offers currently available.";
    const { freeDeliveryMinimum, deliveryFee } = result.offers;
    const delivery = freeDeliveryMinimum > 0 && deliveryFee > 0 ?
      `Free delivery on billed amounts of ${money(freeDeliveryMinimum)} or more after coupon discount. Below this, delivery is ${money(deliveryFee)}.` :
      "Free home delivery on all billed amounts.";
    for (const node of document.querySelectorAll("[data-delivery-terms]")) {
      node.textContent = `${delivery} Store pickup is free. Delivery area and timing must be confirmed by the shop.`;
    }
    status.textContent = "";
    panel.hidden = false;
    retry.hidden = true;
  } catch (error) {
    status.textContent = error.message;
    panel.hidden = true;
    retry.hidden = false;
  } finally { retry.disabled = false; }
}
retry.addEventListener("click", load);
load();
