import { removeExpiredOrderShares } from "../lib/order-shares.mjs";

export default async () => {
  try {
    const deleted = await removeExpiredOrderShares();
    console.log(`Expired shared request cleanup deleted ${deleted} snapshots.`);
    return new Response(null, { status: 204 });
  } catch {
    console.error("Expired shared request cleanup failed.");
    throw new Error("Shared request cleanup must be retried.");
  }
};

export const config = { schedule: "@hourly" };
