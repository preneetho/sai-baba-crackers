# Sai Baba Crackers Centre

Mobile-friendly 2026 catalogue with 68 products, a saved cart, an automatic
15% discount, free home delivery or store pickup, and a customer-reviewed
order request including the customer's name, mobile number and address.
Order requests are saved to the vendor's Google Sheet before WhatsApp is prepared.
Short orders share the complete WhatsApp message. Long orders send one short
summary with the request ID and a seven-day link to the complete order PDF;
all items and customer details remain in the
shop's Google Sheet and in the complete request available on the page.
The frontend is static; a Netlify Function securely calls the vendor's Apps Script
web app. Server-only npm dependencies generate PDFs and use private Netlify Blobs.
No frontend dependencies, customer accounts or payments are required.

## Local preview

With Node.js 22.5 or later:

```powershell
npm.cmd ci --prefix netlify
npm.cmd run dev
npm.cmd test
```

Open <http://127.0.0.1:4173>. Install the isolated server dependencies as shown above.
Order submission requires the Google Sheets configuration below.

## Deploy on Netlify

Import this repository from GitHub in Netlify and choose the `main` branch.
The checked-in `netlify.toml` provides the settings:

- Base directory: `.`
- Publish directory: `vendor-app`
- Build command: `npm ci --omit=dev --prefix netlify`
- Functions directory: `netlify/functions`
- Node.js: 22
- Functions environment: `GOOGLE_SHEETS_WEBHOOK_URL`, `ORDER_TRACKING_SECRET`

Complete the [Google Sheets setup](integrations/google-sheets/README.md) before
deploying. The spreadsheet stays private; never commit the shared secret.
Remove old Netlify dashboard overrides that still use `vendor-app` as the base.
Netlify Functions receive the private Blobs connection automatically. PDF links
need no new environment variables or Apps Script changes.

Long-order PDFs are created only after the Sheet acknowledges saving and the
customer explicitly consents. Anyone with a PDF link can open or forward it.
Links expire exactly seven days after the original saved time; retries do not
extend them. Downloads deny expired access immediately, and a published hourly
function removes expired files. Short orders do not create PDFs. Downloaded
copies cannot be revoked. Storage and function limits depend on the Netlify plan.
If PDF creation fails after saving, the app clearly reports that the order was
saved and allows retry using the same reference.

The server bundles open Noto fonts for Latin, Telugu, Devanagari, Arabic and
common emoji. Keep the font files, SIL OFL licences and pinned source metadata in
`netlify/assets/fonts` together. Unsupported characters are reported explicitly.

Verify the vendor's WhatsApp number, catalogue, licensing and applicable local
rules before sharing the public URL. Opening a WhatsApp link does not send the
message; customers must press Send in WhatsApp.

See [the app guide](vendor-app/README.md) for configuration, hosting, privacy
and WhatsApp handoff details.
