"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/rbac";
import { CAREER_TRAITS } from "@/lib/business/career-guidance";

function slugify(name: string) {
  return `${name.trim().toLowerCase().replace(/\s+/g, "-")}-${Date.now().toString(36)}`;
}

function parseList(raw: string) {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function createCareerField(formData: FormData) {
  const session = await auth();
  requireRole(session, ["TEACHER_ADMIN"]);

  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  if (!name || !description) {
    throw new Error("الرجاء إدخال اسم المجال ووصفه");
  }

  const commonJobs = parseList(String(formData.get("commonJobs") ?? ""));
  const requiredSkills = parseList(String(formData.get("requiredSkills") ?? ""));
  const traits = formData.getAll("traits").map(String).filter((t) =>
    (CAREER_TRAITS as readonly string[]).includes(t),
  );
  const portfolioAdvice = String(formData.get("portfolioAdvice") ?? "").trim() || null;
  const jobPrepAdvice = String(formData.get("jobPrepAdvice") ?? "").trim() || null;

  await prisma.careerField.create({
    data: {
      name,
      slug: slugify(name),
      description,
      commonJobs,
      requiredSkills,
      traits,
      portfolioAdvice,
      jobPrepAdvice,
    },
  });

  revalidatePath("/teacher/career-fields");
}

export async function deleteCareerField(fieldId: string) {
  const session = await auth();
  requireRole(session, ["TEACHER_ADMIN"]);

  await prisma.careerField.delete({ where: { id: fieldId } });

  revalidatePath("/teacher/career-fields");
}
