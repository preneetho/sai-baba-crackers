import { and, asc, desc, eq, getTableColumns, ilike, inArray, or, sql } from "drizzle-orm";
import { orderRequests, orderItems, orderStatusHistory, orderRevisions } from "./order-schema.mjs";
import { ORDER_STATUSES, PAGE_SIZE } from "../../vendor-app/vendor-model.mjs";
import { vendor } from "../../vendor-app/catalog.mjs";
import { approvedImportMetadata, ImportPreviewRollback } from "./approved-import.mjs";
import { createCatalogueDatabase, activeCatalogue, catalogueLock, catalogueConflict } from "./catalogue-database.mjs";
import { calculateRevision, revisionInputError } from "../../vendor-app/order-revision-model.mjs";

const latestRevision = and(eq(orderRevisions.orderId, orderRequests.orderId), eq(orderRevisions.revision, orderRequests.revision));
const latestTotal = sql`coalesce(${orderRevisions.totalPaise}, ${orderRequests.totalPaise})`.mapWith(Number);
const latestDelivery = sql`coalesce(${orderRevisions.deliveryChargePaise}, ${orderRequests.deliveryChargePaise})`.mapWith(Number);

function snapshot(row, items = row.items) {
  return {
    items, subtotal: row.subtotalPaise / 100, discountPercent: row.discountPercent,
    discount: row.discountPaise / 100, deliveryCharge: row.deliveryChargePaise / 100, total: row.totalPaise / 100,
  };
}

function revisionSnapshot(row) {
  return { revision: row.revision, changedAt: new Date(row.changedAt).toISOString(), reason: row.reason, ...snapshot(row) };
}

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
    fulfilment: row.fulfilment === "delivery" ? (row.deliveryChargePaise === 0 ? "Free home delivery" : "Home delivery") : "Store pickup",
    total: row.totalPaise / 100,
  };
}

async function detail(tx, orderId, includeHistory = true) {
  const [row] = await tx.select().from(orderRequests).where(eq(orderRequests.orderId, orderId));
  if (!row || row.isTest) return { ok: false, error: "NOT_FOUND" };
  const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId)).orderBy(asc(orderItems.position));
  if (!items.length) throw new Error("Recorded order has no line items.");
  let current = snapshot(row, items.map(item => ({
    id: item.productId, name: item.name, brand: item.brand, unit: item.unit,
    quantity: item.quantity, price: item.unitPricePaise / 100, amount: item.amountPaise / 100,
  })));
  if (row.revision > 0) {
    const [saved] = await tx.select().from(orderRevisions).where(and(
      eq(orderRevisions.orderId, orderId), eq(orderRevisions.revision, row.revision),
    ));
    if (!saved) throw new Error("Latest order revision is missing.");
    current = snapshot(saved);
  }
  const history = includeHistory && row.revision > 0 ? await tx.select().from(orderRevisions)
    .where(eq(orderRevisions.orderId, orderId)).orderBy(asc(orderRevisions.revision)) : [];
  return { ok: true, order: {
    ...summary({ ...row, totalPaise: paise(current.total), deliveryChargePaise: paise(current.deliveryCharge) }),
    address: row.address, preferredDate: row.preferredDate, notes: row.notes,
    ...current, revision: row.revision, lineItems: current.items, revisionHistory: history.map(revisionSnapshot),
    couponCode: row.couponCode,
    items: current.items.map(item => `#${item.id} ${item.name} | ${item.brand}\nPack: ${item.unit}\n${item.quantity} pack${item.quantity === 1 ? "" : "s"} x Rs.${item.price.toFixed(2)} = Rs.${item.amount.toFixed(2)}`).join("\n\n"),
  } };
}

async function customerDetail(tx, orderId, includeHistory = true) {
  const result = await detail(tx, orderId, includeHistory);
  if (!result.ok) return result;
  const history = await tx.select({
    changedAt: orderStatusHistory.changedAt,
    fromStatus: orderStatusHistory.fromStatus,
    toStatus: orderStatusHistory.toStatus,
  }).from(orderStatusHistory).where(eq(orderStatusHistory.orderId, orderId))
    .orderBy(asc(orderStatusHistory.changedAt), asc(orderStatusHistory.id));
  return { ok: true, order: {
    ...result.order,
    statusHistory: history.map(entry => ({ ...entry, changedAt: new Date(entry.changedAt).toISOString() })),
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
    ...createCatalogueDatabase(db),
    async ready() {
      await transaction(async tx => {
        await tx.select().from(orderRequests).limit(0);
        await tx.select().from(orderItems).limit(0);
        await tx.select().from(orderStatusHistory).limit(0);
        await tx.select().from(orderRevisions).limit(0);
      }, true);
    },
    async importApprovedSql(statement, approvedHash, actor, preview = false) {
      const metadata = approvedImportMetadata(statement, approvedHash);
      const ids = metadata.source.map(order => order.order_id);
      try {
        return await transaction(async tx => {
          await tx.execute(sql`lock table public.order_requests, public.order_items,
            public.order_status_history in share row exclusive mode`);
          const before = await tx.select({ orderId: orderRequests.orderId })
            .from(orderRequests).where(inArray(orderRequests.orderId, ids));
          const existing = new Set(before.map(order => order.orderId));
          const newIds = ids.filter(id => !existing.has(id));
          // The exact owner-approved SHA-256 is checked before any raw SQL executes.
          await tx.execute(sql.raw(statement));
          if (newIds.length) {
            await tx.update(orderStatusHistory).set({
              actor: sql`${orderStatusHistory.actor} || ${`; executed by approved vendor ${actor}`}`,
            }).where(inArray(orderStatusHistory.orderId, newIds));
          }
          const rows = await tx.select().from(orderRequests).where(inArray(orderRequests.orderId, ids));
          const items = await tx.select().from(orderItems).where(inArray(orderItems.orderId, ids));
          if (rows.length !== metadata.requests || items.length !== metadata.items ||
              !metadata.source.every(source => rows.some(row => row.orderId === source.order_id &&
                row.fingerprint === source.fingerprint &&
                new Date(row.createdAt).toISOString() === source.created_at &&
                row.totalPaise === source.total_paise))) {
            throw new Error("Historical import reconciliation failed.");
          }
          const result = {
            requests: metadata.requests, items: metadata.items, totalPaise: metadata.totalPaise,
            newRequests: newIds.length,
            newItems: metadata.source.filter(order => !existing.has(order.order_id))
              .reduce((sum, order) => sum + order.items.length, 0),
            existingRequestsUnchanged: before.length,
            statusDifferencesPreserved: metadata.source.filter(source =>
              rows.find(row => row.orderId === source.order_id).status !== source.status).length,
            statusCounts: Object.fromEntries(ORDER_STATUSES.map(status =>
              [status, rows.filter(row => row.status === status).length]).filter(([, count]) => count)),
            unverifiedSourceHashes: metadata.unverifiedSourceHashes,
          };
          if (preview) throw new ImportPreviewRollback(result);
          return result;
        });
      } catch (error) {
        if (preview && error instanceof ImportPreviewRollback) return error.result;
        throw error;
      }
    },
    async save(order) {
      return transaction(async tx => {
        const sameRequest = existing => existing.fingerprint === order.fingerprint &&
          existing.isTest === false && existing.customerId === null;
        if (order.catalogueRevision !== undefined) {
          await tx.execute(catalogueLock);
          const [existing] = await tx.select({
            fingerprint: orderRequests.fingerprint, createdAt: orderRequests.createdAt,
            isTest: orderRequests.isTest, customerId: orderRequests.customerId,
          }).from(orderRequests).where(eq(orderRequests.orderId, order.orderId));
          if (existing) return sameRequest(existing) ?
            { ok: true, orderId: order.orderId, createdAt: new Date(existing.createdAt).toISOString() } :
            { ok: false, error: "CONFLICT" };
          const active = await activeCatalogue(tx);
          if (active.year !== order.season || active.revision !== order.catalogueRevision) {
            throw catalogueConflict("Prices or the active year changed. Refresh the catalogue and review your cart before submitting.");
          }
        }
        const inserted = await tx.insert(orderRequests).values({
          orderId: order.orderId, fingerprint: order.fingerprint, season: order.season ?? Number(vendor.year),
          catalogueRevision: order.catalogueRevision,
          createdAt: order.createdAt, status: "New", ...order.customer,
          subtotalPaise: paise(order.amounts.subtotal), discountPercent: order.amounts.discountPercent,
          couponCode: order.amounts.couponCode ?? "",
          discountPaise: paise(order.amounts.discount), deliveryChargePaise: paise(order.amounts.deliveryCharge),
          totalPaise: paise(order.amounts.total),
        }).onConflictDoNothing({ target: orderRequests.orderId }).returning({ orderId: orderRequests.orderId });
        if (!inserted.length) {
          const [existing] = await tx.select({
            fingerprint: orderRequests.fingerprint, createdAt: orderRequests.createdAt,
            isTest: orderRequests.isTest, customerId: orderRequests.customerId,
          }).from(orderRequests).where(eq(orderRequests.orderId, order.orderId));
          if (!existing) throw new Error("Existing request could not be confirmed.");
          return sameRequest(existing) ?
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
    async demoPhoneHistory(phone, page = 1) {
      if (!/^[6-9]\d{9}$/.test(phone) || !Number.isSafeInteger(page) || page < 1 || page > 100000) {
        throw new Error("Invalid demo history lookup.");
      }
      return transaction(async tx => {
        const where = and(eq(orderRequests.phone, phone), eq(orderRequests.isTest, false));
        const [count] = await tx.select({ total: sql`count(*)`.mapWith(Number) }).from(orderRequests).where(where);
        const rows = await tx.select({ orderId: orderRequests.orderId }).from(orderRequests).where(where)
          .orderBy(desc(orderRequests.createdAt), asc(orderRequests.orderId)).limit(20).offset((page - 1) * 20);
        const orders = [];
        for (const row of rows) {
          const result = await customerDetail(tx, row.orderId, false);
          if (!result.ok) throw new Error("A recorded demo request could not be read.");
          orders.push(result.order);
        }
        return { orders, total: count.total, page, pageSize: 20 };
      }, true);
    },
    async demoPhoneOrder(phone, orderId) {
      if (!/^[6-9]\d{9}$/.test(phone) || typeof orderId !== "string" ||
          !/^[A-Za-z0-9_-]{1,100}$/.test(orderId)) throw new Error("Invalid customer order lookup.");
      return transaction(async tx => {
        const [row] = await tx.select({ orderId: orderRequests.orderId }).from(orderRequests).where(and(
          eq(orderRequests.orderId, orderId), eq(orderRequests.phone, phone), eq(orderRequests.isTest, false),
        ));
        return row ? customerDetail(tx, row.orderId) : { ok: false, error: "NOT_FOUND" };
      }, true);
    },
    async dashboard(input, actor) {
      return transaction(async tx => {
        if (input.action === "vendor-detail") return detail(tx, input.orderId);
        if (input.action === "vendor-revise") {
          const invalid = revisionInputError(input);
          if (invalid || typeof actor !== "string" || !actor.trim() || !ORDER_STATUSES.includes(input.expectedStatus)) {
            return { ok: false, error: "INVALID_REVISION", message: invalid || "Invalid vendor revision." };
          }
          const [row] = await tx.select().from(orderRequests).where(and(
            eq(orderRequests.orderId, input.orderId), eq(orderRequests.isTest, false),
          )).for("update");
          if (!row) return { ok: false, error: "NOT_FOUND" };
          if (row.revision !== input.expectedRevision || row.status !== input.expectedStatus) {
            return { ok: false, error: "REVISION_CONFLICT" };
          }
          if (row.fulfilment === "pickup" && input.deliveryCharge !== 0) {
            return { ok: false, error: "INVALID_REVISION", message: "Store-pickup orders cannot have a delivery charge." };
          }
          const current = (await detail(tx, input.orderId, false)).order;
          const known = new Map(current.lineItems.map(item => [item.id, item]));
          if (input.items.some(item => !known.has(item.id))) {
            await tx.execute(catalogueLock);
            const catalogue = await activeCatalogue(tx);
            if (catalogue.year !== input.catalogue.year || catalogue.revision !== input.catalogue.revision) {
              return { ok: false, error: "REVISION_CONFLICT" };
            }
            for (const product of catalogue.products) {
              if (!known.has(product.id) && product.hidden !== true) known.set(product.id, product);
            }
          }
          if (input.items.some(item => !known.has(item.id))) {
            return { ok: false, error: "INVALID_REVISION", message: "A replacement product is unavailable. Reload the editor and choose a visible catalogue product." };
          }
          const revised = calculateRevision(input.items.map(item => ({
            id: item.id, name: known.get(item.id).name, brand: known.get(item.id).brand,
            unit: known.get(item.id).unit, quantity: item.quantity, price: item.price,
          })), current.discountPercent, input.deliveryCharge);
          if (revised.items.length === current.lineItems.length && revised.items.every((item, index) =>
            ["id", "quantity", "price"].every(key => item[key] === current.lineItems[index][key])) &&
              revised.deliveryCharge === current.deliveryCharge) {
            return { ok: false, error: "INVALID_REVISION", message: "Change an item, quantity, price or delivery charge before saving a revision." };
          }
          const values = amounts => ({
            items: amounts.items, subtotalPaise: paise(amounts.subtotal), discountPercent: amounts.discountPercent,
            discountPaise: paise(amounts.discount), deliveryChargePaise: paise(amounts.deliveryCharge), totalPaise: paise(amounts.total),
          });
          if (row.revision === 0) {
            await tx.insert(orderRevisions).values({
              orderId: row.orderId, revision: 0, changedAt: row.createdAt, actor: "customer submission",
              reason: "Original customer request.", ...values({ ...current, items: current.lineItems }),
            });
          }
          await tx.insert(orderRevisions).values({
            orderId: row.orderId, revision: row.revision + 1, changedAt: sql`clock_timestamp()`,
            actor, reason: input.reason.trim(), ...values(revised),
          });
          await tx.update(orderRequests).set({ revision: row.revision + 1 }).where(eq(orderRequests.orderId, row.orderId));
          return detail(tx, row.orderId);
        }
        if (input.action === "vendor-status") {
          const updated = await tx.update(orderRequests).set({ status: input.status }).where(and(
            eq(orderRequests.orderId, input.orderId), eq(orderRequests.status, input.expectedStatus),
            eq(orderRequests.isTest, false),
          )).returning({ orderId: orderRequests.orderId });
          if (!updated.length) {
            const [existing] = await tx.select({ orderId: orderRequests.orderId }).from(orderRequests)
              .where(and(eq(orderRequests.orderId, input.orderId), eq(orderRequests.isTest, false)));
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
        const filters = [eq(orderRequests.isTest, false)];
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
          amount: sql`coalesce(sum(coalesce(${orderRevisions.totalPaise}, ${orderRequests.totalPaise})), 0)`.mapWith(Number),
        }).from(orderRequests).leftJoin(orderRevisions, latestRevision).where(where).groupBy(orderRequests.status);
        const stats = { requestValue: 0, ...Object.fromEntries(ORDER_STATUSES.map(status => [status, 0])) };
        let total = 0;
        for (const group of grouped) {
          stats[group.status] = group.count;
          total += group.count;
          if (group.status !== "Cancelled") stats.requestValue += group.amount;
        }
        stats.requestValue /= 100;
        const rows = await tx.select({
          ...getTableColumns(orderRequests), totalPaise: latestTotal, deliveryChargePaise: latestDelivery,
        }).from(orderRequests).leftJoin(orderRevisions, latestRevision).where(where)
          .orderBy(desc(orderRequests.createdAt), asc(orderRequests.orderId))
          .limit(PAGE_SIZE).offset((input.page - 1) * PAGE_SIZE);
        return { ok: true, orders: rows.map(summary), total, page: input.page, stats };
      }, !["vendor-status", "vendor-revise"].includes(input.action));
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
