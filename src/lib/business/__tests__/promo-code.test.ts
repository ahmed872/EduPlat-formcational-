import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDatabase } from "@/test/reset-db";
import { createStudent } from "@/test/factories";
import {
  applyDiscount,
  redeemPromoCode,
  validatePromoCode,
} from "@/lib/business/promo-code";

beforeEach(async () => {
  await resetDatabase();
});

describe("promo codes", () => {
  it("a valid, active code can be redeemed", async () => {
    const student = await createStudent();
    const promo = await prisma.promoCode.create({
      data: { code: "WELCOME10", type: "PERCENT_DISCOUNT", value: 10 },
    });

    const validation = await validatePromoCode(prisma, {
      code: promo.code,
      studentId: student.id,
    });
    expect(validation.valid).toBe(true);

    await redeemPromoCode(prisma, { code: promo.code, studentId: student.id });
    const updated = await prisma.promoCode.findUniqueOrThrow({
      where: { id: promo.id },
    });
    expect(updated.usedCount).toBe(1);
  });

  it("an expired code fails validation and redemption", async () => {
    const student = await createStudent();
    const promo = await prisma.promoCode.create({
      data: {
        code: "EXPIRED1",
        type: "PERCENT_DISCOUNT",
        value: 10,
        expiresAt: new Date(Date.now() - 1000),
      },
    });

    const validation = await validatePromoCode(prisma, {
      code: promo.code,
      studentId: student.id,
    });
    expect(validation).toEqual({ valid: false, reason: "EXPIRED" });

    await expect(
      redeemPromoCode(prisma, { code: promo.code, studentId: student.id }),
    ).rejects.toThrow(/expired/i);
  });

  it("enforces the usage limit", async () => {
    const promo = await prisma.promoCode.create({
      data: {
        code: "LIMITED1",
        type: "FREE_100",
        usageLimit: 1,
      },
    });
    const studentA = await createStudent();
    const studentB = await createStudent();

    await redeemPromoCode(prisma, { code: promo.code, studentId: studentA.id });

    const validation = await validatePromoCode(prisma, {
      code: promo.code,
      studentId: studentB.id,
    });
    expect(validation).toEqual({ valid: false, reason: "USAGE_LIMIT_REACHED" });

    await expect(
      redeemPromoCode(prisma, { code: promo.code, studentId: studentB.id }),
    ).rejects.toThrow(/usage limit/i);
  });

  it("never lets concurrent redemptions push usedCount past usageLimit", async () => {
    // Regression test for a real race: a plain read-then-write usage-limit
    // check (even inside a $transaction) lets several concurrent
    // redemptions near the cap all read a stale usedCount and all succeed.
    // With usageLimit=1 and 5 concurrent students racing, exactly 1 may
    // succeed — not more.
    const promo = await prisma.promoCode.create({
      data: { code: "RACE1", type: "FREE_100", usageLimit: 1 },
    });
    const students = await Promise.all(Array.from({ length: 5 }, () => createStudent()));

    const results = await Promise.allSettled(
      students.map((student) =>
        redeemPromoCode(prisma, { code: promo.code, studentId: student.id }),
      ),
    );

    const succeeded = results.filter((r) => r.status === "fulfilled");
    expect(succeeded).toHaveLength(1);

    const updated = await prisma.promoCode.findUniqueOrThrow({ where: { id: promo.id } });
    expect(updated.usedCount).toBe(1);
  });

  it("prevents the same student from redeeming a code twice", async () => {
    const student = await createStudent();
    const promo = await prisma.promoCode.create({
      data: { code: "ONETIME1", type: "FREE_100" },
    });

    await redeemPromoCode(prisma, { code: promo.code, studentId: student.id });
    const validation = await validatePromoCode(prisma, {
      code: promo.code,
      studentId: student.id,
    });
    expect(validation).toEqual({ valid: false, reason: "ALREADY_REDEEMED" });
  });

  it("computes percentage and fixed discounts correctly", () => {
    expect(applyDiscount(10000, { type: "PERCENT_DISCOUNT", value: 25 })).toBe(7500);
    expect(applyDiscount(10000, { type: "FIXED_DISCOUNT", value: 1500 })).toBe(8500);
    expect(applyDiscount(10000, { type: "FREE_100", value: null })).toBe(0);
  });
});
