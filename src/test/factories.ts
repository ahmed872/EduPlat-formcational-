import { prisma } from "@/lib/prisma";
import { generateShortCode } from "@/lib/id";
import type { ContentStatus } from "@prisma/client";

let counter = 0;
function unique(prefix: string) {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}`;
}

export async function createStudent(overrides: { gradeLabel?: string } = {}) {
  const user = await prisma.user.create({
    data: {
      email: `${unique("student")}@test.local`,
      name: "Test Student",
      passwordHash: "not-used-in-tests",
      role: "STUDENT",
    },
  });
  return prisma.studentProfile.create({
    data: {
      userId: user.id,
      referralCode: generateShortCode(),
      gradeLabel: overrides.gradeLabel,
    },
  });
}

export async function createParent() {
  const user = await prisma.user.create({
    data: {
      email: `${unique("parent")}@test.local`,
      name: "Test Parent",
      passwordHash: "not-used-in-tests",
      role: "PARENT",
    },
  });
  return prisma.parentProfile.create({ data: { userId: user.id } });
}

export async function createCategory() {
  const name = unique("category");
  return prisma.category.create({
    data: { name, slug: name },
  });
}

export async function createCourse(
  overrides: { categoryId?: string; status?: ContentStatus } = {},
) {
  const categoryId = overrides.categoryId ?? (await createCategory()).id;
  return prisma.course.create({
    data: {
      categoryId,
      teacherId: "test-teacher",
      title: unique("course"),
      academicYear: "2026",
      status: overrides.status ?? "PUBLISHED",
    },
  });
}

export async function createLesson(overrides: {
  courseId?: string;
  isFree?: boolean;
  requiredPreviousLessonId?: string;
  status?: ContentStatus;
} = {}) {
  const courseId = overrides.courseId ?? (await createCourse()).id;
  return prisma.lesson.create({
    data: {
      courseId,
      title: unique("lesson"),
      isFree: overrides.isFree ?? false,
      status: overrides.status ?? "PUBLISHED",
      requiredPreviousLessonId: overrides.requiredPreviousLessonId,
    },
  });
}

export async function createVideo(overrides: {
  lessonId?: string;
  isFree?: boolean;
  viewLimit?: number;
} = {}) {
  return prisma.video.create({
    data: {
      lessonId: overrides.lessonId,
      title: unique("video"),
      storageKey: unique("storage-key"),
      isFree: overrides.isFree ?? false,
      viewLimit: overrides.viewLimit ?? 3,
      status: "PUBLISHED",
    },
  });
}

export async function createSubscriptionPlan(overrides: {
  academicYear?: string;
} = {}) {
  return prisma.subscriptionPlan.create({
    data: {
      name: unique("plan"),
      priceCents: 10000,
      academicYear: overrides.academicYear ?? "2026",
    },
  });
}

export async function createExperiment(overrides: {
  lessonId: string;
  isRequired?: boolean;
  order?: number;
}) {
  return prisma.experiment.create({
    data: {
      lessonId: overrides.lessonId,
      type: "INTERACTIVE",
      title: unique("experiment"),
      config: { instructions: "افعل كذا وكذا" },
      order: overrides.order ?? 0,
      isRequired: overrides.isRequired ?? true,
    },
  });
}
