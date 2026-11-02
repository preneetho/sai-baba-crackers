import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { handleOrderRequest } from "../netlify/functions/orders.mjs";

const port = Number(process.env.VENDOR_PORT ?? 4173);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("VENDOR_PORT must be an integer between 1 and 65535.");
}
const files = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ["/app.mjs", ["app.mjs", "text/javascript; charset=utf-8"]],
  ["/catalog.mjs", ["catalog.mjs", "text/javascript; charset=utf-8"]],
  ["/order.mjs", ["order.mjs", "text/javascript; charset=utf-8"]],
  ["/sai-baba-logo.png", ["sai-baba-logo.png", "image/png"]],
  ["/diwali-crackers-preview.png", ["diwali-crackers-preview.png", "image/png"]],
  ["/diwali-crackers-square.png", ["diwali-crackers-square.png", "image/png"]],
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
  if (pathname === "/api/orders") {
    try {
      const init = { method: request.method, headers: request.headers };
      if (request.method !== "GET" && request.method !== "HEAD") {
        init.body = Readable.toWeb(request);
        init.duplex = "half";
      }
      const result = await handleOrderRequest(new Request(`http://127.0.0.1:${port}/api/orders`, init));
      response.writeHead(result.status, Object.fromEntries(result.headers));
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
