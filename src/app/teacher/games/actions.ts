"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/rbac";
import type { GameQuestion } from "@/lib/business/games";
import type { GameType } from "@prisma/client";
import { isForeignKeyConstraintError } from "@/lib/prisma-errors";

export async function createGame(formData: FormData) {
  const session = await auth();
  requireRole(session, ["TEACHER_ADMIN"]);

  const type = String(formData.get("type") ?? "") as GameType;
  const name = String(formData.get("name") ?? "").trim();
  if (!type || !name) throw new Error("الرجاء إدخال نوع اللعبة واسمها");

  const dailyOpenTime =
    type === "DAILY_MAIN" ? String(formData.get("dailyOpenTime") ?? "") || null : null;
  if (type !== "MINI" && type !== "DAILY_MAIN") throw new Error("نوع لعبة غير صالح");

  const durationMinutes = Number(formData.get("durationMinutes") || (type === "MINI" ? 5 : 10));
  const miniCooldownMinutes = Number(formData.get("miniCooldownMinutes") || 60);
  if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 180) {
    throw new Error("مدة اللعبة يجب أن تكون بين 1 و180 دقيقة");
  }
  if (!Number.isInteger(miniCooldownMinutes) || miniCooldownMinutes < 1 || miniCooldownMinutes > 1440) {
    throw new Error("فترة الانتظار يجب أن تكون بين 1 و1440 دقيقة");
  }

  await prisma.game.create({
    data: {
      type,
      name,
      dailyOpenTime,
      durationMinutes,
      miniCooldownMinutes,
      config: { questions: [] },
    },
  });

  revalidatePath("/teacher/games");
}

export async function toggleGameActive(gameId: string, currentlyActive: boolean) {
  const session = await auth();
  requireRole(session, ["TEACHER_ADMIN"]);

  await prisma.game.update({ where: { id: gameId }, data: { active: !currentlyActive } });

  revalidatePath("/teacher/games");
}

export async function deleteGame(gameId: string) {
  const session = await auth();
  requireRole(session, ["TEACHER_ADMIN"]);

  try {
    await prisma.game.delete({ where: { id: gameId } });
  } catch (error) {
    // GameSession.gameId is ON DELETE RESTRICT — any game a student has
    // ever played cannot be hard-deleted. A clean, actionable error beats
    // letting Postgres's raw FK-violation crash the server action.
    if (isForeignKeyConstraintError(error)) {
      throw new Error(
        "لا يمكن حذف هذه اللعبة لأن طلابًا قد لعبوها بالفعل — يمكنك إيقافها بدلاً من الحذف",
      );
    }
    throw error;
  }

  revalidatePath("/teacher/games");
}

export async function addQuestionToGame(gameId: string, formData: FormData) {
  const session = await auth();
  requireRole(session, ["TEACHER_ADMIN"]);

  const prompt = String(formData.get("prompt") ?? "").trim();
  const choicesRaw = String(formData.get("choices") ?? "");
  const correctChoice = String(formData.get("correctChoice") ?? "").trim();

  const choices = choicesRaw
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  const correctIndex = choices.indexOf(correctChoice);

  if (!prompt || choices.length < 2) {
    throw new Error("الرجاء إدخال السؤال وخيارين على الأقل");
  }
  if (correctIndex === -1) {
    throw new Error("الإجابة الصحيحة يجب أن تكون واحدة من الخيارات المكتوبة");
  }

  const game = await prisma.game.findUniqueOrThrow({ where: { id: gameId } });
  const config = (game.config ?? { questions: [] }) as { questions: GameQuestion[] };
  const questions = [...config.questions, { prompt, choices, correctIndex }];

  await prisma.game.update({
    where: { id: gameId },
    data: { config: { questions } },
  });

  revalidatePath(`/teacher/games`);
}

export async function removeQuestionFromGame(gameId: string, questionIndex: number) {
  const session = await auth();
  requireRole(session, ["TEACHER_ADMIN"]);

  const game = await prisma.game.findUniqueOrThrow({ where: { id: gameId } });
  const config = (game.config ?? { questions: [] }) as { questions: GameQuestion[] };
  const questions = config.questions.filter((_, i) => i !== questionIndex);

  await prisma.game.update({
    where: { id: gameId },
    data: { config: { questions } },
  });

  revalidatePath(`/teacher/games`);
}
