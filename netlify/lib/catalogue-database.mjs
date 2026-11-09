import { and, desc, eq, sql } from "drizzle-orm";
import { catalogueYears, catalogueRevisions, catalogueSettings } from "./catalogue-schema.mjs";
import { validCatalogue, validYear, catalogueProducts } from "../../vendor-app/catalogue-model.mjs";

export function catalogueConflict(message = "The price list changed. Reload it before trying again.") {
  const error = new Error(message);
  error.code = "CATALOGUE_CONFLICT";
  return error;
}

// Catalogue edits, year switches and new-order price checks share the same transaction lock.
export const catalogueLock = sql`select pg_advisory_xact_lock(2026, 6801)`;

export async function activeCatalogue(tx) {
  const [settings] = await tx.select().from(catalogueSettings).where(eq(catalogueSettings.id, 1));
  if (!settings) throw new Error("The active price list has not been initialized.");
  return readCatalogue(tx, settings.activeYear);
}

async function readCatalogue(tx, year, revision) {
  if (!validYear(year)) throw new Error("Invalid catalogue year.");
  if (revision === undefined) {
    const [current] = await tx.select().from(catalogueYears).where(eq(catalogueYears.year, year));
    if (!current) throw catalogueConflict("That price-list year is unavailable. Reload the price lists.");
    revision = current.revision;
  }
  const [row] = await tx.select().from(catalogueRevisions).where(and(
    eq(catalogueRevisions.year, year), eq(catalogueRevisions.revision, revision),
  ));
  if (!validCatalogue(row)) throw catalogueConflict("That price-list version is unavailable. Refresh the catalogue.");
  return { year: row.year, revision: row.revision, products: catalogueProducts(row.products) };
}

export function createCatalogueDatabase(db) {
  async function transaction(operation, write = false) {
    return db.transaction(async tx => {
      await tx.execute(sql`set local statement_timeout = '15s'`);
      await tx.execute(sql`set local lock_timeout = '5s'`);
      if (write) await tx.execute(catalogueLock);
      return operation(tx);
    }, write ? undefined : { isolationLevel: "repeatable read", accessMode: "read only" });
  }
  async function view(tx, year) {
    const active = await activeCatalogue(tx);
    const years = await tx.select().from(catalogueYears).orderBy(desc(catalogueYears.year));
    return { activeYear: active.year, years, catalogue: await readCatalogue(tx, year ?? active.year) };
  }
  return {
    async activeCatalogue() { return transaction(activeCatalogue); },
    async catalogueVersion(year, revision) {
      return transaction(tx => readCatalogue(tx, year, revision));
    },
    async priceLists(input = {}, actor) {
      if (!input.action) return transaction(tx => view(tx, input.year));
      return transaction(async tx => {
        if (input.action === "create") {
          const [exists] = await tx.select().from(catalogueYears).where(eq(catalogueYears.year, input.year));
          if (exists) throw catalogueConflict("That year already has a price list. Select it to edit.");
          const source = await readCatalogue(tx, input.sourceYear);
          if (source.revision !== input.expectedRevision) throw catalogueConflict();
          await tx.insert(catalogueYears).values({ year: input.year, revision: 1 });
          await tx.insert(catalogueRevisions).values({
            year: input.year, revision: 1, products: source.products, actor,
          });
        } else {
          const current = await readCatalogue(tx, input.year);
          if (current.revision !== input.expectedRevision) throw catalogueConflict();
          if (input.action === "save") {
            const revision = current.revision + 1;
            if (!validCatalogue({ year: input.year, revision, products: input.products })) {
              throw new Error("Invalid price list.");
            }
            await tx.insert(catalogueRevisions).values({
              year: input.year, revision, products: catalogueProducts(input.products), actor,
            });
            await tx.update(catalogueYears).set({ revision }).where(eq(catalogueYears.year, input.year));
          } else if (input.action === "activate") {
            const active = await activeCatalogue(tx);
            if (active.year !== input.expectedActiveYear) throw catalogueConflict("The active year changed. Reload before switching years.");
            await tx.update(catalogueSettings).set({ activeYear: input.year }).where(eq(catalogueSettings.id, 1));
          } else throw new Error("Unknown price-list action.");
        }
        return view(tx, input.year);
      }, true);
    },
  };
}
