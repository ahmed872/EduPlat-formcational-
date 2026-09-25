import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * Liveness/readiness probe for a load balancer or uptime monitor. Public by
 * design and reveals nothing but "ok"/"unavailable": no version, no hostnames,
 * no error details (those go to the server log only).
 */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[health] database check failed:", (error as Error).message.split("\n")[0]);
    return Response.json({ status: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
