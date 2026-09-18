import { describe, expect, it } from "vitest";
import type { Session } from "next-auth";
import { ForbiddenError, UnauthorizedError, requireRole } from "@/lib/rbac";

function fakeSession(role: Session["user"]["role"]): Session {
  return {
    user: {
      id: "user-1",
      role,
      studentProfileId: role === "STUDENT" ? "student-1" : null,
      parentProfileId: role === "PARENT" ? "parent-1" : null,
    },
    expires: new Date(Date.now() + 60_000).toISOString(),
  };
}

describe("requireRole", () => {
  it("throws UnauthorizedError when there is no session", () => {
    expect(() => requireRole(null, ["TEACHER_ADMIN"])).toThrow(UnauthorizedError);
  });

  it("throws ForbiddenError when a STUDENT calls a TEACHER_ADMIN-only route", () => {
    const session = fakeSession("STUDENT");
    expect(() => requireRole(session, ["TEACHER_ADMIN"])).toThrow(ForbiddenError);
  });

  it("throws ForbiddenError when a PARENT calls a TEACHER_ADMIN-only (admin) route", () => {
    const session = fakeSession("PARENT");
    expect(() => requireRole(session, ["TEACHER_ADMIN"])).toThrow(ForbiddenError);
  });

  it("allows a TEACHER_ADMIN through a TEACHER_ADMIN-only route", () => {
    const session = fakeSession("TEACHER_ADMIN");
    expect(() => requireRole(session, ["TEACHER_ADMIN"])).not.toThrow();
  });

  it("allows any of multiple permitted roles", () => {
    const session = fakeSession("PARENT");
    expect(() => requireRole(session, ["PARENT", "TEACHER_ADMIN"])).not.toThrow();
  });
});
