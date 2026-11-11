import { sql } from "drizzle-orm";
import { pgTable, text, integer, timestamp, uuid, index, primaryKey, check } from "drizzle-orm/pg-core";
import { ORDER_STATUSES } from "../../vendor-app/vendor-model.mjs";

const statuses = sql.raw(ORDER_STATUSES.map(status => `'${status}'`).join(", "));
const instant = name => timestamp(name, { withTimezone: true, precision: 3, mode: "string" });

export const orderRequests = pgTable("order_requests", {
  orderId: text("order_id").primaryKey(),
  fingerprint: text("fingerprint").notNull(),
  season: integer("season").notNull(),
  catalogueRevision: integer("catalogue_revision"),
  createdAt: instant("created_at").notNull(),
  status: text("status").notNull().default("New"),
  name: text("name").notNull(),
  phone: text("phone").notNull(),
  address: text("address").notNull(),
  fulfilment: text("fulfilment").notNull(),
  preferredDate: text("preferred_date").notNull(),
  notes: text("notes").notNull(),
  subtotalPaise: integer("subtotal_paise").notNull(),
  discountPercent: integer("discount_percent").notNull(),
  couponCode: text("coupon_code").notNull().default(""),
  discountPaise: integer("discount_paise").notNull(),
  deliveryChargePaise: integer("delivery_charge_paise").notNull(),
  totalPaise: integer("total_paise").notNull(),
}, table => [
  index("order_requests_time_idx").on(table.createdAt.desc(), table.orderId.asc()),
  index("order_requests_status_time_idx").on(table.status, table.createdAt.desc()),
  index("order_requests_season_idx").on(table.season),
  check("order_requests_status_check", sql`${table.status} in (${statuses})`),
  check("order_requests_fulfilment_check", sql`${table.fulfilment} in ('delivery', 'pickup')`),
  check("order_requests_season_check", sql`${table.season} between 2000 and 9999`),
  check("order_requests_money_check", sql`${table.subtotalPaise} >= 0 and ${table.discountPaise} >= 0
    and ${table.deliveryChargePaise} >= 0 and ${table.totalPaise} >= 0
    and ${table.discountPercent} between 0 and 100
    and ${table.totalPaise} = ${table.subtotalPaise} - ${table.discountPaise} + ${table.deliveryChargePaise}`),
]);

export const orderItems = pgTable("order_items", {
  orderId: text("order_id").notNull().references(() => orderRequests.orderId),
  position: integer("position").notNull(),
  productId: integer("product_id").notNull(),
  name: text("name").notNull(),
  brand: text("brand").notNull(),
  unit: text("unit").notNull(),
  quantity: integer("quantity").notNull(),
  unitPricePaise: integer("unit_price_paise").notNull(),
  amountPaise: integer("amount_paise").notNull(),
}, table => [
  primaryKey({ columns: [table.orderId, table.position] }),
  check("order_items_values_check", sql`${table.position} >= 0 and ${table.productId} > 0
    and ${table.quantity} between 1 and 99 and ${table.unitPricePaise} >= 0
    and ${table.amountPaise} = ${table.unitPricePaise} * ${table.quantity}`),
]);

export const orderStatusHistory = pgTable("order_status_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: text("order_id").notNull().references(() => orderRequests.orderId),
  fromStatus: text("from_status"),
  toStatus: text("to_status").notNull(),
  actor: text("actor").notNull(),
  changedAt: instant("changed_at").notNull().defaultNow(),
}, table => [
  index("order_status_history_order_idx").on(table.orderId, table.changedAt),
  check("order_status_history_status_check", sql`${table.toStatus} in (${statuses})
    and (${table.fromStatus} is null or ${table.fromStatus} in (${statuses}))`),
]);
