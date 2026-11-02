# Sai Baba Crackers Centre catalogue

A standalone, mobile-friendly enquiry app with a static frontend, a Netlify
order-recording function and a Google Apps Script integration. No frontend
framework, npm dependencies, customer accounts, payments, analytics or automatic
WhatsApp messaging. The existing Product Memory Graph application is unchanged.

## Run

From the repository root, using Node.js 22.5 or later:

```powershell
npm.cmd run vendor:dev
```

Open <http://127.0.0.1:4173>. Set `VENDOR_PORT` to choose another port.
The preview binds to loopback only; it is not a public deployment.
Catalogue and cart work without credentials. Saving a requirement needs the
Google Sheets configuration described below; missing configuration is reported
explicitly and never treated as a saved order.

```powershell
npm.cmd run vendor:test
```

## Configure before public launch

- Verify all 68 products, selling units and prices in `catalog.mjs` against the
  supplied "Sai Bab Crackers List (SHOP) - 2026.pdf". Names have minor spelling
  normalization. Product 6 is displayed as 45 cm rather than the equivalent
  fractional feet notation; product 63 is the 1 1/4 inch Comet.
- `vendor.whatsapp` defaults to **919849293951**, the first number on the PDF,
  not a verified WhatsApp account. Confirm ownership and WhatsApp availability.
  Update the phone links in `index.html` too if either shop number changes.
- Confirm actual delivery and pickup arrangements and any local restrictions.
  Customers explicitly choose **free home delivery** or **store pickup**.
  The vendor confirms delivery service area, availability and timing.
- Have the vendor confirm its licence, applicable rules for online fireworks
  enquiries/orders, age restrictions and the hosting provider's acceptable-use
  policy. This prototype is not legal clearance to trade.
- Test handoff on actual Android and iPhone WhatsApp installations, including
  a full-catalogue requirement, before sharing with customers.

## Hosting

### Netlify

The repository's `netlify.toml` selects `vendor-app` as the base directory,
publishes that directory directly and requires no build command. Server functions
live outside the published files in `../netlify/functions`. The configuration
also sets security headers and the JavaScript content type for `.mjs` files.
Builds are not skipped when only the functions outside the base directory change.

In Netlify, choose **Add new project > Import an existing project > GitHub**,
authorize only the vendor app repository and select its `main` branch.
Use the checked-in settings: base directory `vendor-app`, publish directory `.`
(relative to the base), and an empty build command. Set
`GOOGLE_SHEETS_WEBHOOK_URL` and `ORDER_TRACKING_SECRET` in Netlify's Functions
environment. Follow the [Google Sheets setup guide](../integrations/google-sheets/README.md)
before publishing, then verify the generated HTTPS URL on a real phone.
Subsequent pushes to `main` trigger a new deployment once the GitHub integration
is connected.

Static drag-and-drop deployment does not deploy the required order-recording
function. Use the GitHub-connected deployment with the root `netlify.toml`.

### Other static hosts

The catalogue can be previewed as static files, but submission now requires the
Netlify `/api/orders` function. Another host needs an equivalent server endpoint;
uploading only `vendor-app` will not provide working order recording. Never put
the server function, shared secret or spreadsheet credentials in public files.

## Behaviour and privacy

- Selection quantities are whole **selling units**, between 1 and 99 per product.
  A selling unit can be a box, packet, or individual piece as shown in the list.
- A **15% discount** applies automatically to the complete catalogue subtotal.
  Cart and review show the subtotal, discount applied and discounted estimated
  total; the mobile cart and WhatsApp message use the same discounted total.
  Calculations use integer paise and round the discount once at subtotal level.
  Catalogue and individual line prices remain the original printed rates.
- Delivery or pickup is a required choice with no preselected option. Home
  delivery has **zero charge**, shown in the review and WhatsApp message; the
  15% discounted total is unchanged. WhatsApp includes the selected method,
  address and optional preferred delivery/pickup date. Address remains required
  for both options. No delivery radius, minimum order or delivery date guarantee
  is assumed; the vendor confirms arrangements directly.
- Search includes product names, numbers, brands and categories. Categories and
  price/name sorting work together.
- The cart is saved to local storage, not to a server. Invalid saved data and
  storage failures are reported. Contact details are not saved to local storage.
  Required name, mobile number and full address (10-500 characters) are recorded
  in the vendor's Google Sheet after explicit consent. Multiline addresses are
  preserved. Closing the review clears the local form and message, not sheet rows.
- The customer agrees to Sheets recording and WhatsApp sharing. The server
  recalculates amounts, then records an enquiry with an `SBC-` reference before
  returning a WhatsApp message containing that reference. Failures are shown and
  keep details available for retry; no failed save is represented as success.
  Retries of unchanged details in the same review reuse the reference.
- Revisions create a new reference. The vendor must confirm which reference to
  fulfil and cancel obsolete enquiries. The vendor manages status directly in
  the sheet; status does not automatically track WhatsApp messages.
- Customer details enter the WhatsApp URL when the customer opens the prepared
  chat. The site cannot verify that a WhatsApp message was sent or delivered.
- Each encoded WhatsApp URL is capped at a conservative 1,800 characters.
  Longer requirements are split into numbered parts without truncation. All
  parts must be sent manually. This cap is an implementation safeguard, not a
  guarantee across every WhatsApp client.
- Copy and plain-text download preserve the complete requirement as fallbacks.
  Downloads and clipboard contents may contain personal details; customers
  control these copies. Google Sheets holds the enquiry register; the vendor
  controls sharing, corrections, retention and deletion.
- A confirmed sale, availability, final prices and delivery/pickup arrangements
  are handled directly by the vendor. No selection is automatically cleared
  after opening WhatsApp.
