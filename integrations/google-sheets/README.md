# Google Sheets order tracking setup

The website records a requirement before it prepares WhatsApp. It uses a Netlify
Function to validate the order and call a Google Apps Script web app. Customers
never receive the script URL or shared secret. The spreadsheet stays private.

**The spreadsheet URL is not the webhook URL.** This setup is required before
publishing this version; without it, checkout reports that recording is unavailable
and does not offer a success-shaped WhatsApp fallback.

## 1. Prepare the vendor's sheet

1. Open the order-tracking spreadsheet while signed in as its owner.
2. Keep **Share > General access > Restricted**. Invite only authorized vendor
   staff. Do not publish the sheet or enable public editing.
3. Copy the spreadsheet ID from its URL:
   `https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit`.
4. Choose **Extensions > Apps Script**.
5. Replace the editor's starter code with the contents of the adjacent `Code.gs`
   file and save the project.

## 2. Configure Apps Script

Generate a private random secret on your own computer:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

In Apps Script, open **Project Settings > Script properties** and add:

| Property | Value |
|---|---|
| `SPREADSHEET_ID` | The ID copied from the sheet URL |
| `ORDER_TRACKING_SECRET` | The generated random secret |

Keep the secret private. Do not commit it, put it in website JavaScript, or paste
it into chat. It must match the value configured in Netlify.

Return to the editor, select **setupOrdersSheet**, and click **Run**. Review and
authorize the access requested by your own script. Follow your organization's
Google Workspace policies; do not bypass admin restrictions. This creates an
`Orders` tab with the expected headers. It does not erase existing tabs.

## 3. Deploy the Apps Script web app

Choose **Deploy > New deployment > Web app**:

- **Execute as:** the vendor/owner account.
- **Who has access:** Anyone. This exposes only the script endpoint; the
  spreadsheet itself remains Restricted. The script rejects requests without
  the private shared secret and provides no order-reading endpoint.

Deploy and copy the **Web app URL**, which must have this form:

```text
https://script.google.com/macros/s/DEPLOYMENT_ID/exec
```

Do not use the test `/dev` URL. If organizational policy prevents this web-app
configuration, stop and ask the Google Workspace administrator for an approved
integration; do not make the spreadsheet public.

When changing script code later, update the deployment to a **new version**.
Saving code alone does not update the deployed web app.

## 4. Configure Netlify and deploy the code

In your Netlify project's environment variables, add these values with the
**Functions** scope (or all scopes when individual scopes are unavailable):

| Variable | Value |
|---|---|
| `GOOGLE_SHEETS_WEBHOOK_URL` | The deployed Apps Script `/exec` URL |
| `ORDER_TRACKING_SECRET` | The same secret stored in Apps Script |

Do not add secrets to `netlify.toml` or the public `vendor-app` directory.
Commit all updated source directories, including `netlify`, `integrations`,
`scripts`, `tests`, `vendor-app`, and the root `netlify.toml` and `package.json`.

The configuration keeps the base at `vendor-app`, publishes `.`, and deploys
functions from `../netlify/functions`. No build command or npm dependencies are
needed. Use a Git-connected deployment, not a static drag-and-drop upload.
Trigger a new deployment after adding or changing environment variables.

Check the deploy log for the `orders` function and its rate-limit rule. The rule
allows 10 requests per minute per domain and IP; Netlify enforcement can lag by
up to 10 seconds. This is basic abuse protection, not customer authentication or
a hard overall request cap. Google Apps Script and Netlify quotas still apply.

## 5. Verify the real integration

1. Open the deployed site and add two Ground Chakkar Big units plus one Flower
   Pot Special: subtotal Rs.370, discount Rs.55.50, total Rs.314.50.
2. Choose free home delivery or store pickup, enter test contact details and an
   address, and agree to recording the requirement.
3. Submit. The site should show a reference starting `SBC-` only after Google
   Sheets acknowledges the write. Verify the same ID in the sheet and WhatsApp
   message; opening a message does not send it.
4. Verify home delivery costs zero, the address and method are recorded, and the
   15% discounted total is correct.
5. Repeat with store pickup and verify that no delivery date/charge is claimed.
6. Retry unchanged details in the same open review. There must still be one row
   for that reference. Different details create a new reference.
7. Remove test rows once verification is complete.

`GET /api/orders` reports whether the server environment is configured. It does
not verify Google permissions or prove that a sheet write will succeed; the
real submission above is required.

## Vendor workflow

Each row includes its ID, timestamp, customer contact/address, delivery or pickup
choice, preferred date, item quantities/rates/amounts, subtotal, 15% discount,
zero delivery charge, total, notes, and status.

The vendor updates **Status** directly in Google Sheets:
New, Contacted, Confirmed, Preparing, Out for delivery, Ready for pickup,
Completed, or Cancelled. Status is not automatically inferred from WhatsApp.
The vendor must confirm availability, delivery service area/timing, and the sale.

Keep the first row and all required columns intact, including the hidden
**Payload hash** column. Do not delete the hash or change an order ID. Filter or
sort the entire table, including hidden columns, so rows remain aligned.
Retries never overwrite vendor-maintained statuses.

If a customer revises a recorded requirement, a new reference is recorded.
Confirm with the customer which reference to fulfil and cancel obsolete records.
On a timeout or acknowledgement error, retry unchanged details with the review
still open to reuse the same reference. Closing and starting again creates a
new reference and can produce a second enquiry if the first write succeeded.

Customer text is stored as literal cells to prevent spreadsheet formula
execution. Prices and discounts are recalculated on the server from the
catalogue; client-supplied prices and statuses are not trusted. Sheets is suitable
for this small vendor workflow, not an authenticated order-management database.

The vendor owns access control, retention, corrections and deletion of customer
records. The site clears contact details from the review when closed, but this
does not delete previously saved spreadsheet rows or copies in WhatsApp.
