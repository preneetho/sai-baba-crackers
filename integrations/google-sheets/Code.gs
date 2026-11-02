var ORDER_HEADERS = [
  "Order ID", "Created at (UTC)", "Status", "Customer name", "Mobile", "Address",
  "Fulfilment", "Preferred date", "Items", "Subtotal (INR)", "Discount (%)",
  "Discount (INR)", "Delivery charge (INR)", "Total (INR)", "Notes", "Payload hash"
];
var ORDER_STATUSES = [
  "New", "Contacted", "Confirmed", "Preparing", "Out for delivery",
  "Ready for pickup", "Completed", "Cancelled"
];

function reply_(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

function orderSheet_() {
  var properties = PropertiesService.getScriptProperties();
  var id = properties.getProperty("SPREADSHEET_ID");
  if (!id || !properties.getProperty("ORDER_TRACKING_SECRET")) {
    throw new Error("Missing script properties");
  }
  var spreadsheet = SpreadsheetApp.openById(id);
  var sheet = spreadsheet.getSheetByName("Orders");
  if (!sheet) sheet = spreadsheet.insertSheet("Orders");
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, ORDER_HEADERS.length).setValues([ORDER_HEADERS]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, ORDER_HEADERS.length).setFontWeight("bold");
    sheet.setColumnWidth(6, 260);
    sheet.setColumnWidth(9, 400);
    sheet.setColumnWidth(15, 260);
    sheet.hideColumns(16);
  }
  var headers = sheet.getRange(1, 1, 1, ORDER_HEADERS.length).getValues()[0];
  if (headers.join("\t") !== ORDER_HEADERS.join("\t")) {
    throw new Error("Orders column layout has changed");
  }
  return sheet;
}

function setupOrdersSheet() {
  var lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    orderSheet_();
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
}

// Explicit text cells prevent customer input from becoming spreadsheet formulas.
function text_(value) {
  return "'" + String(value == null ? "" : value);
}

function doPost(event) {
  var input;
  try {
    if (!event || !event.postData || event.postData.contents.length > 65536) {
      return reply_({ ok: false, error: "INVALID_REQUEST" });
    }
    input = JSON.parse(event.postData.contents);
  } catch (error) {
    return reply_({ ok: false, error: "INVALID_REQUEST" });
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return reply_({ ok: false, error: "INVALID_REQUEST" });
  }
  var secret = PropertiesService.getScriptProperties().getProperty("ORDER_TRACKING_SECRET");
  if (!secret || secret.length < 32 || input.secret !== secret) {
    return reply_({ ok: false, error: "UNAUTHORIZED" });
  }
  var order = input.order;
  if (!order || !/^SBC-[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/.test(order.orderId) ||
      !/^[0-9a-f]{64}$/.test(order.fingerprint) || !order.customer ||
      (order.customer.fulfilment !== "delivery" && order.customer.fulfilment !== "pickup") ||
      !Array.isArray(order.items) || order.items.length < 1 || order.items.length > 68 ||
      !order.amounts || !isFinite(order.amounts.total) || order.amounts.total < 0 ||
      order.amounts.deliveryCharge !== 0 || !isFinite(Date.parse(order.createdAt))) {
    return reply_({ ok: false, error: "INVALID_ORDER" });
  }
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return reply_({ ok: false, error: "BUSY" });
  try {
    var sheet = orderSheet_();
    var lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      var existing = sheet.getRange(2, 1, lastRow - 1, 1).createTextFinder(order.orderId)
        .matchEntireCell(true).useRegularExpression(false).findNext();
      if (existing) {
        if (sheet.getRange(existing.getRow(), 16).getValue() !== order.fingerprint) {
          return reply_({ ok: false, error: "CONFLICT" });
        }
        return reply_({ ok: true, orderId: order.orderId });
      }
    }
    var customer = order.customer;
    var items = order.items.map(function (item) {
      return "#" + item.id + " " + item.name + " | " + item.brand +
        " | " + item.unit + " | Qty " + item.quantity +
        " x Rs." + item.price.toFixed(2) + " = Rs." + item.amount.toFixed(2);
    }).join("\n");
    var row = [
      order.orderId, text_(order.createdAt), "New", text_(customer.name),
      text_("+91 " + customer.phone), text_(customer.address),
      customer.fulfilment === "delivery" ? "Free home delivery" : "Store pickup",
      text_(customer.preferredDate), text_(items), order.amounts.subtotal,
      order.amounts.discountPercent, order.amounts.discount, 0,
      order.amounts.total, text_(customer.notes), order.fingerprint
    ];
    var nextRow = lastRow + 1;
    if (nextRow > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), 1);
    sheet.getRange(nextRow, 1, 1, ORDER_HEADERS.length).setValues([row]);
    sheet.getRange(nextRow, 3).setDataValidation(SpreadsheetApp.newDataValidation()
      .requireValueInList(ORDER_STATUSES, true).setAllowInvalid(false).build());
    sheet.getRange(nextRow, 10, 1, 5).setNumberFormat("0.00");
    SpreadsheetApp.flush();
    return reply_({ ok: true, orderId: order.orderId });
  } catch (error) {
    console.error("Order sheet write failed. Check sheet permissions and column layout.");
    return reply_({ ok: false, error: "WRITE_FAILED" });
  } finally {
    lock.releaseLock();
  }
}
