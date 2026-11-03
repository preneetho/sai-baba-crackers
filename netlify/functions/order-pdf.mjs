import { pdfKey, readOrderPdf } from "../lib/order-pdfs.mjs";

export async function handlePdfRequest(request, { readPdf = readOrderPdf } = {}) {
  const headers = {
    "Cache-Control": "private, no-store, max-age=0",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
    "Referrer-Policy": "no-referrer",
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Use GET to download an order PDF.", { status: 405, headers: { ...headers, Allow: "GET, HEAD" } });
  }
  const parameters = new URL(request.url).searchParams;
  const token = parameters.get("token");
  if (parameters.getAll("token").length !== 1 || !pdfKey(token)) {
    return new Response(request.method === "HEAD" ? null : "Invalid PDF link.", { status: 400, headers });
  }
  try {
    const result = await readPdf(token);
    if (result.status !== 200) {
      return new Response(request.method === "HEAD" ? null :
        "This PDF link is invalid or has expired. Contact the shop using your request ID; the complete order remains in its Google Sheet.",
      { status: result.status, headers });
    }
    return new Response(request.method === "HEAD" ? null : result.data, {
      headers: {
        ...headers, "Content-Type": "application/pdf", "Content-Length": String(result.data.length),
        "Content-Disposition": `attachment; filename="sai-baba-${result.orderId}.pdf"`,
      },
    });
  } catch {
    console.error("Order PDF download failed.");
    return new Response(request.method === "HEAD" ? null : "The order PDF is temporarily unavailable. Please retry.",
      { status: 503, headers });
  }
}

export default async request => handlePdfRequest(request);
export const config = {
  path: "/api/order-pdf",
  rateLimit: { windowLimit: 60, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
