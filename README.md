# Sai Baba Crackers Centre

Mobile-friendly 2026 catalogue with 68 products, a saved selection, an automatic
15% discount and a customer-reviewed WhatsApp enquiry including the customer's
name, mobile number and address. Static files only: no backend, payment
collection, accounts or secret keys.

## Local preview

With Node.js 22.5 or later:

```powershell
npm.cmd run dev
npm.cmd test
```

Open <http://127.0.0.1:4173>. No dependency installation is required.

## Deploy on Netlify

Import this repository from GitHub in Netlify and choose the `main` branch.
The checked-in `netlify.toml` provides the settings:

- Base directory: `vendor-app`
- Publish directory: `.` (relative to the base)
- Build command: empty
- Environment variables: none

Verify the vendor's WhatsApp number, catalogue, licensing and applicable local
rules before sharing the public URL. Opening a WhatsApp link does not send the
message; customers must press Send in WhatsApp.

See [the app guide](vendor-app/README.md) for configuration, hosting, privacy
and message-splitting details.
