import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import { orderRequests, orderItems, orderStatusHistory } from "./order-schema.mjs";
import { ORDER_STATUSES, PAGE_SIZE } from "../../vendor-app/vendor-model.mjs";
import { vendor } from "../../vendor-app/catalog.mjs";

function paise(value) {
  const amount = Math.round(value * 100);
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > 2147483647 ||
      Math.abs(amount / 100 - value) > 0.0000001) {
    throw new Error("Invalid recorded order amount.");
  }
  return amount;
}

function summary(row) {
  return {
    orderId: row.orderId, createdAt: new Date(row.createdAt).toISOString(),
    status: row.status, name: row.name, phone: `+91 ${row.phone}`,
    fulfilment: row.fulfilment === "delivery" ? "Free home delivery" : "Store pickup",
    total: row.totalPaise / 100,
  };
}

async function detail(tx, orderId) {
  const [row] = await tx.select().from(orderRequests).where(eq(orderRequests.orderId, orderId));
  if (!row) return { ok: false, error: "NOT_FOUND" };
  const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId)).orderBy(asc(orderItems.position));
  if (!items.length) throw new Error("Recorded order has no line items.");
  return { ok: true, order: {
    ...summary(row), address: row.address, preferredDate: row.preferredDate, notes: row.notes,
    subtotal: row.subtotalPaise / 100, discountPercent: row.discountPercent,
    discount: row.discountPaise / 100, deliveryCharge: row.deliveryChargePaise / 100,
    items: items.map(item => `#${item.productId} ${item.name} | ${item.brand}\nPack: ${item.unit}\n${item.quantity} pack${item.quantity === 1 ? "" : "s"} x Rs.${(item.unitPricePaise / 100).toFixed(2)} = Rs.${(item.amountPaise / 100).toFixed(2)}`).join("\n\n"),
  } };
}

export function createOrderDatabase(db) {
  async function transaction(operation, readOnly = false) {
    return db.transaction(async tx => {
      await tx.execute(sql`set local statement_timeout = '15s'`);
      await tx.execute(sql`set local lock_timeout = '5s'`);
      return operation(tx);
    }, readOnly ? { isolationLevel: "repeatable read", accessMode: "read only" } : undefined);
  }

  return {
    async ready() {
      await transaction(async tx => {
        await tx.select().from(orderRequests).limit(0);
        await tx.select().from(orderItems).limit(0);
        await tx.select().from(orderStatusHistory).limit(0);
      }, true);
    },
    async save(order) {
      return transaction(async tx => {
        const inserted = await tx.insert(orderRequests).values({
          orderId: order.orderId, fingerprint: order.fingerprint, season: Number(vendor.year),
          createdAt: order.createdAt, status: "New", ...order.customer,
          subtotalPaise: paise(order.amounts.subtotal), discountPercent: order.amounts.discountPercent,
          discountPaise: paise(order.amounts.discount), deliveryChargePaise: paise(order.amounts.deliveryCharge),
          totalPaise: paise(order.amounts.total),
        }).onConflictDoNothing({ target: orderRequests.orderId }).returning({ orderId: orderRequests.orderId });
        if (!inserted.length) {
          const [existing] = await tx.select({
            fingerprint: orderRequests.fingerprint, createdAt: orderRequests.createdAt,
          }).from(orderRequests).where(eq(orderRequests.orderId, order.orderId));
          if (!existing) throw new Error("Existing request could not be confirmed.");
          return existing.fingerprint === order.fingerprint ?
            { ok: true, orderId: order.orderId, createdAt: new Date(existing.createdAt).toISOString() } :
            { ok: false, error: "CONFLICT" };
        }
        if (!order.items.length) throw new Error("An order requires line items.");
        await tx.insert(orderItems).values(order.items.map((item, position) => ({
          orderId: order.orderId, position, productId: item.id, name: item.name, brand: item.brand,
          unit: item.unit, quantity: item.quantity, unitPricePaise: paise(item.price), amountPaise: paise(item.amount),
        })));
        await tx.insert(orderStatusHistory).values({
          orderId: order.orderId, fromStatus: null, toStatus: "New", actor: "customer submission",
          changedAt: order.createdAt,
        });
        return { ok: true, orderId: order.orderId, createdAt: order.createdAt };
      });
    },
    async dashboard(input, actor) {
      return transaction(async tx => {
        if (input.action === "vendor-detail") return detail(tx, input.orderId);
        if (input.action === "vendor-status") {
          const updated = await tx.update(orderRequests).set({ status: input.status }).where(and(
            eq(orderRequests.orderId, input.orderId), eq(orderRequests.status, input.expectedStatus),
          )).returning({ orderId: orderRequests.orderId });
          if (!updated.length) {
            const [existing] = await tx.select({ orderId: orderRequests.orderId }).from(orderRequests)
              .where(eq(orderRequests.orderId, input.orderId));
            return { ok: false, error: existing ? "STATUS_CONFLICT" : "NOT_FOUND" };
          }
          if (input.status !== input.expectedStatus) {
            await tx.insert(orderStatusHistory).values({
              orderId: input.orderId, fromStatus: input.expectedStatus, toStatus: input.status, actor,
            });
          }
          return detail(tx, input.orderId);
        }
        if (input.action !== "vendor-list") throw new Error("Unknown database action.");
        const filters = [];
        if (input.status) filters.push(eq(orderRequests.status, input.status));
        if (input.query) {
          const escaped = `%${input.query.replace(/[\\%_]/g, "\\$&")}%`;
          const search = [ilike(orderRequests.name, escaped), ilike(orderRequests.orderId, escaped)];
          if (/^[\d\s()+-]+$/.test(input.query) && /\d/.test(input.query)) {
            let digits = input.query.replace(/\D/g, "");
            if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
            search.push(ilike(orderRequests.phone, `%${digits}%`));
          }
          filters.push(or(...search));
        }
        const where = and(...filters);
        const grouped = await tx.select({
          status: orderRequests.status, count: sql`count(*)`.mapWith(Number),
          amount: sql`coalesce(sum(${orderRequests.totalPaise}), 0)`.mapWith(Number),
        }).from(orderRequests).where(where).groupBy(orderRequests.status);
        const stats = { requestValue: 0, ...Object.fromEntries(ORDER_STATUSES.map(status => [status, 0])) };
        let total = 0;
        for (const group of grouped) {
          stats[group.status] = group.count;
          total += group.count;
          if (group.status !== "Cancelled") stats.requestValue += group.amount;
        }
        stats.requestValue /= 100;
        const rows = await tx.select().from(orderRequests).where(where)
          .orderBy(desc(orderRequests.createdAt), asc(orderRequests.orderId))
          .limit(PAGE_SIZE).offset((input.page - 1) * PAGE_SIZE);
        return { ok: true, orders: rows.map(summary), total, page: input.page, stats };
      }, input.action !== "vendor-status");
    },
  };
}

let databasePromise;
export async function getOrderDatabase() {
  if (!databasePromise) {
    databasePromise = Promise.all([
      import("@netlify/database"), import("drizzle-orm/netlify-db"),
    ]).then(([{ getDatabase }, { drizzle }]) => {
      const client = getDatabase();
      client.pool.options.connectionTimeoutMillis = 10000;
      client.pool.options.query_timeout = 20000;
      client.pool.options.max = 3;
      return createOrderDatabase(drizzle({ client }));
    });
  }
  const pending = databasePromise;
  try {
    return await pending;
  } catch (error) {
    if (databasePromise === pending) databasePromise = undefined;
    throw error;
  }
}
