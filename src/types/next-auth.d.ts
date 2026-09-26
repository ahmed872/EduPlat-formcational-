import type { UserRole } from "@prisma/client";
import type { DefaultSession } from "@auth/core/types";

declare module "@auth/core/types" {
  interface Session {
    /** This sign-in's id (JWT `sid`); sign-out revokes it server-side. */
    sessionId?: string;
    user: {
      id: string;
      role: UserRole;
      studentProfileId: string | null;
      parentProfileId: string | null;
    } & DefaultSession["user"];
  }

  interface User {
    role: UserRole;
    studentProfileId: string | null;
    parentProfileId: string | null;
    sessionVersion?: number;
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    id: string;
    role: UserRole;
    studentProfileId: string | null;
    parentProfileId: string | null;
    // Absent on tokens issued before password resets existed (= version 0).
    sessionVersion?: number;
    sid?: string;
  }
}
