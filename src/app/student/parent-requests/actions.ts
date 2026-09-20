"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { approveParentLink, rejectParentLink } from "@/lib/business/parent-link";

export async function approveRequest(parentStudentId: string) {
  const session = await auth();
  requireRole(session, ["STUDENT"]);

  await approveParentLink(prisma, {
    parentStudentId,
    studentId: session.user.studentProfileId!,
  });

  revalidatePath("/student/parent-requests");
}

export async function rejectRequest(parentStudentId: string) {
  const session = await auth();
  requireRole(session, ["STUDENT"]);

  await rejectParentLink(prisma, {
    parentStudentId,
    studentId: session.user.studentProfileId!,
  });

  revalidatePath("/student/parent-requests");
}

// Cutting off an already-approved parent link and rejecting a still-pending
// request are the same underlying operation (delete the ParentStudent row,
// re-checking ownership) — there was previously no way to do the former at
// all, since the UI never offered this action for an approved link.
export async function revokeLink(parentStudentId: string) {
  const session = await auth();
  requireRole(session, ["STUDENT"]);

  await rejectParentLink(prisma, {
    parentStudentId,
    studentId: session.user.studentProfileId!,
  });

  revalidatePath("/student/parent-requests");
}
