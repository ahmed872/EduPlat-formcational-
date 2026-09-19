import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDatabase } from "@/test/reset-db";
import { createCategory } from "@/test/factories";
import { getTeacherProfile, updateTeacherProfile } from "@/lib/business/teacher-profile";

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
