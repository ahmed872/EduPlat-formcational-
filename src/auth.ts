import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { authConfig } from "@/auth.config";
import { isRateLimited, recordLoginAttempt } from "@/lib/business/security";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(rawCredentials) {
        const parsed = credentialsSchema.safeParse(rawCredentials);
        if (!parsed.success) return null;
        const { email, password } = parsed.data;
        const normalizedEmail = email.toLowerCase();

        // Real brute-force throttling: too many recent failures for this
        // exact email blocks further attempts for the configured window,
        // regardless of whether this particular password is even correct.
        if (await isRateLimited(prisma, normalizedEmail)) {
          return null;
        }

        const user = await prisma.user.findUnique({
          where: { email: normalizedEmail },
          include: { studentProfile: true, parentProfile: true },
        });

        const validPassword =
          user && user.status !== "BLOCKED"
            ? await bcrypt.compare(password, user.passwordHash)
            : false;

        await recordLoginAttempt(prisma, { email: normalizedEmail, succeeded: validPassword });

        if (!user || user.status === "BLOCKED" || !validPassword) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          studentProfileId: user.studentProfile?.id ?? null,
          parentProfileId: user.parentProfile?.id ?? null,
        };
      },
    }),
  ],
});
