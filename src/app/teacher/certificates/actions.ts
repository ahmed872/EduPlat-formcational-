"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/rbac";
import { restoreCertificate, revokeCertificate } from "@/lib/business/certificates";

export async function revokeCertificateAction(certificateId: string, formData: FormData) {
  const session = await auth();
  requireRole(session, ["TEACHER_ADMIN"]);
  await revokeCertificate(prisma, {
    certificateId,
    actorUserId: session.user.id,
    reason: String(formData.get("reason") ?? ""),
  });
  revalidatePath("/teacher/certificates");
}

export async function restoreCertificateAction(certificateId: string) {
  const session = await auth();
  requireRole(session, ["TEACHER_ADMIN"]);
  await restoreCertificate(prisma, { certificateId, actorUserId: session.user.id });
  revalidatePath("/teacher/certificates");
}
