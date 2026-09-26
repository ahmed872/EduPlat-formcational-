import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { resetDatabase } from "@/test/reset-db";
import { createStudent, createTeacher } from "@/test/factories";
import { sessionCookieFor } from "@/test/session";
import proxy from "@/proxy";

beforeEach(async () => {
  await resetDatabase();
});

type ProxyFn = (req: NextRequest, ctx: unknown) => Promise<Response>;

async function visit(path: string, cookie?: string): Promise<{ status: number; location: string | null }> {
  const req = new NextRequest(`http://localhost:3000${path}`, { headers: cookie ? { cookie } : {} });
  const res = await (proxy as unknown as ProxyFn)(req, {});
  return { status: res.status, location: res.headers.get("location") };
}

describe("proxy: live session check on every protected request", () => {
  it("lets a valid session through and sends the wrong role home", async () => {
    const teacher = await createTeacher();
    const cookie = await sessionCookieFor({ id: teacher.id, role: "TEACHER_ADMIN", sessionVersion: 0 });
    expect((await visit("/teacher/accounts", cookie)).status).toBe(200);
    expect((await visit("/account/password", cookie)).status).toBe(200);
    const student = await visit("/student", cookie);
    expect(student.status).toBe(307);
    expect(new URL(student.location!).pathname).toBe("/");
  });

  it("redirects to login once the password was reset (old session version)", async () => {
    // Regression: the proxy used to accept any correctly signed JWT, and many
    // pages rely on their layout for the auth check — which a client-side
    // navigation skips — so an invalidated session could still read them.
    const teacher = await createTeacher();
    const cookie = await sessionCookieFor({ id: teacher.id, role: "TEACHER_ADMIN", sessionVersion: 0 });
    await prisma.user.update({ where: { id: teacher.id }, data: { sessionVersion: 1 } });

    const res = await visit("/teacher/accounts", cookie);
    expect(res.status).toBe(307);
    expect(new URL(res.location!).pathname).toBe("/login");

    const fresh = await sessionCookieFor({ id: teacher.id, role: "TEACHER_ADMIN", sessionVersion: 1 });
    expect((await visit("/teacher/accounts", fresh)).status).toBe(200);
  });

  it("redirects a blocked account to login", async () => {
    const student = await createStudent();
    const user = await prisma.user.update({
      where: { id: (await prisma.studentProfile.findUniqueOrThrow({ where: { id: student.id } })).userId },
      data: { status: "BLOCKED" },
    });
    const cookie = await sessionCookieFor({ id: user.id, role: "STUDENT", studentProfileId: student.id });
    const res = await visit("/student/hall-of-fame", cookie);
    expect(res.status).toBe(307);
    expect(new URL(res.location!).pathname).toBe("/login");
  });

  it("redirects anonymous visitors, and leaves public pages alone", async () => {
    expect(new URL((await visit("/account/password")).location!).pathname).toBe("/login");
    expect(new URL((await visit("/teacher")).location!).pathname).toBe("/login");
    // Prefix matching is exact: /accountant is not /account.
    expect((await visit("/accountant")).status).toBe(200);
  });
});
