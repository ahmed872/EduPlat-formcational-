"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/rbac";
import {
  createCareerField as createCareerFieldRecord,
  parseResources,
  parseRoadmap,
  updateCareerField as updateCareerFieldRecord,
  type CareerFieldInput,
} from "@/lib/business/career-guidance";

function parseList(raw: string) {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function careerFieldInputFromForm(formData: FormData): CareerFieldInput {
  return {
    name: String(formData.get("name") ?? ""),
    description: String(formData.get("description") ?? ""),
    commonJobs: parseList(String(formData.get("commonJobs") ?? "")),
    requiredSkills: parseList(String(formData.get("requiredSkills") ?? "")),
    traits: formData.getAll("traits").map(String),
    roadmap: parseRoadmap(String(formData.get("roadmap") ?? "")),
    resources: parseResources(String(formData.get("resources") ?? "")),
    portfolioAdvice: String(formData.get("portfolioAdvice") ?? "").trim() || null,
    jobPrepAdvice: String(formData.get("jobPrepAdvice") ?? "").trim() || null,
  };
}

export async function createCareerField(formData: FormData) {
  const session = await auth();
  requireRole(session, ["TEACHER_ADMIN"]);

  await createCareerFieldRecord(prisma, careerFieldInputFromForm(formData));

  revalidatePath("/teacher/career-fields");
  revalidatePath("/student/career-guidance");
}

export async function updateCareerField(fieldId: string, formData: FormData) {
  const session = await auth();
  requireRole(session, ["TEACHER_ADMIN"]);

  await updateCareerFieldRecord(prisma, fieldId, careerFieldInputFromForm(formData));

  revalidatePath("/teacher/career-fields");
  revalidatePath("/student/career-guidance");
}

export async function deleteCareerField(fieldId: string) {
  const session = await auth();
  requireRole(session, ["TEACHER_ADMIN"]);

  await prisma.careerField.delete({ where: { id: fieldId } });

  revalidatePath("/teacher/career-fields");
}
