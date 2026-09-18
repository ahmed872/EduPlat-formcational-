import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { generateShortCode } from "@/lib/id";
import { toErrorResponse } from "@/lib/rbac";

const registerSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(["STUDENT", "PARENT"]), // teacher/admin accounts are provisioned out-of-band, never self-registered
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

    const user = await prisma.$transaction(async (tx) => {
      const createdUser = await tx.user.create({
        data: {
          name: body.name,
          email,
          passwordHash,
          role: body.role,
        },
      });

      if (body.role === "STUDENT") {
        await tx.studentProfile.create({
          data: {
            userId: createdUser.id,
            referralCode: generateShortCode(),
          },
        });
      } else {
        await tx.parentProfile.create({
          data: { userId: createdUser.id },
        });
      }

      return createdUser;
    });

    return Response.json(
      { id: user.id, email: user.email, role: user.role },
      { status: 201 },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
