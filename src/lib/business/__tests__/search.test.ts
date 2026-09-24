import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDatabase } from "@/test/reset-db";
import { createCourse, createLesson, createTeacher, createVideo } from "@/test/factories";
import { searchForStudent, searchForTeacher } from "@/lib/business/search";

beforeEach(async () => {
  await resetDatabase();
});

describe("searchForStudent", () => {
  it("returns an empty array for a too-short query, without hitting the database", async () => {
    const results = await searchForStudent(prisma, "ا");
    expect(results).toEqual([]);
  });

  it("finds a published course by a case-insensitive partial title match", async () => {
    await createCourse({ status: "PUBLISHED" });
    const target = await prisma.course.create({
      data: {
        title: "أساسيات الفيزياء",
        categoryId: (await prisma.category.create({ data: { name: "علوم", slug: "sci-1" } })).id,
        teacherId: (await createTeacher()).id,
        academicYear: "2026",
        status: "PUBLISHED",
      },
    });

    const results = await searchForStudent(prisma, "فيزياء");

    expect(results.some((r) => r.type === "COURSE" && r.id === target.id)).toBe(true);
  });

  it("never returns a DRAFT course", async () => {
    await prisma.course.create({
      data: {
        title: "كورس مسودة سري",
        categoryId: (await prisma.category.create({ data: { name: "ق", slug: "cat-2" } })).id,
        teacherId: (await createTeacher()).id,
        academicYear: "2026",
        status: "DRAFT",
      },
    });

    const results = await searchForStudent(prisma, "مسودة");
    expect(results).toHaveLength(0);
  });

  it("links a lesson result to its video page only when a real video exists", async () => {
    const course = await createCourse({ status: "PUBLISHED" });
    const lessonWithVideo = await createLesson({ courseId: course.id, status: "PUBLISHED" });
    const video = await createVideo({ lessonId: lessonWithVideo.id });
    const lessonWithoutVideo = await createLesson({ courseId: course.id, status: "PUBLISHED" });
    await prisma.lesson.update({ where: { id: lessonWithVideo.id }, data: { title: "درس الجبر أ" } });
    await prisma.lesson.update({ where: { id: lessonWithoutVideo.id }, data: { title: "درس الجبر ب" } });

    const results = await searchForStudent(prisma, "الجبر");

    const withVideo = results.find((r) => r.id === lessonWithVideo.id);
    const withoutVideo = results.find((r) => r.id === lessonWithoutVideo.id);
    expect(withVideo?.href).toBe(`/student/videos/${video.id}`);
    expect(withoutVideo?.href).toBeNull();
  });

  it("never returns a lesson belonging to an unpublished course", async () => {
    const draftCourse = await createCourse({ status: "DRAFT" });
    await createLesson({ courseId: draftCourse.id, status: "PUBLISHED" });
    await prisma.lesson.updateMany({ where: { courseId: draftCourse.id }, data: { title: "درس خفي فريد" } });

    const results = await searchForStudent(prisma, "خفي فريد");
    expect(results).toHaveLength(0);
  });

  it("only returns an in-stock published product", async () => {
    await prisma.product.create({
      data: { title: "قلم فريد جدًا", priceCents: 100, stock: 5, status: "PUBLISHED" },
    });
    await prisma.product.create({
      data: { title: "قلم فريد جدًا نافد", priceCents: 100, stock: 0, status: "PUBLISHED" },
    });

    const results = await searchForStudent(prisma, "فريد جدًا");
    expect(results.filter((r) => r.type === "PRODUCT")).toHaveLength(1);
  });
});

describe("searchForTeacher", () => {
  it("also finds a DRAFT course, unlike the student search", async () => {
    const draft = await prisma.course.create({
      data: {
        title: "كورس مسودة للمعلم فقط",
        categoryId: (await prisma.category.create({ data: { name: "ق2", slug: "cat-3" } })).id,
        teacherId: (await createTeacher()).id,
        academicYear: "2026",
        status: "DRAFT",
      },
    });

    const results = await searchForTeacher(prisma, "مسودة للمعلم");

    expect(results.some((r) => r.type === "COURSE" && r.id === draft.id)).toBe(true);
  });

  it("links a lesson to its parent course's management page", async () => {
    const course = await createCourse();
    const lesson = await createLesson({ courseId: course.id, status: "DRAFT" });
    await prisma.lesson.update({ where: { id: lesson.id }, data: { title: "درس إدارة فريد" } });

    const results = await searchForTeacher(prisma, "إدارة فريد");

    const found = results.find((r) => r.id === lesson.id);
    expect(found?.href).toBe(`/teacher/courses/${course.id}`);
  });

  it("finds a question bank by name", async () => {
    const bank = await prisma.questionBank.create({
      data: { name: "بنك أسئلة الكيمياء الفريد", teacherId: (await createTeacher()).id },
    });

    const results = await searchForTeacher(prisma, "الكيمياء الفريد");

    expect(results.some((r) => r.type === "QUESTION_BANK" && r.id === bank.id)).toBe(true);
  });
});
