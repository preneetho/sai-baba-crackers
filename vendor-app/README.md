# Sai Baba Crackers Centre catalogue

A standalone, mobile-friendly enquiry app with a static frontend, a Netlify
order-recording function and a configurable Google Sheets or Netlify Database integration. No frontend
framework, frontend npm dependencies, customer accounts, payments or automatic
WhatsApp messaging. The existing Product Memory Graph application is unchanged.
Server-only dependencies store read-only request copies in private Netlify Blobs
and retain PDF support for older cached checkout pages.
The separate `/vendor/` dashboard uses approved vendor Google sign-in to view
requests and update statuses in the selected order backend. Customers do not need accounts.
See the [vendor dashboard setup](../integrations/google-sheets/VENDOR-DASHBOARD.md)
for OAuth, the approved-email list and deployment steps.
For isolated Netlify Database development, follow the
[database setup](../README.md#netlify-database-development). Sheets remains the
default; no 2026 orders are imported or modified automatically.

## Run

From the repository root, using Node.js 22.12 or later:

```powershell
npm.cmd ci
npm.cmd ci --prefix netlify
npm.cmd run vendor:dev
```

Open <http://127.0.0.1:4173>. Set `VENDOR_PORT` to choose another port.
The preview binds to loopback only; it is not a public deployment.
Catalogue and cart work without credentials. Saving a requirement needs the
order backend configuration described in the setup guides; missing configuration is reported
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
  Store pickup collects from **Industrial Estate, Main Road, Sanath Nagar**,
  shown under the pickup option and in the contact section. The pickup option
  also displays the primary shop phone number below the address.
- Have the vendor confirm its licence, applicable rules for online fireworks
  enquiries/orders, age restrictions and the hosting provider's acceptable-use
  policy. This prototype is not legal clearance to trade.
- Test handoff on actual Android and iPhone WhatsApp installations, including
  a full-catalogue requirement, before sharing with customers.

## Appearance

The app uses a blue theme across the catalogue, cart, checkout and mobile controls,
with gold accents for the festive artwork. Shared colours are defined in
`styles.css`; the browser theme colour in `index.html` matches the brand.
The vendor-provided `sai-baba-logo.png` is used in the header and as the favicon.
The hero highlights 35 years in the crackers trade, the Sanathnagar wholesale-market
experience, the 15% discount and delivery/pickup options. Delivery area and timing
remain subject to shop confirmation.
The header uses the bundled static `diwali-fireworks.png` image (about 41 KB).
There is no active GIF, video, autoplay or playback control. The image works
without JavaScript and has fixed dimensions to prevent layout shift. Mobile
artwork is fully visible in its own grid column beside the header links and
metadata, scaling down further on very narrow screens. Older animation assets
and their module remain at their original URLs for previously cached pages,
but the current page neither imports the animation module nor loads those assets.
No external media service or new runtime dependency is used.
Changing the theme does not change order recording, pricing or WhatsApp messages.
Product cards use bundled SVG illustrations matched to the cracker type, with
specific variants for items such as rockets, sparklers, garlands and flower pots.
These are illustrative, not manufacturer product photos. On mobile, the artwork
band is 56 px high with a 40 px illustration; desktop artwork remains larger.
Selected product cards use a warm-gold background, gold artwork band and stronger
border, with the selected quantity in bold. The existing quantity and selection
announcement also identify the state without relying on colour alone. The
highlight follows the cart across search, category filters, sorting and reloads,
and disappears when the product's quantity returns to zero.
Clear selection is available both above and below the selected-items list.
Both controls use the same confirmation prompt and are hidden for an empty list.

### WhatsApp link preview

Link previews use the separate `diwali-crackers-square.png` image (800 x 800),
not the Sai Baba portrait used in the header and favicon. The editable artwork is
`diwali-crackers-square.svg`; the PNG is the shareable raster export. The square
artwork centres the crackers and has no embedded text, keeping it recognisable
in WhatsApp's small square thumbnails instead of cropping a wide banner.
Open Graph and square Twitter summary-card tags are included directly in
`index.html`, so crawlers do not need to run JavaScript. Keep the image publicly
accessible. The older wide image is retained for previously cached image URLs.

The metadata uses the deployed site's absolute HTTPS URL,
`https://saibabacrackers.netlify.app/`. Update the metadata URLs if the domain
changes. Deploy the HTML and PNG together through the Git-connected Netlify site;
this image change does not require updating Apps Script or environment variables.

WhatsApp may cache previews independently of Netlify. After deployment, check the
public PNG URL and try sharing a fresh URL such as
`https://saibabacrackers.netlify.app/?share=diwali-square-v2` if the original link still
shows the old portrait. A fresh query can trigger a new fetch, but cache refresh
timing and card layout are controlled by WhatsApp. This change cannot force a
full-width preview or update images already shown in existing messages.

## Hosting

### Netlify

The repository's `netlify.toml` uses the repository root as the base directory,
publishes only `vendor-app`, and runs `npm ci --omit=dev && npm ci --omit=dev --prefix netlify`.
Server functions live outside the published files in `netlify/functions`. The configuration
also sets security headers and the JavaScript content type for `.mjs` files.
Builds are not skipped when only the functions outside the base directory change.

In Netlify, choose **Add new project > Import an existing project > GitHub**,
authorize only the vendor app repository and select its `main` branch.
Use the checked-in settings: base directory `.`, publish directory `vendor-app`,
build command `npm ci --omit=dev && npm ci --omit=dev --prefix netlify`, and Node.js 22. Remove
old dashboard overrides that still use `vendor-app` as the base. Set
`GOOGLE_SHEETS_WEBHOOK_URL` and `ORDER_TRACKING_SECRET` in Netlify's Functions
environment for the default Sheets backend. Follow the
[Google Sheets setup guide](../integrations/google-sheets/README.md) or the
[database development setup](../README.md#netlify-database-development)
before publishing, then verify the generated HTTPS URL on a real phone.
Subsequent pushes to `main` trigger a new deployment once the GitHub integration
is connected.

Deployed Netlify Functions automatically receive the private Blobs connection.
No new public bucket or Apps Script change is needed for order details links. Database
mode requires the server-only `ORDER_PDF_SECRET` documented in its setup guide.
The hourly cleanup runs on the published deployment, not deploy previews.
Storage and function usage depend on the site's Netlify plan and limits.

Static drag-and-drop deployment does not deploy the required order-recording
function. Use the GitHub-connected deployment with the root `netlify.toml`.

### Other static hosts

The catalogue can be previewed as static files, but submission now requires the
Netlify `/api/orders` and `/request/*` functions, private snapshot storage and
expiry cleanup. Another host needs equivalent server endpoints and retention controls;
uploading only `vendor-app` will not provide working order recording. Never put
the server function, shared secret or spreadsheet credentials in public files.

## Behaviour and privacy

- Customer-facing copy uses **Cart**, **Checkout** and **Order request** throughout
  the shopping flow, accessibility labels, recovery guidance and WhatsApp message.
  The mobile shortcut is **View cart**, and both **Clear cart** controls use the
  same confirmation. Search controls and search behaviour are unchanged.
- Cart quantities are whole **packs**, between 1 and 99 per product. A pack means
  the listed selling unit: a box, packet, or individual piece as shown on the
  product. This wording does not change pack sizes, quantities or prices.
- A **15% discount** applies automatically to the complete catalogue subtotal.
  Cart and checkout show the subtotal, discount and discounted estimated
  total; the mobile cart and WhatsApp message use the same discounted total.
  Calculations use integer paise and round the discount once at subtotal level.
  Catalogue and individual line prices remain the original printed rates.
- Delivery or pickup is a required choice with no preselected option. Home
  delivery has **zero charge**, shown as the delivery fee in checkout and full order details; the
  15% discounted total is unchanged. The full request includes the selected method,
  address and optional preferred delivery/pickup date. Address remains required
  for both options. No delivery radius, minimum order or delivery date guarantee
  is assumed; the vendor confirms arrangements directly.
- Search includes product names, numbers, brands and categories. Categories and
  price/name sorting work together.
- The cart is saved to local storage, not to a server. Invalid saved data and
  storage failures are reported. Contact details are not saved to local storage.
  Required name, mobile number and full address (10-500 characters) are recorded
  in the vendor's Google Sheet after explicit consent. Multiline addresses are
  preserved. Closing checkout clears the local form and message, not sheet rows.
- The customer agrees to private order recording, WhatsApp sharing and temporary
  read-only snapshot storage for every order. Anyone with the link can see all
  customer details and line items for seven days. The server
  recalculates amounts, then records an order request with an `SBC-` reference before
  creating the details link and returning a WhatsApp summary containing that reference,
  the customer's name, mobile and estimated total. Failures are shown and
  keep details available for retry; no failed save is represented as success.
  Retries of unchanged details in the same checkout reuse the reference.
- The order's original date and time appear in IST in the sheet's column Q and
  the prepared WhatsApp message, using the server-generated timestamp retained
  in column B (UTC). Retries preserve the first saved time, not the latest attempt
  time. Existing trackers need the Apps Script timestamp upgrade before the
  updated Netlify function is deployed; see the Google Sheets setup guide.
- Revisions create a new reference. The vendor must confirm which reference to
  fulfil and cancel obsolete enquiries. The vendor manages status directly in
  the sheet; status does not automatically track WhatsApp messages.
- **Proceed to checkout** opens the order summary and customer-details screen.
  Its **Send order request via WhatsApp** button has a prominent reminder to tap
  **Send** inside WhatsApp; opening the chat alone does not send the order request.
  The prepared WhatsApp text is loaded into WhatsApp when it opens.
  The button saves the complete request to the
  tracker first, then automatically follows one WhatsApp link in the same tab.
  No popup permission or extra preview-button tap is required for this attempt.
  If the browser blocks navigation, the recorded reference,
  manual WhatsApp link, complete message and copy/download tools remain available.
  Save or acknowledgement failures stay on the form and never launch WhatsApp.
  Customers still press **Send** inside WhatsApp; the site cannot verify that a
  message was sent or delivered.
- If WhatsApp immediately closes or does not open, the saved screen includes
  **WhatsApp closed or did not open?** as an optional recovery panel. It copies
  the exact prepared WhatsApp message: the short summary with the order details
  link for every cart size. **Open shop chat**
  uses a phone-only link without prefilled text; customers paste and tap Send.
  If that link also fails, the shop number and selectable message are available
  for opening WhatsApp manually. Clipboard failures are explicit. These actions
  never submit another order or replace the original automatic handoff.
- Each encoded WhatsApp URL is capped at a conservative 1,800 characters.
  Every request uses one short summary: request ID, original IST
  date/time, complete customer name, mobile, the server-calculated estimated
  total and a link to a read-only order details page, including its expiry.
  The vendor can also look up all items,
  address and notes in its Google Sheet using the request ID.
  No order data is removed from the sheet or the complete message available on
  the page. Summary data is generated by the server only after acknowledgement;
  no Apps Script or spreadsheet migration is needed for this change.
  The current app never splits an order into WhatsApp parts. The legacy
  `prepareMessages` export remains compatible with cached older pages.
  The URL cap is an implementation safeguard, not a guarantee across every
  WhatsApp client.
- Read-only request copies are created only after the configured backend acknowledges
  saving. They contain every line item, customer details, notes and totals.
  Private Netlify Blobs storage uses an unguessable bearer link: **anyone with
  the link can open it**, including someone to whom it is forwarded. Links expire
  exactly seven days after link creation. Expired access is denied immediately,
  and an hourly job removes expired snapshots without deleting original orders.
  The page identifies the original submitted status, not later vendor changes.
- If snapshot storage fails after the backend saves the order, the app
  explicitly reports that the order was saved and retains its reference for
  retry. It does not open WhatsApp with a missing details link. Retrying unchanged
  details reuses the saved reference and timestamp without duplicating records,
  and creates a fresh seven-day link. Previously shared links remain valid
  snapshots until their own expiry; signing out or closing checkout does not revoke them.
- Older cached checkout pages with explicit PDF consent retain their long-order
  PDF API. Those PDFs expire seven days after the original saved time; retries
  do not extend them. Already downloaded copies cannot be revoked.
  PDFs embed the bundled Noto Sans, Telugu, Devanagari, Arabic and Emoji fonts.
  Unsupported characters produce an explicit error rather than being dropped.
  Fonts and their SIL Open Font Licences are under `netlify/assets/fonts`;
  `SOURCES.json` records the pinned upstream revision. These server assets are
  bundled with the order function, not published as customer-facing static files.
- Copy and plain-text download preserve the complete order request as fallbacks.
  Downloads and clipboard contents may contain personal details; customers
  control these copies. Google Sheets holds the enquiry register; the vendor
  controls sharing, corrections, retention and deletion.
- A confirmed sale, availability, final prices and delivery/pickup arrangements
  are handled directly by the vendor. No selection is automatically cleared
  after opening WhatsApp.

## Private telemetry dashboard

Open `/telemetry` for anonymous session counts, an ordering funnel and a daily UTC
breakdown over 7, 30 or 90 days. Data starts at deployment, with no historical
backfill. Each stage counts once per anonymous browser-tab session (up to 30
minutes). The funnel follows visiting sessions in the chosen window, requiring
cart addition before checkout and checkout before a saved acknowledgement.
Saved requests reflect the browser receiving a valid order acknowledgement;
they are not confirmed sales, delivered WhatsApp messages or a replacement for
the Google Sheet order register. Blocked requests and privacy preferences may
reduce counts. The collector stores only a random event ID, random session ID,
stage and server timestamp in Netlify Database, and respects Do Not Track and
Global Privacy Control. No customer fields or request URLs are stored.

Identity provides owner login, logout, invitation acceptance and password resets.
There is no signup UI and new accounts receive no telemetry privileges.
For the first owner, invite your own email under the project's Identity settings,
then assign **only that account** the `telemetry-owner` role. Accept the invitation
and set a password using the email link. All reads require this server-controlled
role; ordinary authenticated accounts cannot read telemetry. Invitations and reset
links landing at the catalogue root are forwarded to the dashboard. Public users
can load the login page but cannot access the data. Public collection is
same-origin, validated and rate-limited; counts are observational and can include
bots or fabricated events, so they must not be used as financial records.

The schema lives in `db/schema.ts`, with generated migrations in
`netlify/database/migrations`. Database dependencies and the matching Drizzle migration CLI are installed at the
repository root so automatic migration generation resolves compatible versions.
Other server packages remain under `netlify` like the existing order functions.
Netlify runs migration generation automatically during deployment.
Netlify applies migrations during deploy; do not apply them manually.
