import { removeExpiredOrderPdfs } from "../lib/order-pdfs.mjs";

export default async () => {
  try {
    const deleted = await removeExpiredOrderPdfs();
    console.log(`Expired order PDF cleanup deleted ${deleted} files.`);
    return new Response(null, { status: 204 });
  } catch {
    console.error("Expired order PDF cleanup failed.");
    throw new Error("Order PDF cleanup must be retried.");
  }
};

export const config = { schedule: "@hourly" };
