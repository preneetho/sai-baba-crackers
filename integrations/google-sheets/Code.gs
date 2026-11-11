var ORDER_HEADERS = [
  "Order ID", "Created at (UTC)", "Status", "Customer name", "Mobile", "Address",
  "Fulfilment", "Preferred date", "Items", "Subtotal (INR)", "Discount (%)",
  "Discount (INR)", "Delivery charge (INR)", "Total (INR)", "Notes", "Payload hash",
  "Order date & time (IST)", "Coupon code"
];
var ORDER_STATUSES = [
  "New", "Contacted", "Confirmed", "Preparing", "Out for delivery",
  "Ready for pickup", "Completed", "Cancelled"
];

function reply_(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

function createdAt_(value) {
  if (typeof value === "string") {
    value = value.replace(/^'/, "");
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
      throw new Error("Stored order timestamp is invalid");
    }
  } else if (Object.prototype.toString.call(value) !== "[object Date]") {
    throw new Error("Stored order timestamp is missing");
  }
  var date = new Date(value);
  if (!isFinite(date.getTime())) throw new Error("Stored order timestamp is invalid");
  var canonical = date.toISOString();
  if (typeof value === "string" && canonical !== value) {
    throw new Error("Stored order timestamp is invalid");
  }
  return canonical;
}

function orderTime_(createdAt) {
  return Utilities.formatDate(new Date(createdAt), "Asia/Kolkata", "yyyy-MM-dd HH:mm:ss 'IST'");
}

function backfillOrderTimes_(sheet) {
  var count = sheet.getLastRow() - 1;
  if (count < 1) return;
  var times = sheet.getRange(2, 1, count, 2).getValues().map(function (row, index) {
    if (!row[1]) {
      if (row[0]) console.warn("Order row " + (index + 2) + " has no stored timestamp; local time left blank.");
      return [""];
    }
    return [text_(orderTime_(createdAt_(row[1])))];
  });
  sheet.getRange(2, 17, count, 1).setValues(times);
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
  if (sheet.getMaxColumns() < ORDER_HEADERS.length) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), ORDER_HEADERS.length - sheet.getMaxColumns());
  }
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, ORDER_HEADERS.length).setValues([ORDER_HEADERS]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, ORDER_HEADERS.length).setFontWeight("bold");
    sheet.setColumnWidth(6, 260);
    sheet.setColumnWidth(9, 400);
    sheet.setColumnWidth(15, 260);
    sheet.setColumnWidth(2, 220);
    sheet.setColumnWidth(17, 220);
    sheet.hideColumns(16);
  }
  var headers = sheet.getRange(1, 1, 1, 16).getValues()[0];
  if (headers.join("\t") !== ORDER_HEADERS.slice(0, 16).join("\t")) {
    throw new Error("Orders column layout has changed");
  }
  var timeHeader = sheet.getRange(1, 17).getValue();
  if (timeHeader === "") {
    backfillOrderTimes_(sheet);
    sheet.getRange(1, 17).setValues([[ORDER_HEADERS[16]]]).setFontWeight("bold");
    sheet.setColumnWidth(17, 220);
  } else if (timeHeader !== ORDER_HEADERS[16]) {
    throw new Error("Column Q is already in use; move its custom data before adding order times");
  }
  var couponHeader = sheet.getRange(1, 18).getValue();
  if (couponHeader === "") {
    sheet.getRange(1, 18).setValues([[ORDER_HEADERS[17]]]).setFontWeight("bold");
  } else if (couponHeader !== ORDER_HEADERS[17]) {
    throw new Error("Column R is already in use; move its custom data before adding coupon codes");
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

function dashboardText_(value) {
  return String(value == null ? "" : value).replace(/^'/, "");
}

function dashboardOrder_(row, full) {
  var order = {
    orderId: row[0], createdAt: createdAt_(row[1]), status: row[2],
    name: dashboardText_(row[3]), phone: dashboardText_(row[4]),
    fulfilment: row[6], total: row[13]
  };
  if (!/^SBC-[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/.test(order.orderId) ||
      ORDER_STATUSES.indexOf(order.status) < 0 || typeof order.fulfilment !== "string" ||
      typeof order.total !== "number" || !isFinite(order.total) || order.total < 0) {
    throw new Error("Invalid stored order");
  }
  if (full) {
    order.address = dashboardText_(row[5]);
    order.preferredDate = dashboardText_(row[7]);
    order.items = dashboardText_(row[8]);
    order.subtotal = row[9];
    order.discountPercent = row[10];
    order.discount = row[11];
    order.deliveryCharge = row[12];
    order.notes = dashboardText_(row[14]);
    order.couponCode = dashboardText_(row[17]);
    [order.subtotal, order.discountPercent, order.discount, order.deliveryCharge].forEach(function (amount) {
      if (typeof amount !== "number" || !isFinite(amount) || amount < 0) throw new Error("Invalid stored amount");
    });
  }
  return order;
}

function dashboardAction_(input) {
  var list = input.action === "vendor-list";
  var detail = input.action === "vendor-detail";
  var update = input.action === "vendor-status";
  if ((!list && !detail && !update) ||
      (!list && !/^SBC-[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/.test(input.orderId || "")) ||
      (update && (ORDER_STATUSES.indexOf(input.status) < 0 || ORDER_STATUSES.indexOf(input.expectedStatus) < 0)) ||
      (list && (typeof input.query !== "string" || input.query.length > 80 ||
        /[\u0000-\u001f\u007f]/.test(input.query) ||
        (input.status !== "" && ORDER_STATUSES.indexOf(input.status) < 0) ||
        !Number.isInteger(input.page) || input.page < 1 || input.page > 400))) {
    return reply_({ ok: false, error: "INVALID_REQUEST" });
  }
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return reply_({ ok: false, error: "BUSY" });
  try {
    var sheet = orderSheet_();
    var count = sheet.getLastRow() - 1;
    if (!list) {
      var existing = count > 0 ? sheet.getRange(2, 1, count, 1).createTextFinder(input.orderId)
        .matchEntireCell(true).useRegularExpression(false).findNext() : null;
      if (!existing) return reply_({ ok: false, error: "NOT_FOUND" });
      var rowNumber = existing.getRow();
      var row = sheet.getRange(rowNumber, 1, 1, ORDER_HEADERS.length).getValues()[0];
      if (update) {
        if (row[2] !== input.expectedStatus) return reply_({ ok: false, error: "STATUS_CONFLICT" });
        dashboardOrder_(row, true);
        sheet.getRange(rowNumber, 3).setValue(input.status);
        SpreadsheetApp.flush();
        row[2] = input.status;
      }
      return reply_({ ok: true, order: dashboardOrder_(row, true) });
    }
    if (count > 10000) return reply_({ ok: false, error: "REGISTER_TOO_LARGE" });
    var query = input.query.toLowerCase();
    var phoneQuery = query.replace(/[+\s()-]/g, "");
    var orders = count > 0 ? sheet.getRange(2, 1, count, 17).getValues()
      .filter(function (row) { return row[0] !== ""; })
      .map(function (row) { return dashboardOrder_(row, false); })
      .filter(function (order) {
        var matches = !query || order.orderId.toLowerCase().indexOf(query) >= 0 ||
          order.name.toLowerCase().indexOf(query) >= 0 ||
          (phoneQuery && order.phone.replace(/[+\s()-]/g, "").indexOf(phoneQuery) >= 0);
        return matches && (!input.status || order.status === input.status);
      }) : [];
    orders.sort(function (a, b) {
      return b.createdAt.localeCompare(a.createdAt) || b.orderId.localeCompare(a.orderId);
    });
    var stats = { requestValue: 0 };
    ORDER_STATUSES.forEach(function (status) { stats[status] = 0; });
    orders.forEach(function (order) {
      stats[order.status]++;
      if (typeof order.total !== "number" || !isFinite(order.total) || order.total < 0) throw new Error("Invalid stored total");
      if (order.status !== "Cancelled") stats.requestValue += order.total;
    });
    stats.requestValue = Math.round(stats.requestValue * 100) / 100;
    var start = (input.page - 1) * 25;
    return reply_({ ok: true, orders: orders.slice(start, start + 25), total: orders.length,
      page: input.page, stats: stats });
  } catch (error) {
    console.error("Vendor Sheet operation failed. Check permissions, column layout and stored values.");
    return reply_({ ok: false, error: "DASHBOARD_FAILED" });
  } finally {
    lock.releaseLock();
  }
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
  if (input.action) return dashboardAction_(input);
  var order = input.order;
  if (!order || !/^SBC-[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/.test(order.orderId) ||
      !/^[0-9a-f]{64}$/.test(order.fingerprint) || !order.customer ||
      (order.customer.fulfilment !== "delivery" && order.customer.fulfilment !== "pickup") ||
      !Array.isArray(order.items) || order.items.length < 1 || order.items.length > 68 ||
      !order.amounts || !isFinite(order.amounts.total) || order.amounts.total < 0 ||
      typeof order.amounts.deliveryCharge !== "number" || !isFinite(order.amounts.deliveryCharge) ||
      order.amounts.deliveryCharge < 0 ||
      typeof order.amounts.discountPercent !== "number" || !Number.isInteger(order.amounts.discountPercent) ||
      order.amounts.discountPercent < 0 || order.amounts.discountPercent > 100 ||
      (order.amounts.couponCode !== undefined && (typeof order.amounts.couponCode !== "string" ||
        (order.amounts.couponCode !== "" && !/^[A-Z0-9][A-Z0-9_-]{1,23}$/.test(order.amounts.couponCode)))) ||
      typeof order.createdAt !== "string") {
    return reply_({ ok: false, error: "INVALID_ORDER" });
  }
  var createdAt;
  try {
    createdAt = createdAt_(order.createdAt);
  } catch (error) {
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
        return reply_({
          ok: true, orderId: order.orderId,
          createdAt: createdAt_(sheet.getRange(existing.getRow(), 2).getValue())
        });
      }
    }
    var customer = order.customer;
    var items = order.items.map(function (item) {
      return "#" + item.id + " " + item.name + " | " + item.brand +
        " | " + item.unit + " | Qty " + item.quantity +
        " x Rs." + item.price.toFixed(2) + " = Rs." + item.amount.toFixed(2);
    }).join("\n");
    var row = [
      order.orderId, text_(createdAt), "New", text_(customer.name),
      text_("+91 " + customer.phone), text_(customer.address),
      customer.fulfilment === "delivery" ? (order.amounts.deliveryCharge === 0 ? "Free home delivery" : "Home delivery") : "Store pickup",
      text_(customer.preferredDate), text_(items), order.amounts.subtotal,
      order.amounts.discountPercent, order.amounts.discount, order.amounts.deliveryCharge,
      order.amounts.total, text_(customer.notes), order.fingerprint, text_(orderTime_(createdAt)),
      text_(order.amounts.couponCode || "")
    ];
    var nextRow = lastRow + 1;
    if (nextRow > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), 1);
    sheet.getRange(nextRow, 1, 1, ORDER_HEADERS.length).setValues([row]);
    sheet.getRange(nextRow, 3).setDataValidation(SpreadsheetApp.newDataValidation()
      .requireValueInList(ORDER_STATUSES, true).setAllowInvalid(false).build());
    sheet.getRange(nextRow, 10, 1, 5).setNumberFormat("0.00");
    SpreadsheetApp.flush();
    return reply_({ ok: true, orderId: order.orderId, createdAt: createdAt });
  } catch (error) {
    console.error("Order sheet write failed. Check sheet permissions, column layout and stored timestamps.");
    return reply_({ ok: false, error: "WRITE_FAILED" });
  } finally {
    lock.releaseLock();
  }
}
