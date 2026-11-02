# Sai Baba Crackers Centre catalogue

A standalone, mobile-friendly static enquiry app. No framework, dependencies,
backend, accounts, payment collection, analytics or automatic WhatsApp messaging.
The existing Product Memory Graph application is unchanged.

## Run

From the repository root, using Node.js 22.5 or later:

```powershell
npm.cmd run vendor:dev
```

Open <http://127.0.0.1:4173>. Set `VENDOR_PORT` to choose another port.
The preview binds to loopback only; it is not a public deployment.

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
- Confirm actual pickup arrangements. There is no delivery promise or address
  collection.
- Have the vendor confirm its licence, applicable rules for online fireworks
  enquiries/orders, age restrictions and the hosting provider's acceptable-use
  policy. This prototype is not legal clearance to trade.
- Test handoff on actual Android and iPhone WhatsApp installations, including
  a full-catalogue requirement, before sharing with customers.

## Hosting

### Netlify

The repository's `netlify.toml` selects `vendor-app` as the base directory,
publishes that directory directly and requires no build command. It also sets
security headers and the JavaScript content type for `.mjs` files.

In Netlify, choose **Add new project > Import an existing project > GitHub**,
authorize only the vendor app repository and select its `main` branch.
Use the checked-in settings: base directory `vendor-app`, publish directory `.`
(relative to the base), and an empty build command. No environment variables
are required. Deploy, then test the generated HTTPS URL on a real phone.
Subsequent pushes to `main` trigger a new deployment once the GitHub integration
is connected.

For manual deployment without GitHub integration, upload the contents of
`vendor-app` using Netlify's manual deploy interface. Uploads do not get the
root-level `netlify.toml`; repository import is preferred for configuration and
automatic deployments.

### Other static hosts

Publish **only the `vendor-app` directory** to a static host supporting HTTPS,
for example Cloudflare Pages or an equivalent approved provider. No build
command is required; the publish directory is `vendor-app`. Alternatively copy
its HTML, CSS and MJS files to a static web root. Hosting must serve `.mjs` files
as JavaScript. Keep the files together; relative paths also support subdirectory
hosting. No secret keys or server environment variables are required.

For Cloudflare Pages, connect the repository, select no framework, leave the
build command empty and set the output directory to `vendor-app`. A custom
domain is optional. This repository may contain unrelated internal code:
do not grant a hosting provider repository access without the owner's approval;
uploading just the public app files is an alternative.

## Behaviour and privacy

- Selection quantities are whole **selling units**, between 1 and 99 per product.
  A selling unit can be a box, packet, or individual piece as shown in the list.
- Search includes product names, numbers, brands and categories. Categories and
  price/name sorting work together.
- The cart is saved to local storage, not to a server. Invalid saved data and
  storage failures are reported. Contact details remain in memory only, and the
  review form and message are cleared when the dialog is closed.
- The customer validates details and explicitly agrees before message links are
  generated. Customer details are included in the WhatsApp URL only when they
  open the chat. The site cannot verify that a message was sent or delivered.
- Each encoded WhatsApp URL is capped at a conservative 1,800 characters.
  Longer requirements are split into numbered parts without truncation. All
  parts must be sent manually. This cap is an implementation safeguard, not a
  guarantee across every WhatsApp client.
- Copy and plain-text download preserve the complete requirement as fallbacks.
  Downloads and clipboard contents may contain personal details; customers
  control these copies. There is no server-side enquiry register.
- A confirmed sale, availability, final prices and pickup are handled directly
  by the vendor. No selection is automatically cleared after opening WhatsApp.
