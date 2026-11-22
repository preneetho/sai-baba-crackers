import { and, desc, eq, sql } from "drizzle-orm";
import { catalogueYears, catalogueRevisions, catalogueSettings } from "./catalogue-schema.mjs";
import { validCatalogue, validYear, validPriceSheetName, catalogueProducts } from "../../vendor-app/catalogue-model.mjs";

export function catalogueConflict(message = "The price list changed. Reload it before trying again.") {
  const error = new Error(message);
  error.code = "CATALOGUE_CONFLICT";
  return error;
}

// Catalogue edits, sheet creation/switches and new-order price checks share the same transaction lock.
export const catalogueLock = sql`select pg_advisory_xact_lock(2026, 6801)`;

export async function activeCatalogue(tx) {
  const [settings] = await tx.select().from(catalogueSettings).where(eq(catalogueSettings.id, 1));
  if (!settings) throw new Error("The active price list has not been initialized.");
  return readCatalogue(tx, settings.activeYear);
}

async function readCatalogue(tx, year, revision) {
  if (!validYear(year)) throw new Error("Invalid price-sheet identifier.");
  const [current] = await tx.select().from(catalogueYears).where(eq(catalogueYears.year, year));
  if (!current) throw catalogueConflict("That price sheet is unavailable. Reload the price sheets.");
  if (revision === undefined) {
    revision = current.revision;
  }
  const [row] = await tx.select().from(catalogueRevisions).where(and(
    eq(catalogueRevisions.year, year), eq(catalogueRevisions.revision, revision),
  ));
  if (!validCatalogue(row)) throw catalogueConflict("That price-list version is unavailable. Refresh the catalogue.");
  return { year: row.year, revision: row.revision, ...(current.name !== null ? { name: current.name } : {}),
    products: catalogueProducts(row.products) };
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
        let selectedYear = input.year;
        if (input.action === "create") {
          const name = input.name ?? String(input.year);
          if (!validPriceSheetName(name)) throw new Error("Invalid price-sheet name.");
          const sheets = await tx.select().from(catalogueYears);
          if (sheets.some(sheet => (sheet.name ?? String(sheet.year)).toLowerCase() === name.toLowerCase())) {
            throw catalogueConflict("That price-sheet name already exists. Choose another name or select it to edit.");
          }
          if (input.name !== undefined) {
            const used = new Set(sheets.map(sheet => sheet.year));
            selectedYear = 2000;
            while (used.has(selectedYear)) selectedYear++;
            if (!validYear(selectedYear)) throw catalogueConflict("The price-sheet storage limit has been reached. Select an existing sheet to edit.");
          } else if (sheets.some(sheet => sheet.year === selectedYear)) {
            throw catalogueConflict("That price sheet already exists. Select it to edit.");
          }
          const source = await readCatalogue(tx, input.sourceYear);
          if (source.revision !== input.expectedRevision) throw catalogueConflict();
          await tx.insert(catalogueYears).values({ year: selectedYear, revision: 1,
            ...(input.name !== undefined ? { name } : {}) });
          await tx.insert(catalogueRevisions).values({
            year: selectedYear, revision: 1, products: source.products, actor,
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
            if (active.year !== input.expectedActiveYear) throw catalogueConflict("The active price sheet changed. Reload before switching sheets.");
            await tx.update(catalogueSettings).set({ activeYear: input.year }).where(eq(catalogueSettings.id, 1));
          } else throw new Error("Unknown price-list action.");
        }
        return view(tx, selectedYear);
      }, true);
    },
  };
}
