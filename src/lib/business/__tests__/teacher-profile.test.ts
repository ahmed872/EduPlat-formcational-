import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDatabase } from "@/test/reset-db";
import { createCategory } from "@/test/factories";
import {
  getTeacherProfile,
  parseLocations,
  parseSocialLinks,
  readContactInfo,
  readLocations,
  readSocialLinks,
  updateTeacherProfile,
} from "@/lib/business/teacher-profile";

beforeEach(async () => {
  await resetDatabase();
});

let counter = 0;
async function createTeacherUser() {
  counter += 1;
  return prisma.user.create({
    data: {
      email: `teacher-${Date.now()}-${counter}@test.local`,
      name: "Test Teacher",
      passwordHash: "not-used-in-tests",
      role: "TEACHER_ADMIN",
    },
  });
}

describe("getTeacherProfile", () => {
  it("returns a null profile and no courses for a teacher with nothing set up yet", async () => {
    const teacher = await createTeacherUser();

    const { profile, courses } = await getTeacherProfile(prisma, teacher.id);

    expect(profile).toBeNull();
    expect(courses).toHaveLength(0);
  });

  it("only lists the teacher's PUBLISHED courses, not drafts", async () => {
    const teacher = await createTeacherUser();
    const category = await createCategory();
    await prisma.course.create({
      data: {
        title: "منشور",
        categoryId: category.id,
        teacherId: teacher.id,
        academicYear: "2026",
        status: "PUBLISHED",
      },
    });
    await prisma.course.create({
      data: {
        title: "مسودة",
        categoryId: category.id,
        teacherId: teacher.id,
        academicYear: "2026",
        status: "DRAFT",
      },
    });

    const { courses } = await getTeacherProfile(prisma, teacher.id);

    expect(courses).toHaveLength(1);
    expect(courses[0].title).toBe("منشور");
  });
});

describe("updateTeacherProfile", () => {
  it("creates a profile row on first save", async () => {
    const teacher = await createTeacherUser();

    await updateTeacherProfile(prisma, { userId: teacher.id, bio: "معلم رياضيات" });

    const { profile } = await getTeacherProfile(prisma, teacher.id);
    expect(profile?.bio).toBe("معلم رياضيات");
  });

  it("updates an existing profile in place rather than duplicating it", async () => {
    const teacher = await createTeacherUser();
    await updateTeacherProfile(prisma, { userId: teacher.id, bio: "نسخة أولى" });

    await updateTeacherProfile(prisma, { userId: teacher.id, bio: "نسخة محدثة" });

    const count = await prisma.teacherProfile.count({ where: { userId: teacher.id } });
    expect(count).toBe(1);
    const { profile } = await getTeacherProfile(prisma, teacher.id);
    expect(profile?.bio).toBe("نسخة محدثة");
  });
});

// Final audit gap #7: socialLinks/contactInfo/locations existed as real
// schema columns but had no edit path and no public display at all.
describe("TeacherProfile photoUrl", () => {
  it("regression: only http(s) photo URLs are stored (it is rendered as <img src> publicly)", async () => {
    const teacher = await createTeacherUser();
    for (const bad of ["javascript:alert(1)", "data:image/svg+xml,<svg onload=alert(1)>", "not a url"]) {
      await expect(updateTeacherProfile(prisma, { userId: teacher.id, photoUrl: bad })).rejects.toThrow(/http/);
    }
    await updateTeacherProfile(prisma, { userId: teacher.id, photoUrl: "https://cdn.example.com/me.jpg" });
    const profile = await prisma.teacherProfile.findUniqueOrThrow({ where: { userId: teacher.id } });
    expect(profile.photoUrl).toBe("https://cdn.example.com/me.jpg");
  });
});

describe("TeacherProfile socialLinks / contactInfo / locations", () => {
  it("saves all three and reads them back for the public profile", async () => {
    const teacher = await createTeacherUser();

    await updateTeacherProfile(prisma, {
      userId: teacher.id,
      bio: "معلم",
      socialLinks: parseSocialLinks("YouTube | https://youtube.com/@t\nFacebook | https://facebook.com/t"),
      contactInfo: { email: "t@example.com", phone: "+20 100 123 4567", whatsapp: "" },
      locations: parseLocations("سنتر النور | شارع الجامعة | السبت 4م\nأونلاين"),
    });

    const { profile } = await getTeacherProfile(prisma, teacher.id);
    expect(readSocialLinks(profile!.socialLinks)).toEqual([
      { platform: "YouTube", url: "https://youtube.com/@t" },
      { platform: "Facebook", url: "https://facebook.com/t" },
    ]);
    expect(readContactInfo(profile!.contactInfo)).toEqual({
      email: "t@example.com",
      phone: "+20 100 123 4567",
      whatsapp: null,
    });
    expect(readLocations(profile!.locations)).toEqual([
      { name: "سنتر النور", address: "شارع الجامعة", schedule: "السبت 4م" },
      { name: "أونلاين", address: null, schedule: null },
    ]);
  });

  it("clears the fields back to NULL when emptied", async () => {
    const teacher = await createTeacherUser();
    await updateTeacherProfile(prisma, {
      userId: teacher.id,
      socialLinks: parseSocialLinks("X | https://x.com/t"),
      contactInfo: { email: "t@example.com", phone: null, whatsapp: null },
      locations: parseLocations("سنتر"),
    });

    await updateTeacherProfile(prisma, {
      userId: teacher.id,
      socialLinks: [],
      contactInfo: { email: "", phone: "", whatsapp: "" },
      locations: [],
    });

    const stored = await prisma.teacherProfile.findUniqueOrThrow({ where: { userId: teacher.id } });
    expect(stored.socialLinks).toBeNull();
    expect(stored.contactInfo).toBeNull();
    expect(stored.locations).toBeNull();
  });

  it("rejects a javascript:/non-http social link, even when passed straight to the business function", async () => {
    const teacher = await createTeacherUser();
    await expect(
      updateTeacherProfile(prisma, {
        userId: teacher.id,
        socialLinks: [{ platform: "x", url: "javascript:alert(document.cookie)" }],
      }),
    ).rejects.toThrow(/http/);
    expect(() => parseSocialLinks("no separator here")).toThrow();
    expect(await prisma.teacherProfile.count({ where: { userId: teacher.id } })).toBe(0);
  });

  it("rejects a malformed email or phone number", async () => {
    const teacher = await createTeacherUser();
    await expect(
      updateTeacherProfile(prisma, {
        userId: teacher.id,
        contactInfo: { email: "not-an-email", phone: null, whatsapp: null },
      }),
    ).rejects.toThrow(/البريد/);
    await expect(
      updateTeacherProfile(prisma, {
        userId: teacher.id,
        contactInfo: { email: null, phone: "javascript:alert(1)", whatsapp: null },
      }),
    ).rejects.toThrow(/الهاتف/);
  });

  it("rejects a location line with no name", () => {
    expect(() => parseLocations("x")).not.toThrow();
    return expect(
      updateTeacherProfile(prisma, {
        userId: "unused",
        locations: [{ name: "", address: "عنوان", schedule: null }],
      }),
    ).rejects.toThrow(/اسم مكان/);
  });

  it("read* helpers drop unsafe or malformed stored values instead of rendering them", () => {
    expect(
      readSocialLinks([
        { platform: "ok", url: "https://ok.example" },
        { platform: "bad", url: "javascript:alert(1)" },
        42,
      ]),
    ).toEqual([{ platform: "ok", url: "https://ok.example" }]);
    expect(readContactInfo({ email: "bad", phone: "javascript:x" })).toBeNull();
    expect(readLocations("not an array")).toEqual([]);
  });
});
