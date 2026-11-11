import { readFile } from "node:fs/promises";
import PDFDocument from "pdfkit";
import { create } from "fontkit";
import { vendor } from "../../vendor-app/catalog.mjs";

const families = ["NotoSans", "NotoSansTelugu", "NotoSansDevanagari", "NotoSansArabic", "NotoEmoji"];
let fontsPromise;

async function loadFonts() {
  fontsPromise ??= Promise.all(families.map(async name => {
    const data = await readFile(new URL(`../assets/fonts/${name}.ttf`, import.meta.url));
    return { name, data, coverage: create(data) };
  }));
  return fontsPromise;
}

export async function orderTextRuns(text) {
  const fonts = await loadFonts();
  const runs = [];
  for (const { segment } of new Intl.Segmenter("und", { granularity: "grapheme" }).segment(text)) {
    const visible = [...segment].filter(character => !/[\p{White_Space}\p{Cf}\p{Variation_Selector}]/u.test(character));
    const previous = runs.at(-1);
    const font = visible.length ? fonts.find(candidate =>
      visible.every(character => candidate.coverage.hasGlyphForCodePoint(character.codePointAt(0)))) :
      fonts.find(candidate => candidate.name === previous?.font) ?? fonts[0];
    if (!font) {
      const error = new Error("Some characters cannot be displayed in this PDF. No characters have been silently removed.");
      error.code = "PDF_UNSUPPORTED_TEXT";
      throw error;
    }
    if (previous?.font === font.name) previous.text += segment;
    else runs.push({ font: font.name, text: segment });
  }
  return runs;
}

export function generateOrderPdf(message, orderId, createdAt) {
  return generateTextPdf(message, { title: `Order request ${orderId}`, footer: orderId, createdAt });
}

export function generatePriceListPdf(catalogue, createdAt) {
  const categories = new Map();
  for (const product of catalogue.products) {
    if (!categories.has(product.category)) categories.set(product.category, []);
    categories.get(product.category).push(product);
  }
  const generated = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short",
  }).format(new Date(createdAt));
  const lines = [
    `PRICE LIST - ${catalogue.year}`, `${vendor.location} | ${vendor.phone} / ${vendor.alternatePhone}`,
    `Saved version ${catalogue.revision} | Generated ${generated} IST`, "",
    "Prices are per listed selling pack. Coupons and delivery charges are not included.",
    "Availability and final prices require shop confirmation.", "",
    "No. Product | Brand | Selling pack | Price", "",
  ];
  for (const [category, products] of categories) {
    lines.push(category.toUpperCase());
    for (const product of products) {
      const price = product.price.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      lines.push(`${product.id}. ${product.name} | ${product.brand} | ${product.unit} | Rs.${price}`);
    }
    lines.push("");
  }
  return generateTextPdf(lines.join("\n"), {
    title: `${vendor.name} - ${catalogue.year} price list`,
    footer: `${catalogue.year} price list - version ${catalogue.revision}`, createdAt,
  });
}

async function generateTextPdf(message, { title, footer, createdAt }) {
  const lines = await Promise.all(message.split("\n").map(orderTextRuns));
  const fonts = await loadFonts();
  return new Promise((resolve, reject) => {
    const document = new PDFDocument({
      size: "A4", margins: { top: 44, right: 44, bottom: 56, left: 44 },
      font: fonts[0].data, bufferPages: true,
      info: {
        Title: title, Author: vendor.name,
        CreationDate: new Date(createdAt), ModDate: new Date(createdAt),
      },
    });
    const chunks = [];
    document.on("data", chunk => chunks.push(chunk));
    document.on("error", reject);
    document.on("end", () => resolve(Buffer.concat(chunks)));
    try {
      for (const font of fonts) document.registerFont(font.name, font.data);
      document.font(families[0]).fontSize(18).fillColor("#1e4f91").text(vendor.name);
      document.moveDown(0.6).fontSize(10).fillColor("#1c2f4a");
      for (const runs of lines) {
        document.x = 44;
        if (!runs.length) {
          document.font(families[0]).moveDown(0.5);
          continue;
        }
        for (const [index, run] of runs.entries()) {
          document.font(run.font).text(run.text, {
            width: document.page.width - 88, lineGap: 3, continued: index < runs.length - 1,
          });
        }
      }
      const pages = document.bufferedPageRange();
      for (let page = pages.start; page < pages.start + pages.count; page++) {
        document.switchToPage(page);
        document.font(families[0]).fontSize(8).fillColor("#526581").text(
          `${footer} | Page ${page + 1} of ${pages.count}`,
          44, document.page.height - 34, { width: document.page.width - 88, height: 18, lineBreak: false },
        );
      }
      document.end();
    } catch (error) {
      document.destroy(error);
    }
  });
}
