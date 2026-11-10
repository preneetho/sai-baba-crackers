# Sai Baba Crackers Centre

Mobile-friendly yearly catalogue, initially seeded with the 68 original 2026 products, a saved cart, an automatic
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

## Yearly database price lists

With `ORDER_BACKEND=netlify-db`, products, pack descriptions, brands, categories
and prices are read from Netlify Database rather than the static JavaScript list.
The tracked annual-catalogue migration creates `catalogue_years`,
`catalogue_revisions` and `catalogue_settings`, seeds the original 68-product
2026 price list, and selects 2026 as the active year. It does not import, delete
or reprice historical orders. No additional environment variables are needed.
Push this source to `main` and publish a Git-connected Netlify deployment so
the migration and both new Functions (`catalogue` and `vendor-catalogue`) ship
together; a static drag-and-drop deploy is insufficient.

At `/vendor/`, sign in and choose **Manage yearly price lists**:

1. Select an existing year, or enter a new year and choose **Copy selected list
   to new year**. Copying does not change the active year.
2. Select a compact table row (or its product-name button using the keyboard)
   to expand the product's fields and media actions. Edit product names,
   brands, selling packs, categories and prices. Closing a row keeps its draft.
   The sticky **Save price list** bar stays visible while scrolling and shows
   unsaved/saving/saved or reload-required state. **View error** returns to the
   detailed message if an action fails. You can
   add/remove products (1-200 per year). Existing product numbers stay stable;
   new numbers are allocated automatically. Prices allow two decimals, from
   Rs.0 to Rs.100,000 per selling pack.
3. Choose **Save price list**. Saving the active year changes prices for new
   requests immediately after confirmation. Other years remain unpublished.
4. Choose **Make this the active year** to switch the customer catalogue.
   There is one selected year, with no automatic calendar rollover.

**Out-of-stock products:** Expand a product row, uncheck **Visible to customers**
and **Save price list**. The vendor row shows **Hidden from customers** and the
sticky save bar counts hidden products. Hidden products keep their number,
price and media in that year's list but are omitted from the public catalogue;
checkout rejects hidden items rather than silently dropping them from an order.
Recheck and save when restocked. Visibility is independent for each year;
copying a year copies its saved visibility too. All products may be hidden, in
which case customers see a no-products-available message rather than an error.
This is manual availability, not quantity tracking or automatic stock depletion.
Visibility changes create a revision and invalidate older carts like price edits.
Previously saved orders and their retries are unchanged. No new migration or
environment variable is required.

The 15% discount and free-delivery/pickup rules are unchanged. Each save retains
an immutable revision with the authenticated editor and timestamp. Concurrent
edits are rejected rather than overwritten. If a response is uncertain, visible
drafts remain on screen but further changes require **Reload saved list**;
reload/close/year changes warn before discarding unsaved edits.

Customers see only the active year at `/api/catalogue`. Saved carts are bound
to that year and revision; when they change, customers must select items again
rather than silently accepting different prices. Checkout rebuilds every line
and total from the database, rejects stale new requests, and preserves the
original prices, timestamp and status when retrying an already-saved request.
Database failures show an explicit error, never a fallback to static prices.
The explicitly selected Sheets backend continues using the original static
2026 list and does not support vendor yearly-price editing.

## Product photos and videos (Cloudinary)

The database catalogue supports up to **3 photos and 1 video per product**.
Photos must be JPG, PNG or WebP, up to 5 MB each. Uploaded videos must be MP4, WebM or
MOV, up to 20 MB and 30 seconds; MP4 is the most widely supported choice.
The vendor uploads directly to Cloudinary using a server-signed authorization.
The server checks Cloudinary's actual asset metadata before issuing an
attachment proof; the database stores references and credits, not file bytes.
No new package or database migration is needed beyond the annual catalogue.

Add these **production Functions-scoped** Netlify variables, then publish the
updated source using the normal Git-connected deployment:

| Variable | Value |
|---|---|
| `CLOUDINARY_CLOUD_NAME` | Product environment's cloud name |
| `CLOUDINARY_API_KEY` | API key from that same environment |
| `CLOUDINARY_API_SECRET` | Its API secret, stored only in Netlify |
| `CLOUDINARY_UPLOAD_PRESET` | `sai_baba_products`, a **signed** upload preset |

Use the Image and Video API product. Configure the signed preset with
overwrite disabled, an optional asset folder `sai-baba-crackers/products`,
and no folder/path prepended to the supplied public ID. Where supported,
also configure preset file-size/format restrictions. App upload authorizations
use a unique public ID and refuse overwrite. The API key must support signed
uploads and server-side Admin API resource lookup. Never use an unsigned
preset or put the API secret in source, a browser or chat.

At `/vendor/`, open **Manage yearly price lists**, choose the year, select a
product row, and expand **Photos & video**:

1. Save a newly added product before uploading. Choose a file and select
   **Upload selected file**. Only approved signed-in vendors can authorize it.
2. Review the description, supply credits/license/source URLs when required,
   and clearly label illustrative media that is not the exact product.
   Include essential visual/audio information in the description.
3. Use **Use as cover**, **Move earlier/later**, or **Remove media** as needed.
   The first item is the cover; a video cover uses a still poster.
4. Choose **Save price list**. Uploading alone does not publish a catalogue
   change. Saving the active year makes changes visible to customers;
   inactive years remain unpublished.

**YouTube alternative:** In the same **Photos & video** section, paste an HTTPS
YouTube URL and select **Add YouTube video**, review the description/credit, then
**Save price list**. Standard watch, `youtu.be`, Shorts, live-video and embed
links are supported. Only the video ID is stored; tracking, playlist and start-time
parameters are discarded. Each product can have either one YouTube video or one
uploaded video, not both. Remove the existing video before replacing it.
YouTube links need no API key or Cloudinary configuration/storage; upload size
and 30-second limits apply only to uploaded files. Links can be added to new
products before their first save. Only link videos you are permitted to publish.

Customers open the keyboard-accessible gallery by selecting the thumbnail,
marked with a compact expand icon. Catalogue cards do not show a play badge;
video playback controls are available inside the gallery.
There is no repeated caption strip; descriptions and credits stay inside the
gallery. Covers are lazy optimized images. Video loads on play, never automatically.
For YouTube, select **Load YouTube player**, then use the embedded player to play
inside the gallery. The privacy-enhanced player is not loaded until requested;
thumbnails are requested from YouTube's image CDN. Loading the player sends only
the site's origin as its identifying Referer, not the page path or customer details.
Closing, changing media or retrying unloads the embedded player. YouTube may show
ads and restrict playback. The video must be available and allow embedding; if
it is private, removed, age/region restricted or embedding is disabled, use the
gallery's **Watch on YouTube** fallback or replace the link. The app validates
the link, not the video's availability, ownership or embedding permission.
Without media, existing category/name icons remain. Preview errors offer retry
or the icon fallback without blocking quantity controls or checkout.
Product numbers remain visible on photo/video covers and preview-error
fallbacks as compact top-left thumbnail badges, without a separate caption strip.

**Retention and privacy:** Files use public Cloudinary delivery, even before
their draft is saved. Upload only permitted product media, never customer data
or private information. Copying a year reuses asset references; later edits
are independent. Removal detaches a reference from the new revision, not from
older revisions, and never deletes Cloudinary assets. Abandoned/rejected
uploads may remain in the Media Library and consume quota. Before manual
cleanup, check all yearly lists and historical revisions; deleting or
overwriting an asset there can break older catalogues. Provider account
quotas, transformations, traffic and file limits still apply. The 30-second
and size limits are checked before attachment, not a guarantee that a rejected
direct upload consumed no provider storage.

Rotate vendor credentials when necessary. New-session authorization and upload
tickets use `VENDOR_SESSION_SECRET`; previously saved assets remain editable
after rotation because the server trusts their persisted immutable metadata.
Unsaved attachment proofs from the old secret must be uploaded again after
sign-in. Media/proofs never enter order snapshots, totals, PDFs or WhatsApp.
As with price edits, **any saved catalogue revision, including media-only
changes, invalidates an older cart** and requires the customer to reselect items.
After deployment, verify one permitted photo and short video with the actual
Cloudinary environment; synthetic local tests do not verify its credentials,
preset, billing limits or production deployment.

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
The season is taken from the selected catalogue year, initially **2026**.
Other years require the vendor to copy/edit and explicitly activate a list;
prices are never invented or changed automatically. Vendor status changes and
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

Sheet records are not imported automatically. Do not flip backends on
an active site without a separate cutover: back up/reconcile IDs, original
timestamps, fingerprints, item snapshots, statuses and totals, pause new writes
for the cutover, and test old-ID retries before reopening. Switching back to
Sheets does not copy new database orders there. Before 2027 launch, agree on
customer-data retention, backups/restore, billing alerts, catalogue updates
and a production migration. PDF retention remains seven days. No automatic
WhatsApp API messaging is added.

## Approved historical order import

Netlify's SQL editor and CLI production connection can be read-only. The
vendor dashboard instead uses the application's database connection at
`/api/vendor-import`. It is disabled unless the site owner sets
`VENDOR_IMPORT_SQL_SHA256` to the SHA-256 of a privately prepared, reviewed
historical import SQL file and redeploys with `ORDER_BACKEND=netlify-db`.
Never commit that file or put it in `vendor-app`: its hex payload contains
customer data and is not encrypted. Do not approve unreviewed or general SQL.

Sign in at `/vendor/`, choose **Import historical requests**, and select the
original approved `.sql` file (maximum 512,000 bytes, 100 requests and 2,000
items). **Preview without saving** executes and rolls back the transaction.
Review the counts/value and hash warnings, acknowledge the historical values,
then choose **Confirm and import** within 15 minutes. Approval is bound to
that exact file and vendor session. Any file edit requires fresh owner review
and configuration, not bypassing the checksum.

The prepared import must atomically validate immutable request/item snapshots,
preserve existing statuses, reject conflicts and be safe to retry. New import
audit events retain source provenance and record the authenticated vendor.
An uncertain response is not proof of failure: check the register before
retrying the same file. No WhatsApp messages are sent. After the migration,
remove `VENDOR_IMPORT_SQL_SHA256` and redeploy to disable further imports.
