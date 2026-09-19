import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDatabase } from "@/test/reset-db";
import { createStudent } from "@/test/factories";
import {
  CAREER_QUIZ_QUESTIONS,
  getCareerExplorationHistory,
  listCareerFields,
  submitCareerExplorationQuiz,
  type CareerQuizAnswers,
} from "@/lib/business/career-guidance";

beforeEach(async () => {
  await resetDatabase();
});

function fullAnswers(overrides: CareerQuizAnswers = {}): CareerQuizAnswers {
  const base = {} as CareerQuizAnswers;
  for (const question of CAREER_QUIZ_QUESTIONS) {
    base[question.id] = question.options[0].trait;
  }
  return { ...base, ...overrides };
}

async function createField(name: string, traits: string[]) {
  return prisma.careerField.create({
    data: { name, slug: `${name}-${Date.now()}-${Math.random()}`, description: "وصف", traits },
  });
}

describe("submitCareerExplorationQuiz", () => {
  it("suggests the field whose traits best overlap the student's answers", async () => {
    const student = await createStudent();
    // Every question answered with its first option's trait.
    const dominantTrait = CAREER_QUIZ_QUESTIONS[0].options[0].trait;
    const matchingField = await createField("مجال مطابق", [dominantTrait]);
    await createField("مجال غير مطابق", ["HELPING_OTHERS" === dominantTrait ? "HANDS_ON" : "HELPING_OTHERS"]);

    const { suggestedFields } = await submitCareerExplorationQuiz(prisma, {
      studentId: student.id,
      answers: fullAnswers(),
    });

    expect(suggestedFields.map((f) => f.id)).toContain(matchingField.id);
  });

  it("never suggests a field with zero trait overlap", async () => {
    const student = await createStudent();
    const answers = fullAnswers();
    const usedTraits = new Set(Object.values(answers));
    const unusedTrait = (["MATH_LOGIC", "CREATIVE_DESIGN", "COMMUNICATION", "HANDS_ON", "SCIENCE_RESEARCH", "TECH_PROGRAMMING", "BUSINESS_LEADERSHIP", "HELPING_OTHERS"] as const).find(
      (t) => !usedTraits.has(t),
    );
    if (!unusedTrait) return; // all traits used across 5 questions is not expected, but guard anyway

    const unmatchedField = await createField("مجال بلا تطابق", [unusedTrait]);

    const { suggestedFields } = await submitCareerExplorationQuiz(prisma, {
      studentId: student.id,
      answers,
    });

    expect(suggestedFields.map((f) => f.id)).not.toContain(unmatchedField.id);
  });

  it("returns at most 3 suggested fields, ranked by overlap score", async () => {
    const student = await createStudent();
    const answers = fullAnswers();
    const trait = answers[CAREER_QUIZ_QUESTIONS[0].id];

    for (let i = 0; i < 5; i++) {
      await createField(`مجال ${i}`, [trait]);
    }

    const { result, suggestedFields } = await submitCareerExplorationQuiz(prisma, {
      studentId: student.id,
      answers,
    });

    expect(suggestedFields.length).toBeLessThanOrEqual(3);
    expect(result.suggestedFieldIds.length).toBeLessThanOrEqual(3);
  });

  it("rejects an answer set missing a question", async () => {
    const student = await createStudent();
    const answers = fullAnswers();
    delete answers[CAREER_QUIZ_QUESTIONS[0].id];

    await expect(
      submitCareerExplorationQuiz(prisma, { studentId: student.id, answers }),
    ).rejects.toThrow(/الرجاء الإجابة/);
  });

  it("rejects an unknown question id", async () => {
    const student = await createStudent();
    const answers = fullAnswers({ not_a_real_question: "MATH_LOGIC" });

    await expect(
      submitCareerExplorationQuiz(prisma, { studentId: student.id, answers }),
    ).rejects.toThrow(/سؤال غير معروف/);
  });

  it("persists a permanent CareerExplorationResult row", async () => {
    const student = await createStudent();
    await submitCareerExplorationQuiz(prisma, { studentId: student.id, answers: fullAnswers() });

    const count = await prisma.careerExplorationResult.count({ where: { studentId: student.id } });
    expect(count).toBe(1);
  });
});

describe("getCareerExplorationHistory", () => {
  it("returns results newest-first with their resolved fields", async () => {
    const student = await createStudent();
    const trait = CAREER_QUIZ_QUESTIONS[0].options[0].trait;
    await createField("مجال أول", [trait]);

    await submitCareerExplorationQuiz(prisma, { studentId: student.id, answers: fullAnswers() });
    await submitCareerExplorationQuiz(prisma, { studentId: student.id, answers: fullAnswers() });

    const history = await getCareerExplorationHistory(prisma, student.id);
    expect(history).toHaveLength(2);
    expect(history[0].result.takenAt.getTime()).toBeGreaterThanOrEqual(
      history[1].result.takenAt.getTime(),
    );
    expect(history[0].suggestedFields[0].name).toBe("مجال أول");
  });
});

describe("listCareerFields", () => {
  it("lists fields ordered by their configured order", async () => {
    await prisma.careerField.create({
      data: { name: "ب", slug: `b-${Date.now()}`, description: "د", order: 2 },
    });
    await prisma.careerField.create({
      data: { name: "أ", slug: `a-${Date.now()}`, description: "د", order: 1 },
    });

    const fields = await listCareerFields(prisma);
    expect(fields.map((f) => f.name)).toEqual(["أ", "ب"]);
  });
});
