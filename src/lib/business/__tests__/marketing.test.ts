import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDatabase } from "@/test/reset-db";
import { getActiveBanners } from "@/lib/business/marketing";

beforeEach(async () => {
  await resetDatabase();
});

const NOW = new Date(2026, 5, 15);

async function createBanner(overrides: {
  title?: string;
  active?: boolean;
  startsAt?: Date | null;
  endsAt?: Date | null;
  order?: number;
}) {
  return prisma.marketingBanner.create({
    data: {
      title: overrides.title ?? "banner",
      active: overrides.active ?? true,
      startsAt: overrides.startsAt,
      endsAt: overrides.endsAt,
      order: overrides.order ?? 0,
    },
  });
}

describe("getActiveBanners", () => {
  it("includes a banner with no date bounds at all", async () => {
    await createBanner({ title: "always on" });
    const banners = await getActiveBanners(prisma, NOW);
    expect(banners.map((b) => b.title)).toEqual(["always on"]);
  });

  it("excludes an inactive banner even within its date window", async () => {
    await createBanner({
      title: "disabled",
      active: false,
      startsAt: new Date(2026, 0, 1),
      endsAt: new Date(2026, 11, 31),
    });
    const banners = await getActiveBanners(prisma, NOW);
    expect(banners).toHaveLength(0);
  });

  it("excludes a banner that hasn't started yet", async () => {
    await createBanner({ title: "future", startsAt: new Date(2026, 6, 1) });
    const banners = await getActiveBanners(prisma, NOW);
    expect(banners).toHaveLength(0);
  });

  it("excludes a banner that has already ended", async () => {
    await createBanner({ title: "past", endsAt: new Date(2026, 4, 1) });
    const banners = await getActiveBanners(prisma, NOW);
    expect(banners).toHaveLength(0);
  });

  it("includes a banner whose window currently contains now", async () => {
    await createBanner({
      title: "current",
      startsAt: new Date(2026, 5, 1),
      endsAt: new Date(2026, 5, 30),
    });
    const banners = await getActiveBanners(prisma, NOW);
    expect(banners.map((b) => b.title)).toEqual(["current"]);
  });

  it("orders banners by their configured order", async () => {
    await createBanner({ title: "second", order: 2 });
    await createBanner({ title: "first", order: 1 });
    const banners = await getActiveBanners(prisma, NOW);
    expect(banners.map((b) => b.title)).toEqual(["first", "second"]);
  });
});
