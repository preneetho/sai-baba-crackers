# Sai Baba Crackers Centre

Mobile-friendly 2026 catalogue with 68 products, a saved cart, an automatic
15% discount, free home delivery or store pickup, and a customer-reviewed
order request including the customer's name, mobile number and address.
Order requests are saved to the vendor's Google Sheet before WhatsApp is prepared.
Short orders share the complete WhatsApp message. Long orders send one short
summary with the request ID; all items and customer details remain in the
shop's Google Sheet and in the complete request available on the page.
The frontend is static; a Netlify Function securely calls the vendor's Apps Script
web app. No customer accounts, payments or npm dependencies are required.

## Local preview

With Node.js 22.5 or later:

```powershell
npm.cmd run dev
npm.cmd test
```

Open <http://127.0.0.1:4173>. No dependency installation is required.
Order submission requires the Google Sheets configuration below.

## Deploy on Netlify

Import this repository from GitHub in Netlify and choose the `main` branch.
The checked-in `netlify.toml` provides the settings:

- Base directory: `vendor-app`
- Publish directory: `.` (relative to the base)
- Build command: empty
- Functions directory: `../netlify/functions`
- Functions environment: `GOOGLE_SHEETS_WEBHOOK_URL`, `ORDER_TRACKING_SECRET`

Complete the [Google Sheets setup](integrations/google-sheets/README.md) before
deploying. The spreadsheet stays private; never commit the shared secret.

Verify the vendor's WhatsApp number, catalogue, licensing and applicable local
rules before sharing the public URL. Opening a WhatsApp link does not send the
message; customers must press Send in WhatsApp.

See [the app guide](vendor-app/README.md) for configuration, hosting, privacy
and WhatsApp handoff details.
