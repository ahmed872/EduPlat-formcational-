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
  callbacks: {
    ...authConfig.callbacks,
    // Re-verifies the account's live status on every session read (every
    // `auth()` call from a server component/action/route — this instance,
    // not the edge-safe one in auth.config.ts used by proxy.ts). Without
    // this, blocking a user only ever affected NEW sign-ins: an already-
    // issued JWT for a student blocked mid-session kept passing every
    // requireRole()/requireSession() check until the token naturally
    // expired, contradicting the account-management UI's own claim that a
    // block "يمنعه فعليًا من تسجيل الدخول فورًا" (takes effect immediately).
    // Setting session.user to null makes every existing check that already
    // treats `!session?.user` as unauthenticated do the right thing with no
    // other code path needing to change.
    async session(params) {
      const session = await authConfig.callbacks!.session!(params);
      if (!session.user?.id) return session;

      const user = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { status: true },
      });
      if (!user || user.status === "BLOCKED") {
        return { ...session, user: null as unknown as typeof session.user };
      }
      return session;
    },
  },
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
