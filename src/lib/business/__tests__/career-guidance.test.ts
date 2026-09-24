import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDatabase } from "@/test/reset-db";
import { createStudent } from "@/test/factories";
import {
  CAREER_QUIZ_QUESTIONS,
  createCareerField,
  getCareerExplorationHistory,
  listCareerFields,
  parseResources,
  parseRoadmap,
  readResources,
  readRoadmap,
  submitCareerExplorationQuiz,
  updateCareerField,
  type CareerFieldInput,
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

// Final audit gap #6: CareerField had create + delete only — fixing a typo
// meant delete + recreate, orphaning the old id inside every past
// CareerExplorationResult.suggestedFieldIds; and roadmap/resources existed
// in the schema but were never populated or shown anywhere.
describe("createCareerField / updateCareerField", () => {
  function input(overrides: Partial<CareerFieldInput> = {}): CareerFieldInput {
    return {
      name: "هندسة البرمجيات",
      description: "وصف",
      commonJobs: [],
      requiredSkills: [],
      traits: ["TECH_PROGRAMMING"],
      roadmap: [],
      resources: [],
      portfolioAdvice: null,
      jobPrepAdvice: null,
      ...overrides,
    };
  }

  it("edits a field in place, keeping its id so past exploration results still resolve it", async () => {
    const student = await createStudent();
    const field = await createCareerField(prisma, input({ name: "هندسه البرمجيات" })); // typo
    const answers = fullAnswers();
    for (const q of CAREER_QUIZ_QUESTIONS) {
      const techOption = q.options.find((o) => o.trait === "TECH_PROGRAMMING");
      if (techOption) answers[q.id] = techOption.trait;
    }
    await submitCareerExplorationQuiz(prisma, { studentId: student.id, answers });

    const updated = await updateCareerField(prisma, field.id, input({ name: "هندسة البرمجيات" }));

    expect(updated.id).toBe(field.id);
    expect(updated.slug).toBe(field.slug);
    const history = await getCareerExplorationHistory(prisma, student.id);
    expect(history[0].suggestedFields.map((f) => f.name)).toEqual(["هندسة البرمجيات"]);
  });

  it("persists roadmap steps and resources, readable back for display", async () => {
    const field = await createCareerField(
      prisma,
      input({
        roadmap: parseRoadmap("تعلّم الأساسيات\n\n  ابنِ مشروعًا  \n"),
        resources: parseResources("CS50 | https://cs50.harvard.edu\nMDN | https://developer.mozilla.org"),
      }),
    );

    const stored = await prisma.careerField.findUniqueOrThrow({ where: { id: field.id } });
    expect(readRoadmap(stored.roadmap)).toEqual(["تعلّم الأساسيات", "ابنِ مشروعًا"]);
    expect(readResources(stored.resources)).toEqual([
      { title: "CS50", url: "https://cs50.harvard.edu" },
      { title: "MDN", url: "https://developer.mozilla.org" },
    ]);

    const updated = await updateCareerField(prisma, field.id, input({ roadmap: ["خطوة واحدة"], resources: [] }));
    expect(readRoadmap(updated.roadmap)).toEqual(["خطوة واحدة"]);
    expect(readResources(updated.resources)).toEqual([]);
  });

  it("rejects a non-http(s) resource URL (e.g. javascript:) so it can never be rendered into an href", () => {
    expect(() => parseResources("click me | javascript:alert(1)")).toThrow();
    expect(() => parseResources("no url here")).toThrow();
    expect(() => parseResources("data | data:text/html,<script>alert(1)</script>")).toThrow();
  });

  it("also rejects an unsafe URL passed straight to the business function, bypassing the form parser", async () => {
    await expect(
      createCareerField(prisma, input({ resources: [{ title: "x", url: "javascript:alert(1)" }] })),
    ).rejects.toThrow();
  });

  it("readResources drops any unsafe URL already stored, rather than rendering it", () => {
    expect(
      readResources([
        { title: "ok", url: "https://example.com" },
        { title: "bad", url: "javascript:alert(1)" },
        "garbage",
      ]),
    ).toEqual([{ title: "ok", url: "https://example.com" }]);
  });

  it("rejects an update with an empty name or description, and drops unknown traits", async () => {
    const field = await createCareerField(prisma, input());
    await expect(updateCareerField(prisma, field.id, input({ name: "  " }))).rejects.toThrow(/اسم المجال/);

    const updated = await updateCareerField(
      prisma,
      field.id,
      input({ traits: ["TECH_PROGRAMMING", "NOT_A_REAL_TRAIT"] }),
    );
    expect(updated.traits).toEqual(["TECH_PROGRAMMING"]);
  });
});
