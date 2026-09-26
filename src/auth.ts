import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { authConfig } from "@/auth.config";
import { isRateLimited, recordLoginAttempt } from "@/lib/business/security";
import { verifyPassword } from "@/lib/business/password";
import { isSessionStillValid } from "@/lib/business/session-validity";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  callbacks: {
    ...authConfig.callbacks,
    // Re-verifies the account on every session read (every `auth()` call
    // and every request through proxy.ts): a blocked account, a token
    // issued before the latest password reset/change (sessionVersion), or a
    // signed-out session (RevokedSession) is treated as signed out. The JWT signature alone can't express either.
    // Setting session.user to null makes every check that already treats
    // `!session?.user` as unauthenticated do the right thing.
    async session(params) {
      const session = await authConfig.callbacks!.session!(params);
      if (!session.user?.id) return session;

      const token = (params as { token?: { sessionVersion?: number; sid?: string } }).token;
      const valid = await isSessionStillValid(prisma, {
        userId: session.user.id,
        sessionVersion: token?.sessionVersion,
        sid: token?.sid,
      });
      if (!valid) {
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
            ? await verifyPassword(password, user.passwordHash)
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
          sessionVersion: user.sessionVersion,
        };
      },
    }),
  ],
});
