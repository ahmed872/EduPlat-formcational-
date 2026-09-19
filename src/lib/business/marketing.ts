import type { PrismaClient } from "@prisma/client";

/**
 * A banner is "live" only when active AND the current moment falls inside
 * its optional window — a null startsAt/endsAt means no bound on that
 * side, matching how PromoCode.expiresAt is treated elsewhere.
 */
export async function getActiveBanners(prisma: PrismaClient, now: Date = new Date()) {
  return prisma.marketingBanner.findMany({
    where: {
      active: true,
      AND: [
        { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
        { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
      ],
    },
    orderBy: { order: "asc" },
  });
}
