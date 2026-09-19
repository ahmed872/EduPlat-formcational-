import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { generateShortCode } from "@/lib/id";
import { toErrorResponse } from "@/lib/rbac";
import { createPendingReferralReward } from "@/lib/business/referral";

const registerSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(["STUDENT", "PARENT"]), // teacher/admin accounts are provisioned out-of-band, never self-registered
  referralCode: z.string().trim().optional(),
});

export async function POST(request: Request) {
  try {
    const body = registerSchema.parse(await request.json());
    const email = body.email.toLowerCase();

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return Response.json(
        { error: "An account with this email already exists" },
        { status: 409 },
      );
    }

    const passwordHash = await bcrypt.hash(body.password, 12);

    const { user, studentProfileId } = await prisma.$transaction(async (tx) => {
      const createdUser = await tx.user.create({
        data: {
          name: body.name,
          email,
          passwordHash,
          role: body.role,
        },
      });

      let createdStudentProfileId: string | null = null;
      if (body.role === "STUDENT") {
        const studentProfile = await tx.studentProfile.create({
          data: {
            userId: createdUser.id,
            referralCode: generateShortCode(),
          },
        });
        createdStudentProfileId = studentProfile.id;
      } else {
        await tx.parentProfile.create({
          data: { userId: createdUser.id },
        });
      }

      return { user: createdUser, studentProfileId: createdStudentProfileId };
    });

    // Outside the transaction: reads the referrer by code with the plain
    // client, matching how every other post-transaction side effect in
    // this codebase (notifications, etc.) is sequenced.
    if (studentProfileId && body.referralCode) {
      await createPendingReferralReward(prisma, {
        referralCode: body.referralCode,
        referredStudentId: studentProfileId,
      });
    }

    return Response.json(
      { id: user.id, email: user.email, role: user.role },
      { status: 201 },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
