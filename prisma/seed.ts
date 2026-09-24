import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { PLATFORM_SETTING_KEYS } from "../src/lib/platform-settings";

const prisma = new PrismaClient();

async function main() {
  await prisma.platformSetting.upsert({
    where: { key: PLATFORM_SETTING_KEYS.DEFAULT_VIDEO_VIEW_LIMIT },
    create: { key: PLATFORM_SETTING_KEYS.DEFAULT_VIDEO_VIEW_LIMIT, value: 3 },
    update: {},
  });
  await prisma.platformSetting.upsert({
    where: { key: PLATFORM_SETTING_KEYS.VIEW_CONSUMPTION_THRESHOLD_PERCENT },
    create: {
      key: PLATFORM_SETTING_KEYS.VIEW_CONSUMPTION_THRESHOLD_PERCENT,
      value: 80,
    },
    update: {},
  });
  await prisma.platformSetting.upsert({
    where: { key: PLATFORM_SETTING_KEYS.DEFAULT_PASSING_SCORE_PERCENT },
    create: {
      key: PLATFORM_SETTING_KEYS.DEFAULT_PASSING_SCORE_PERCENT,
      value: 60,
    },
    update: {},
  });
  await prisma.platformSetting.upsert({
    where: { key: PLATFORM_SETTING_KEYS.DEFAULT_QUIZ_MAX_ATTEMPTS },
    create: { key: PLATFORM_SETTING_KEYS.DEFAULT_QUIZ_MAX_ATTEMPTS, value: 3 },
    update: {},
  });
  await prisma.platformSetting.upsert({
    where: { key: PLATFORM_SETTING_KEYS.ACADEMIC_YEAR_END },
    create: {
      key: PLATFORM_SETTING_KEYS.ACADEMIC_YEAR_END,
      value: `${new Date().getFullYear() + 1}-07-31`,
    },
    update: {},
  });

  // First teacher/admin account. Development gets a documented default;
  // production must supply its own credentials — a well-known default
  // password on a public deployment would be an open admin account.
  const production = process.env.NODE_ENV === "production";
  const teacherEmail = process.env.SEED_TEACHER_EMAIL || "teacher@eduplat.local";
  const configuredPassword = process.env.SEED_TEACHER_PASSWORD;
  if (production && (!configuredPassword || configuredPassword.length < 12)) {
    throw new Error(
      "In production set SEED_TEACHER_EMAIL and SEED_TEACHER_PASSWORD (at least 12 characters) before seeding.",
    );
  }
  const existingTeacher = await prisma.user.findUnique({
    where: { email: teacherEmail },
  });
  if (!existingTeacher) {
    const passwordHash = await bcrypt.hash(configuredPassword || "ChangeMe123!", 12);
    const teacher = await prisma.user.create({
      data: {
        email: teacherEmail,
        name: "Platform Teacher",
        passwordHash,
        role: "TEACHER_ADMIN",
      },
    });
    await prisma.teacherProfile.create({
      data: { userId: teacher.id },
    });
    // Never print a password that came from the environment.
    console.log(
      configuredPassword
        ? `Seeded teacher/admin account: ${teacherEmail} (password from SEED_TEACHER_PASSWORD)`
        : `Seeded development teacher/admin account: ${teacherEmail} / ChangeMe123! (development only)`,
    );
  } else {
    console.log(`Teacher/admin account ${teacherEmail} already exists — left unchanged.`);
  }

  console.log("Seed complete.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
