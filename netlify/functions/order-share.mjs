import { privateHeaders } from "../lib/vendor-auth.mjs";
import { readOrderShare, shareKey } from "../lib/order-shares.mjs";

const escape = value => String(value).replace(/[&<>"']/g, character =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const money = value => `Rs.${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const time = value => `${new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short", hour12: true,
}).format(new Date(value))} IST`;
const fields = pairs => `<dl class="vendor-detail-fields">${pairs.map(([label, value]) =>
  `<dt>${escape(label)}</dt><dd>${escape(value || "Not provided")}</dd>`).join("")}</dl>`;

function page(content) {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow, noarchive"><meta name="referrer" content="no-referrer">
<title>Shared request | Sai Baba Crackers Centre</title>
<link rel="icon" href="/sai-baba-logo.png"><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/vendor.css">
</head><body class="vendor-page">
<a class="skip-link" href="#request-main">Skip to request</a>
<header class="vendor-header"><a class="vendor-brand" href="/">
<img class="brand-mark" src="/sai-baba-logo.png" width="45" height="45" alt="">
<span>Sai Baba Crackers Centre<small>Shared order request</small></span></a></header>
<main id="request-main" class="vendor-main shared-request"><section class="vendor-panel">${content}</section></main>
</body></html>`;
}

export async function handleOrderShare(request, { readShare = readOrderShare } = {}) {
  const headers = {
    ...privateHeaders(), "Content-Type": "text/html; charset=utf-8",
    "Netlify-CDN-Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; style-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  };
  const reply = (content, status = 200) =>
    new Response(request.method === "HEAD" ? null : page(content), { status, headers });
  if (!["GET", "HEAD"].includes(request.method)) {
    return new Response("This request link is read-only. Use GET or HEAD.", {
      status: 405, headers: { ...headers, Allow: "GET, HEAD" },
    });
  }
  const url = new URL(request.url);
  const token = /^\/request\/([^/]+)\/?$/.exec(url.pathname)?.[1];
  if (url.search || !shareKey(token)) return reply("<h1>Invalid request link</h1><p>Ask the shop to share a new link.</p>", 400);
  try {
    const result = await readShare(token);
    if (result.status !== 200) return reply(
      "<h1>Request link unavailable</h1><p>This link is invalid or has expired. Ask the shop to share a new link. The original request remains in the shop's private register.</p>",
      result.status);
    const { order, sharedAt, expiresAt } = result.snapshot;
    const submitted = result.snapshot.source === "submission";
    return reply(`<h1>Order request</h1>
<p class="vendor-request-id">${escape(order.orderId)}</p>
<p class="vendor-muted">Recorded ${escape(time(order.createdAt))}</p>
<p class="vendor-notice">Read-only snapshot shared ${escape(time(sharedAt))}. ${submitted ?
        "This is the original submitted request, not live updates." : "Status and amounts are as shared, not live updates."}</p>
<p class="vendor-muted">Anyone with this link can view these customer details until ${escape(time(expiresAt))}. Share only with trusted recipients.</p>
${fields([["Customer", order.name], ["Mobile", order.phone], ["Fulfilment", order.fulfilment],
      ["Address", order.address], ["Preferred date", order.preferredDate],
      [submitted ? "Status at submission" : "Status when shared", order.status], ["Notes", order.notes]])}
<h2>Requested items</h2><pre class="vendor-items">${escape(order.items)}</pre>
${fields([["Subtotal", money(order.subtotal)], ["Discount", `${order.discountPercent}% (${money(order.discount)})`],
      ["Delivery charge", money(order.deliveryCharge)], ["Estimated total", money(order.total)]])}
<p class="vendor-muted">Listed quantities are selling packs/units. Stock, final price and arrangements need shop confirmation. This request is not a payment receipt or a confirmed sale. Contact the shop for current status.</p>`);
  } catch {
    console.error("Shared request lookup failed.");
    return reply("<h1>Request temporarily unavailable</h1><p>Please retry this link. If the problem continues, contact the shop.</p>", 503);
  }
}

export default async request => handleOrderShare(request);
export const config = {
  path: "/request/*",
  rateLimit: { windowLimit: 60, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
