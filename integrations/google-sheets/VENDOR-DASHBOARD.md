# Vendor dashboard setup

The dashboard lives at **https://saibabacrackers.netlify.app/vendor/**.
By default it reads the existing private `Orders` Sheet and updates its Status column.
Customer checkout, pricing, PDF retention and WhatsApp handoff are unchanged.
An opt-in Netlify Database backend is also available; follow the
[database development setup](../../README.md#netlify-database-development)
instead of step 1 when `ORDER_BACKEND=netlify-db`. Google sign-in and its
approved-email restrictions remain the same for either backend. There is no
customer login or automated customer notification.

## 1. Update the existing Apps Script deployment

Replace the deployed project's `Code.gs` with the latest
[Code.gs](Code.gs). Keep `SPREADSHEET_ID` and `ORDER_TRACKING_SECRET`
unchanged. Run `setupOrdersSheet` if needed; do not rearrange columns A-Q.
Choose **Deploy > Manage deployments**, edit the existing deployment,
select **New version**, and deploy. Keep the existing `/exec` URL.
Saving code in the editor alone does not update the web app.

The Sheet must remain **Restricted**, not published or publicly editable.
The web app still executes as its owner and accepts only secret-authenticated
server requests. Its new actions are listing, request details and status updates.
The Netlify vendor endpoints require an approved Google session before calling
any of these actions. Do not expose the shared secret to a browser.

## 2. Create a Google OAuth web client

In [Google Cloud Console](https://console.cloud.google.com/auth/overview),
select a project controlled by the shop owner.

1. In **Google Auth Platform > Branding**, set the application name, support
   email and developer contact details. Use a clear name such as
   `Sai Baba Crackers Vendor Dashboard`.
2. In **Audience**, choose an audience that includes your vendors. Internal
   applies only to users in your Google Workspace organization. For ordinary
   Gmail accounts use External; while Testing, add each vendor as a test user.
   Follow Google's publishing and verification requirements before regular use.
   The dashboard's own email allowlist is required in either mode.
3. In **Clients**, choose **Create client > Web application**.
4. Add this exact **Authorized redirect URI**:

   ```text
   https://saibabacrackers.netlify.app/api/vendor-auth/callback
   ```

5. Keep the client ID and client secret private. They go in Netlify's server
   environment, never in source, a screenshot or chat.

Only `openid email` scopes are requested. This sign-in does not request the
vendor's Google Sheets or Google Drive permissions. The existing owner-controlled
Apps Script integration remains responsible for accessing the order Sheet.
No Google browser SDK, third-party script or new frontend dependency is required.

## 3. Configure Netlify

Add these environment variables with **Functions** scope on the production
deployment. Do not put them in `netlify.toml` or any public file.

| Variable | Value |
|---|---|
| `VENDOR_APP_ORIGIN` | `https://saibabacrackers.netlify.app` |
| `VENDOR_GOOGLE_CLIENT_ID` | Web application's Google OAuth client ID |
| `VENDOR_GOOGLE_CLIENT_SECRET` | Its Google OAuth client secret |
| `VENDOR_ALLOWED_EMAILS` | Comma-separated exact approved Google email addresses |
| `VENDOR_SESSION_SECRET` | A new independently generated random secret, at least 32 characters |

Generate the session secret privately on your computer:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Keep the existing `GOOGLE_SHEETS_WEBHOOK_URL` and `ORDER_TRACKING_SECRET`.
Do not reuse the Sheet secret as the session secret. Example allowlist syntax:
`owner@example.com,staff@example.com`; replace these examples with the actual
approved accounts. Google must report each account's email as verified.
Matching is exact and case-insensitive; wildcards and whole-domain approval are
not supported. Every approved account can view all requests and change statuses.

Commit/push the updated source and trigger a Git-connected Netlify deployment.
The deploy must include `vendor-auth` and `vendor-orders`, in addition to the
existing order/PDF functions. Drag-and-drop static hosting is insufficient.
Adding environment variables without redeploying is insufficient.

The configured origin and Google redirect URI must match exactly. If you move
to a custom domain, update both and redeploy. Deploy-preview domains are not
authorized by a production origin; configure separate credentials and a
non-production Sheet for testing rather than copying production access.

## 4. Use and verify the dashboard

1. Open `/vendor/` and choose **Sign in with Google** using an approved account.
2. Check a known request's ID, original IST timestamp, customer details, full
   line-item text and estimated totals against the Sheet.
3. Search by customer name, phone or request ID. Apply a status filter.
   Pages contain 25 requests, newest recorded first. **Refresh requests** checks
   for new requests; the dashboard does not poll automatically.
4. Open a request, choose a different status, and click **Save status**.
   Only column C changes. If another vendor changed it since you opened it,
   the save is rejected; reload before deciding the next status.
5. Verify that an unchanged customer submission retry still retains the
   original reference, timestamp and vendor-maintained status.
6. Sign out. Try an unapproved account and check that it cannot read orders.
   Use synthetic test contact details, not real customer data, when testing.

The existing statuses are New, Contacted, Confirmed, Preparing, Out for delivery,
Ready for pickup, Completed and Cancelled. Updating them does not send messages,
confirm a payment or create a binding sale. The vendor must contact the customer
separately. Estimated request value excludes cancelled requests and is **not
revenue**. Counts/value reflect the applied filters, not just the current page.

The Sheets backend supports a register of up to 10,000 data rows. Beyond that it
reports an explicit error instead of showing incomplete results; customer
recording still works. Do not delete or move original rows solely to bypass this
limit: customer retries look up their original request IDs in `Orders`. Larger
registers need a separately planned indexed storage or archive solution that
preserves request-ID lookup, timestamps and vendor retention requirements.
The database backend does not have this Sheet row cap. It stores item/price
snapshots and authenticated status-change audit records transactionally.

## Yearly price lists (Netlify Database only)

After deploying the tracked annual-catalogue migration, choose **Manage yearly
price lists** in the dashboard. Select a year to edit products and prices, or
copy the selected saved list into a new year. Save your changes, then explicitly
choose **Make this the active year** when that year should be visible to
customers. The original 2026 list is seeded automatically; no manual SQL import
or new credentials are required.

There is exactly one active year and no automatic rollover. Saving an active
list updates new-request prices immediately after confirmation. Existing order
snapshots are unchanged, and the 15% customer discount remains in place.
Conflicting edits require a reload rather than overwriting another vendor's
changes. See the [yearly-price guide](../../README.md#yearly-database-price-lists)
for limits, stale-cart behavior and deployment details. This editor is not
available when the order backend is Google Sheets.
Old Sheet orders are not automatically copied or combined with database orders.

## Privacy, sessions and access removal

- Sign-in uses a short-lived, signed state cookie and PKCE. Google access tokens
  are used server-side to check identity and are not stored or returned to the
  browser.
- Vendor sessions last eight hours, use a signed HttpOnly, Secure, SameSite cookie
  in production and do not refresh automatically. Status changes and logout
  require a same-origin request plus a session-bound CSRF token.
- The allowlist is checked on every request. To remove staff access, remove the
  email from the environment and redeploy. Rotate `VENDOR_SESSION_SECRET` and
  redeploy to invalidate all existing sessions. Signing out clears that browser's
  cookie; it is not a global revocation of copied/stolen session tokens.
- Responses are private/no-store. Names, phone numbers and addresses are not
  stored in browser local storage, URLs or telemetry. The page clears private content on sign-out,
  expiry and page exit. Do not leave a signed-in shared device unattended.
- Request IDs may appear in private API request URLs and therefore server
  observability. Do not share logs, screenshots or dashboard contents publicly.
  Google owns its authentication-page telemetry; the dashboard adds no analytics.
- The permanent Sheet remains vendor-controlled. This feature does not change
  its retention rules or the separate seven-day PDF links.

## Local preview and troubleshooting

Without configuration, the page reports that vendor sign-in is unavailable and
never displays real requests. To exercise Google sign-in locally, add
`http://127.0.0.1:4173/api/vendor-auth/callback` to a separate test web client and
set `VENDOR_APP_ORIGIN` to `http://127.0.0.1:4173` in the preview process, alongside
the other settings and a non-production Sheet. HTTP cookies are allowed only
for loopback development; production requires HTTPS.

- **redirect_uri_mismatch:** Correct the exact callback URI in the Google web
  client and the configured origin.
- **Access denied:** Check both Google Audience/test-user restrictions and
  `VENDOR_ALLOWED_EMAILS`. Being invited to the Sheet alone is not dashboard
  approval.
- **Not configured:** Check Functions-scoped variables and redeploy.
- **Sheet operation not confirmed:** Ensure the latest Apps Script deployment
  is active, the webhook URL/secret match, and A-Q have the expected layout.
  Inspect the Sheet before retrying an uncertain status write.
- **Concurrent status change:** Reload the request and review its current status.

Google references:
[OpenID Connect setup](https://developers.google.com/identity/openid-connect/openid-connect)
and [server-side OAuth](https://developers.google.com/identity/protocols/oauth2/web-server).
