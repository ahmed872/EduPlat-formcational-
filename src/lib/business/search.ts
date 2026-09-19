import type { PrismaClient } from "@prisma/client";

export type SearchResultType = "COURSE" | "LESSON" | "SHORT" | "PRODUCT" | "CAREER_FIELD" | "QUESTION_BANK";

export type SearchResult = {
  type: SearchResultType;
  id: string;
  title: string;
  subtitle: string | null;
  href: string | null; // null when no specific detail page exists — informational only
};

const MIN_QUERY_LENGTH = 2;

function insensitiveContains(query: string) {
  return { contains: query, mode: "insensitive" as const };
}

/**
 * Only ever queries content a student can already discover elsewhere in
 * the app (published courses/lessons/shorts, in-stock published
 * products, career fields) — search is a navigation shortcut, never a
 * new access path. Clicking through to a lesson's video still runs the
 * full checkVideoAccess gate exactly as browsing the dashboard would;
 * search never bypasses it.
 */
export async function searchForStudent(
  prisma: PrismaClient,
  query: string,
): Promise<SearchResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < MIN_QUERY_LENGTH) return [];

  const [courses, lessons, shorts, products, careerFields] = await Promise.all([
    prisma.course.findMany({
      where: { status: "PUBLISHED", title: insensitiveContains(trimmed) },
      include: { category: true },
      take: 10,
    }),
    prisma.lesson.findMany({
      where: {
        status: "PUBLISHED",
        title: insensitiveContains(trimmed),
        course: { status: "PUBLISHED" },
      },
      include: { course: true, video: true },
      take: 10,
    }),
    prisma.short.findMany({
      where: { status: "PUBLISHED", title: insensitiveContains(trimmed) },
      take: 10,
    }),
    prisma.product.findMany({
      where: { status: "PUBLISHED", stock: { gt: 0 }, title: insensitiveContains(trimmed) },
      take: 10,
    }),
    prisma.careerField.findMany({
      where: { name: insensitiveContains(trimmed) },
      take: 10,
    }),
  ]);

  return [
    ...courses.map((c): SearchResult => ({
      type: "COURSE",
      id: c.id,
      title: c.title,
      subtitle: c.category.name,
      href: null, // no student-facing course detail page exists — browse from the dashboard
    })),
    ...lessons.map((l): SearchResult => ({
      type: "LESSON",
      id: l.id,
      title: l.title,
      subtitle: l.course.title,
      href: l.video ? `/student/videos/${l.video.id}` : null,
    })),
    ...shorts.map((s): SearchResult => ({
      type: "SHORT",
      id: s.id,
      title: s.title,
      subtitle: null,
      href: `/shorts/${s.id}`,
    })),
    ...products.map((p): SearchResult => ({
      type: "PRODUCT",
      id: p.id,
      title: p.title,
      subtitle: `${(p.priceCents / 100).toFixed(2)} جنيه`,
      href: "/student/store",
    })),
    ...careerFields.map((f): SearchResult => ({
      type: "CAREER_FIELD",
      id: f.id,
      title: f.name,
      subtitle: null,
      href: "/student/career-guidance",
    })),
  ];
}

/**
 * A teacher can see draft/unpublished content too (they're managing it,
 * not discovering it as a learner) and gets real per-item links wherever
 * a management page actually exists.
 */
export async function searchForTeacher(
  prisma: PrismaClient,
  query: string,
): Promise<SearchResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < MIN_QUERY_LENGTH) return [];

  const [courses, lessons, shorts, products, careerFields, questionBanks] = await Promise.all([
    prisma.course.findMany({
      where: { title: insensitiveContains(trimmed) },
      include: { category: true },
      take: 10,
    }),
    prisma.lesson.findMany({
      where: { title: insensitiveContains(trimmed) },
      include: { course: true },
      take: 10,
    }),
    prisma.short.findMany({ where: { title: insensitiveContains(trimmed) }, take: 10 }),
    prisma.product.findMany({ where: { title: insensitiveContains(trimmed) }, take: 10 }),
    prisma.careerField.findMany({ where: { name: insensitiveContains(trimmed) }, take: 10 }),
    prisma.questionBank.findMany({ where: { name: insensitiveContains(trimmed) }, take: 10 }),
  ]);

  return [
    ...courses.map((c): SearchResult => ({
      type: "COURSE",
      id: c.id,
      title: c.title,
      subtitle: c.category.name,
      href: `/teacher/courses/${c.id}`,
    })),
    ...lessons.map((l): SearchResult => ({
      type: "LESSON",
      id: l.id,
      title: l.title,
      subtitle: l.course.title,
      href: `/teacher/courses/${l.courseId}`,
    })),
    ...shorts.map((s): SearchResult => ({
      type: "SHORT",
      id: s.id,
      title: s.title,
      subtitle: null,
      href: "/teacher/shorts",
    })),
    ...products.map((p): SearchResult => ({
      type: "PRODUCT",
      id: p.id,
      title: p.title,
      subtitle: `${(p.priceCents / 100).toFixed(2)} جنيه`,
      href: "/teacher/products",
    })),
    ...careerFields.map((f): SearchResult => ({
      type: "CAREER_FIELD",
      id: f.id,
      title: f.name,
      subtitle: null,
      href: "/teacher/career-fields",
    })),
    ...questionBanks.map((b): SearchResult => ({
      type: "QUESTION_BANK",
      id: b.id,
      title: b.name,
      subtitle: b.description,
      href: `/teacher/question-bank/${b.id}`,
    })),
  ];
}
