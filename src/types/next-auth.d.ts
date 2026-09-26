import type { UserRole } from "@prisma/client";
import type { DefaultSession } from "@auth/core/types";

declare module "@auth/core/types" {
  interface Session {
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
  }
}
