import type { NextAuthConfig } from "next-auth";

/**
 * Edge-safe subset of the auth config (no Prisma/bcrypt providers here).
 * Used by middleware.ts, which runs on the Edge runtime and only needs to
 * read the already-issued JWT — never to authenticate credentials.
 */
export const authConfig: NextAuthConfig = {
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  providers: [],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id as string;
        token.role = user.role;
        token.studentProfileId = user.studentProfileId;
        token.parentProfileId = user.parentProfileId;
        token.sessionVersion = user.sessionVersion;
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.id;
      session.user.role = token.role;
      session.user.studentProfileId = token.studentProfileId;
      session.user.parentProfileId = token.parentProfileId;
      return session;
    },
  },
};
