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
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    id: string;
    role: UserRole;
    studentProfileId: string | null;
    parentProfileId: string | null;
  }
}
