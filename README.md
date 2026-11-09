# Sai Baba Crackers Centre

Mobile-friendly 2026 catalogue with 68 products, a saved cart, an automatic
15% discount, free home delivery or store pickup, and a customer-reviewed
order request including the customer's name, mobile number and address.
Order requests are saved to the vendor's private order register before WhatsApp is prepared.
Short orders share the complete WhatsApp message. Long orders send one short
summary with the request ID and a seven-day link to the complete order PDF;
all items and customer details remain in the
shop's order register and in the complete request available on the page.
The frontend is static; Netlify Functions use Google Sheets by default or
Netlify Database when explicitly configured. Server-only npm dependencies
generate PDFs and use private Netlify Blobs.
No frontend dependencies, customer accounts or payments are required.

## Local preview

With Node.js 22.12 or later:

```powershell
npm.cmd ci
npm.cmd ci --prefix netlify
npm.cmd run dev
npm.cmd test
```

Open <http://127.0.0.1:4173>. Install the isolated server dependencies as shown above.
Order submission requires a configured order backend. The database tests run
against an isolated embedded PostgreSQL engine with synthetic data and need no
Netlify account, hosted database or credits.

## Deploy on Netlify

Import this repository from GitHub in Netlify and choose the `main` branch.
The checked-in `netlify.toml` provides the settings:

- Base directory: `.`
- Publish directory: `vendor-app`
- Build command: `npm ci --omit=dev && npm ci --omit=dev --prefix netlify`
- Functions directory: `netlify/functions`
- Node.js: 22
- Functions environment: `GOOGLE_SHEETS_WEBHOOK_URL`, `ORDER_TRACKING_SECRET`

Complete the [Google Sheets setup](integrations/google-sheets/README.md) before
deploying. The spreadsheet stays private; never commit the shared secret.
Remove old Netlify dashboard overrides that still use `vendor-app` as the base.
Netlify Functions receive the private Blobs connection automatically. In the
default Sheets mode, PDF links need no new environment variables or Apps Script
changes. For database mode, use the development setup below instead.

Long-order PDFs are created only after the selected backend acknowledges saving and the
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

If WhatsApp closes or fails to open, expand **WhatsApp closed or did not open?**
on the saved screen. Copy the prepared message, open the phone-only shop chat,
paste and tap Send. Long-order copies include the PDF link. This optional
recovery does not save another order; the normal automatic handoff is unchanged.

See [the app guide](vendor-app/README.md) for configuration, hosting, privacy
and WhatsApp handoff details.

## Private vendor dashboard

The `/vendor/` page uses Google sign-in restricted to approved vendor email
addresses. It supports request search, status filters, 25-request pages,
full customer/item details, estimated request counts/value and conflict-safe
status updates in the selected order backend. It does not send customer
notifications or treat requests as paid sales.

Before using it, follow the
[vendor dashboard setup](integrations/google-sheets/VENDOR-DASHBOARD.md):
create a Google OAuth web client and add the five vendor environment settings
in Netlify. For Sheets mode, also update the existing Apps Script web-app
deployment; for database mode, follow the development setup below. The page
reports unavailable access until configured.
The storefront and customer WhatsApp flow do not require Google sign-in.

## Netlify Database development

The database backend is implemented but **not enabled automatically**.
Unset `ORDER_BACKEND`, or set it to `sheets`, to keep the existing 2026
Google Sheet integration. Set `ORDER_BACKEND=netlify-db` only in the isolated
development environment after provisioning a Netlify Database and applying the
checked-in migrations. Invalid settings fail explicitly; a database outage
never silently writes to the Sheet.

Use a separate private development Netlify project connected to this vendor
repository. Do not change the production site's backend or migrate real
customer data as part of development. Enable Netlify Database in that project
and follow its [database setup](https://docs.netlify.com/build/data-and-storage/netlify-database/)
and [migration workflow](https://docs.netlify.com/build/data-and-storage/netlify-database/migrations/).
The platform supplies `NETLIFY_DB_URL` and its database driver to Functions.
Never paste the connection string into source or a public screenshot.

Set these additional values with Functions scope on the development project:

| Variable | Value |
|---|---|
| `ORDER_BACKEND` | `netlify-db` |
| `ORDER_PDF_SECRET` | Independently generated random secret of at least 32 characters |

Keep the five existing vendor Google authentication settings, but configure a
separate test OAuth client and exact development origin/callback. Database mode
does not require `GOOGLE_SHEETS_WEBHOOK_URL` or `ORDER_TRACKING_SECRET`.
The PDF secret is independent of vendor sessions and must remain stable across
retries. It is never returned to browsers.

The schema extends the existing telemetry database with `order_requests`,
`order_items` and `order_status_history`; it does not replace or delete telemetry.
SQL and snapshots are versioned in `netlify/database/migrations`. To generate
future migrations after editing the schema:

```powershell
npx.cmd --no-install drizzle-kit generate --name=describe_change
```

Review generated SQL before deploying; do not use schema push against production.
The root and Functions packages pin the same Drizzle version. Netlify applies
tracked migrations during deployment. A deploy of this source can create the
new tables even when Sheets remains the selected backend.

Order creation, snapshot items and initial audit entry commit in one transaction.
Repeated IDs preserve the original timestamp/status; different details with
the same ID return a conflict. Prices are snapshotted in integer paise.
The season is taken from the catalogue year, currently **2026**; this change
does not relabel the catalogue or invent 2027 prices. Vendor status changes and
their audit records commit together, recording the authenticated vendor email.
Audit history is stored privately, not exposed as a new dashboard feature.
Listing supports 25-request pages beyond the Sheet's 10,000-row cap, with a
maximum of 100,000 pages. Search, totals and counts use one consistent read
snapshot; value excludes Cancelled and is not revenue.

For local integration testing, use Netlify's supported local development/database
workflow with the development project, or set a local PostgreSQL connection in
the process environment with `NETLIFY_DB_DRIVER=server`. The simple `npm run dev`
server does not provision a database, apply migrations or load an environment
file automatically. `GET /api/orders` checks schema availability in database
mode; missing connections/migrations return 503 rather than false readiness.
Use the existing loopback server on port 4173 when matching the documented
local Google OAuth callback.

Verify a synthetic submission, original-ID retry, vendor status change/conflict
and long-order PDF before enabling real traffic. Keep sleep-on-inactivity
enabled and avoid polling/telemetry traffic that prevents sleep. Deploy previews
can copy production data into their database branches, so protect access and
use synthetic-only development data. Preview database and Functions usage still
consumes the shared Netlify credit allowance.

No 2026 Sheet records have been imported or modified. Do not flip backends on
an active site without a separate cutover: back up/reconcile IDs, original
timestamps, fingerprints, item snapshots, statuses and totals, pause new writes
for the cutover, and test old-ID retries before reopening. Switching back to
Sheets does not copy new database orders there. Before 2027 launch, agree on
customer-data retention, backups/restore, billing alerts, catalogue updates
and a production migration. PDF retention remains seven days. No automatic
WhatsApp API messaging is added.
