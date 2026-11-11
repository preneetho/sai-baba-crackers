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

export async function generatePriceListPdf(catalogue, createdAt) {
  const [fonts, logo, rows] = await Promise.all([
    loadFonts(),
    readFile(new URL("../../vendor-app/sai-baba-logo.png", import.meta.url)),
    Promise.all(catalogue.products.map(async product => {
      const price = product.price.toLocaleString("en-IN", { maximumFractionDigits: 2 });
      return Promise.all([String(product.id), product.name, product.brand, product.unit, price, "", ""].map(orderTextRuns));
    })),
  ]);
  const generated = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short",
  }).format(new Date(createdAt));
  return new Promise((resolve, reject) => {
    const document = new PDFDocument({
      size: "LEGAL", margins: { top: 36, right: 36, bottom: 36, left: 36 },
      font: fonts[0].data, bufferPages: true,
      info: {
        Title: `${vendor.name} - ${catalogue.year} price list`, Author: vendor.name,
        CreationDate: new Date(createdAt), ModDate: new Date(createdAt),
      },
    });
    const chunks = [];
    document.on("data", chunk => chunks.push(chunk));
    document.on("error", reject);
    document.on("end", () => resolve(Buffer.concat(chunks)));
    try {
      for (const font of fonts) document.registerFont(font.name, font.data);
      const edges = [36, 72, 258, 325, 407, 461, 515, 576];
      const bottom = document.page.height - 54;
      const text = (value, x, y, width, size = 9, align = "left", font = families[0]) =>
        document.font(font).fontSize(size).fillColor("black").text(value, x, y, {
          width, align, height: document.page.height - y, lineBreak: false,
        });
      const line = (x1, y1, x2, y2) => document.lineWidth(.5).strokeColor("black").moveTo(x1, y1).lineTo(x2, y2).stroke();
      const widthOf = (value, font, size) => document.font(font).fontSize(size).widthOfString(value);
      function cellLayout(runs, width, size) {
        const lines = [[]];
        let lineWidth = 0;
        const nextLine = () => { lines.push([]); lineWidth = 0; };
        const append = (font, value) => {
          const current = lines.at(-1);
          const previous = current.at(-1);
          const extra = previous?.font === font ?
            widthOf(previous.text + value, font, size) - widthOf(previous.text, font, size) : widthOf(value, font, size);
          if (previous?.font === font) previous.text += value;
          else current.push({ font, text: value });
          lineWidth += extra;
        };
        for (const run of runs) {
          for (const word of run.text.split(/(\s+)/u).filter(Boolean)) {
            if (lineWidth + widthOf(word, run.font, size) > width && lineWidth > 0) nextLine();
            if (!lineWidth && /^\s+$/u.test(word)) continue;
            if (widthOf(word, run.font, size) <= width) append(run.font, word);
            else {
              for (const { segment } of new Intl.Segmenter("und", { granularity: "grapheme" }).segment(word)) {
                if (lineWidth + widthOf(segment, run.font, size) > width && lineWidth > 0) nextLine();
                append(run.font, segment);
              }
            }
          }
        }
        const lineHeight = Math.max(size * 1.4, ...runs.map(run =>
          document.font(run.font).fontSize(size).currentLineHeight(true)));
        return { lines, size, lineHeight, height: lines.length * lineHeight };
      }
      function drawCell(cell, column, y, height, align) {
        const width = edges[column + 1] - edges[column] - 8;
        const top = y + (height - cell.height) / 2;
        for (const [index, runs] of cell.lines.entries()) {
          const length = runs.reduce((sum, run) => sum + widthOf(run.text, run.font, cell.size), 0);
          let x = edges[column] + 4 + (align === "right" ? width - length : align === "center" ? (width - length) / 2 : 0);
          for (const run of runs) {
            text(run.text, x, top + index * cell.lineHeight, width, cell.size, "left", run.font);
            x += widthOf(run.text, run.font, cell.size);
          }
        }
      }
      function tableHeader(y) {
        const labels = ["Sl.\nNo.", "DESCRIPTION", "MAKE", "UNIT", "RATE IN\nRs.", "QTY.\nREQUIRED", "AMOUNT"];
        for (const [column, label] of labels.entries()) {
          const lines = label.split("\n").map(value => [{ font: families[0], text: value }]);
          drawCell({ lines, size: 8, lineHeight: 11, height: lines.length * 11 }, column, y, 28, "center");
        }
        line(36, y, 576, y);
        line(36, y + 28, 576, y + 28);
        for (const x of edges) line(x, y, x, y + 28);
        return y + 28;
      }
      text("Supplying crackers for over 35 years. Thank you for your support and co-operation.", 36, 36, 540, 8, "center");
      document.image(logo, 288, 54, { fit: [36, 44], align: "center", valign: "center" });
      text("Happy", 190, 71, 85, 13, "right", "Times-Italic");
      text("Deepawali", 337, 71, 85, 13, "left", "Times-Italic");
      text("OM SAI RAM", 36, 102, 540, 8, "center");
      text(vendor.name.toUpperCase(), 36, 118, 540, 25, "center", "Times-Bold");
      text(`${vendor.location.toUpperCase()}. CELL: ${vendor.phone} / ${vendor.alternatePhone}`, 36, 150, 540, 9, "center");
      text(`PRICE LIST - ${catalogue.year}`, 36, 168, 540, 9, "center");
      text("Name:", 36, 190, 40, 10);
      text("Mobile:", 36, 214, 40, 10);
      text("Phone:", 292, 214, 40, 10);
      document.dash(1, { space: 2 });
      line(75, 202, 576, 202);
      line(78, 226, 286, 226);
      line(333, 226, 576, 226);
      document.undash();
      let y = tableHeader(238);
      for (const [index, row] of rows.entries()) {
        const cells = row.map((runs, column) => cellLayout(runs, edges[column + 1] - edges[column] - 8, column === 1 ? 9 : column === 0 ? 8 : 8.3));
        const height = Math.max(20, ...cells.map(cell => cell.height + 6));
        const finalSpace = index === rows.length - 1 ? 124 : 0;
        if (y + height + finalSpace > bottom) {
          document.addPage();
          y = tableHeader(36);
        }
        if (y + height + finalSpace > bottom) throw new Error("A price-list row is too tall for the printable page.");
        cells.forEach((cell, column) => drawCell(cell, column, y, height, column === 1 ? "left" : column === 4 ? "right" : "center"));
        for (const x of edges) line(x, y, x, y + height);
        y += height;
        line(36, y, 576, y);
      }
      text("TOTAL", 343, y + 6, 60, 10, "right");
      text("GRAND TOTAL", 296, y + 32, 107, 10, "right");
      for (const top of [y, y + 26]) document.rect(407, top, 169, 26).stroke();
      text("Note: Goods once sold cannot be returned or exchanged.", 36, y + 7, 300, 7.5);
      text("Manufacturing defects are subject to the manufacturer's terms.", 36, y + 19, 300, 7.5);
      text("Applicable consumer rights are not excluded.", 36, y + 31, 255, 7.5);
      text("Rates per selling pack. Coupons and delivery charges are not included.", 36, y + 59, 540, 7.5);
      text("Availability and final prices require shop confirmation.", 36, y + 71, 540, 7.5);
      text(`Wish you Happy Diwali ${catalogue.year}`, 36, y + 92, 260, 15, "center", "Times-Italic");
      text(vendor.name.toUpperCase(), 306, y + 88, 270, 11, "center", "Times-Bold");
      text("(Signature)", 306, y + 109, 270, 8, "center");
      const pages = document.bufferedPageRange();
      for (let page = pages.start; page < pages.start + pages.count; page++) {
        document.switchToPage(page);
        text(`${catalogue.year} price list | Saved version ${catalogue.revision} | Generated ${generated} IST | Page ${page + 1} of ${pages.count}`,
          36, document.page.height - 28, 540, 7, "center");
      }
      document.end();
    } catch (error) {
      document.destroy(error);
    }
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
