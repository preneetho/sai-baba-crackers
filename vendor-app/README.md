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

## Appearance

The app uses a blue theme across the catalogue, cart, checkout and mobile controls,
with gold accents for the festive artwork. Shared colours are defined in
`styles.css`; the browser theme colour in `index.html` matches the brand.
The vendor-provided `sai-baba-logo.png` is used in the header and as the favicon.
The hero highlights 35 years in the crackers trade, the Sanathnagar wholesale-market
experience, the 15% discount and delivery/pickup options. Delivery area and timing
remain subject to shop confirmation.
The header uses an original golden-fireworks animation, not a copied Pinterest
clip. The bundled `diwali-fireworks.mp4` is a silent, four-second H.264 Baseline
video of about 146 KB, with `playsinline` for mobile playback. It plays once when the artwork
enters view, then shows `diwali-fireworks-poster.png`. Play, Pause and Replay
controls remain available if autoplay is blocked or the animation was missed.
Scrolling away or switching tabs pauses it; it does not loop or restart on every
scroll. Reduced-motion mode shows only the poster and does not request the video.
The poster also works without JavaScript or when video playback fails.
Fixed media dimensions prevent layout shift. Mobile artwork is fully visible
in its own grid column beside the header links and metadata, rather than a faint
absolute-positioned background. It scales down further on very narrow screens.
The original GIF and still remain
available at their old URLs for cached pages. No external media service,
animation library or new runtime dependency is used.
Changing the theme does not change order recording, pricing or WhatsApp messages.
Product cards use bundled SVG illustrations matched to the cracker type, with
specific variants for items such as rockets, sparklers, garlands and flower pots.
These are illustrative, not manufacturer product photos. On mobile, the artwork
band is 56 px high with a 40 px illustration; desktop artwork remains larger.

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
- The order's original date and time appear in IST in the sheet's column Q and
  the prepared WhatsApp message, using the server-generated timestamp retained
  in column B (UTC). Retries preserve the first saved time, not the latest attempt
  time. Existing trackers need the Apps Script timestamp upgrade before the
  updated Netlify function is deployed; see the Google Sheets setup guide.
- Revisions create a new reference. The vendor must confirm which reference to
  fulfil and cancel obsolete enquiries. The vendor manages status directly in
  the sheet; status does not automatically track WhatsApp messages.
- Customer details are included in the prepared WhatsApp link and shared when
  it opens. For a single-part requirement, **Save & open WhatsApp** saves to the
  tracker first, then automatically follows the WhatsApp link in the same tab.
  No popup permission or extra preview-button tap is required for this attempt.
  If the browser blocks navigation, the recorded reference,
  manual WhatsApp link, complete message and copy/download tools remain available.
  Save or acknowledgement failures stay on the form and never launch WhatsApp.
  Customers still press **Send** inside WhatsApp; the site cannot verify that a
  message was sent or delivered.
- Each encoded WhatsApp URL is capped at a conservative 1,800 characters.
  Longer requirements are split into numbered parts without truncation. All
  parts must be sent manually. Multi-part requirements retain the numbered-link
  screen without automatically opening the first part, so later parts are not
  lost. This cap is an implementation safeguard, not a
  guarantee across every WhatsApp client.
- Copy and plain-text download preserve the complete requirement as fallbacks.
  Downloads and clipboard contents may contain personal details; customers
  control these copies. Google Sheets holds the enquiry register; the vendor
  controls sharing, corrections, retention and deletion.
- A confirmed sale, availability, final prices and delivery/pickup arrangements
  are handled directly by the vendor. No selection is automatically cleared
  after opening WhatsApp.
