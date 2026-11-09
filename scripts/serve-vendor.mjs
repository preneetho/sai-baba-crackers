import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { handleOrderRequest } from "../netlify/functions/orders.mjs";
import { handlePdfRequest } from "../netlify/functions/order-pdf.mjs";
import { handleVendorAuth } from "../netlify/functions/vendor-auth.mjs";
import { handleVendorOrders } from "../netlify/functions/vendor-orders.mjs";
import { handleVendorImport } from "../netlify/functions/vendor-import.mjs";
import { handleCatalogue } from "../netlify/functions/catalogue.mjs";
import { handleVendorCatalogue } from "../netlify/functions/vendor-catalogue.mjs";
import { handleVendorMedia } from "../netlify/functions/vendor-media.mjs";

const port = Number(process.env.VENDOR_PORT ?? 4173);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("VENDOR_PORT must be an integer between 1 and 65535.");
}
const files = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/vendor", ["vendor/index.html", "text/html; charset=utf-8"]],
  ["/vendor/", ["vendor/index.html", "text/html; charset=utf-8"]],
  ["/vendor/index.html", ["vendor/index.html", "text/html; charset=utf-8"]],
  ["/vendor.css", ["vendor.css", "text/css; charset=utf-8"]],
  ["/vendor.mjs", ["vendor.mjs", "text/javascript; charset=utf-8"]],
  ["/vendor-model.mjs", ["vendor-model.mjs", "text/javascript; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ["/app.mjs", ["app.mjs", "text/javascript; charset=utf-8"]],
  ["/telemetry-client.mjs", ["telemetry-client.mjs", "text/javascript; charset=utf-8"]],
  ["/catalog.mjs", ["catalog.mjs", "text/javascript; charset=utf-8"]],
  ["/catalogue-model.mjs", ["catalogue-model.mjs", "text/javascript; charset=utf-8"]],
  ["/media-model.mjs", ["media-model.mjs", "text/javascript; charset=utf-8"]],
  ["/media-upload.mjs", ["media-upload.mjs", "text/javascript; charset=utf-8"]],
  ["/order.mjs", ["order.mjs", "text/javascript; charset=utf-8"]],
  ["/hero-fireworks.mjs", ["hero-fireworks.mjs", "text/javascript; charset=utf-8"]],
  ["/sai-baba-logo.png", ["sai-baba-logo.png", "image/png"]],
  ["/diwali-crackers-preview.png", ["diwali-crackers-preview.png", "image/png"]],
  ["/diwali-crackers-square.png", ["diwali-crackers-square.png", "image/png"]],
  ["/diwali-header.gif", ["diwali-header.gif", "image/gif"]],
  ["/diwali-header-still.png", ["diwali-header-still.png", "image/png"]],
  ["/diwali-fireworks.mp4", ["diwali-fireworks.mp4", "video/mp4"]],
  ["/diwali-fireworks-poster.png", ["diwali-fireworks-poster.png", "image/png"]],
  ["/diwali-fireworks.png", ["diwali-fireworks.png", "image/png"]],
]);
const server = createServer(async (request, response) => {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Cache-Control", "no-store");
  let pathname;
  try {
    pathname = new URL(request.url, "http://localhost").pathname;
  } catch {
    response.writeHead(400);
    response.end("Invalid URL");
    return;
  }
  if (pathname === "/api/orders" || pathname === "/api/order-pdf" ||
      pathname === "/api/vendor-orders" || pathname === "/api/vendor-import" ||
      pathname === "/api/catalogue" || pathname === "/api/vendor-catalogue" ||
      pathname === "/api/vendor-media" || pathname.startsWith("/api/vendor-auth/")) {
    try {
      const init = { method: request.method, headers: request.headers };
      if (request.method !== "GET" && request.method !== "HEAD") {
        init.body = Readable.toWeb(request);
        init.duplex = "half";
      }
      const url = new URL(request.url, `http://127.0.0.1:${port}`);
      const handler = pathname === "/api/orders" ? handleOrderRequest :
        pathname === "/api/order-pdf" ? handlePdfRequest :
          pathname === "/api/vendor-orders" ? handleVendorOrders :
            pathname === "/api/vendor-import" ? handleVendorImport :
              pathname === "/api/catalogue" ? handleCatalogue :
                pathname === "/api/vendor-catalogue" ? handleVendorCatalogue :
                  pathname === "/api/vendor-media" ? handleVendorMedia : handleVendorAuth;
      const result = await handler(new Request(url, init));
      const headers = Object.fromEntries(result.headers);
      const cookies = result.headers.getSetCookie();
      if (cookies.length) headers["set-cookie"] = cookies;
      response.writeHead(result.status, headers);
      response.end(Buffer.from(await result.arrayBuffer()));
    } catch {
      console.error("Local order endpoint could not process the request.");
      response.writeHead(500, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "The local order tracker could not process the request." }));
    }
    return;
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" });
    response.end("Method not allowed");
    return;
  }
  const file = files.get(pathname);
  if (!file) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }
  try {
    const body = await readFile(fileURLToPath(new URL(`../vendor-app/${file[0]}`, import.meta.url)));
    if (file[1] === "video/mp4") {
      response.setHeader("Accept-Ranges", "bytes");
      if (request.method === "GET" && request.headers.range) {
        const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range);
        const start = range?.[1] ? Number(range[1]) : Math.max(0, body.length - Number(range?.[2]));
        const end = range?.[1] && range[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1;
        if (!range || !(range[1] || range[2]) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end) {
          response.writeHead(416, { "Content-Range": `bytes */${body.length}` });
          response.end("Requested video range is unavailable");
          return;
        }
        const partial = body.subarray(start, end + 1);
        response.writeHead(206, { "Content-Type": file[1], "Content-Length": partial.length, "Content-Range": `bytes ${start}-${end}/${body.length}` });
        response.end(partial);
        return;
      }
    }
    response.setHeader("Content-Length", body.length);
    response.writeHead(200, { "Content-Type": file[1] });
    response.end(request.method === "HEAD" ? undefined : body);
  } catch (error) {
    console.error(`Unable to serve ${pathname}:`, error);
    response.writeHead(500);
    response.end("Unable to load the vendor application");
  }
});
server.on("error", error => {
  console.error("Vendor preview could not start:", error.message);
  process.exitCode = 1;
});
server.listen(port, "127.0.0.1", () => {
  console.log(`Vendor catalogue: http://127.0.0.1:${port}`);
});
