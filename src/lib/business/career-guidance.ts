import type { PrismaClient } from "@prisma/client";

/**
 * Fixed interest-trait vocabulary the exploration quiz's questions and
 * every CareerField.traits array both speak — the quiz can't sensibly
 * machine-match against a teacher's free-text requiredSkills, so this
 * closed set is the honest alternative (same "no fake AI matching"
 * stance as the rest of the platform).
 */
export const CAREER_TRAITS = [
  "MATH_LOGIC",
  "CREATIVE_DESIGN",
  "COMMUNICATION",
  "HANDS_ON",
  "SCIENCE_RESEARCH",
  "TECH_PROGRAMMING",
  "BUSINESS_LEADERSHIP",
  "HELPING_OTHERS",
] as const;
export type CareerTrait = (typeof CAREER_TRAITS)[number];

export const CAREER_TRAIT_LABELS: Record<CareerTrait, string> = {
  MATH_LOGIC: "المنطق والرياضيات",
  CREATIVE_DESIGN: "الإبداع والتصميم",
  COMMUNICATION: "التواصل والإقناع",
  HANDS_ON: "العمل اليدوي والتطبيقي",
  SCIENCE_RESEARCH: "العلوم والبحث",
  TECH_PROGRAMMING: "التقنية والبرمجة",
  BUSINESS_LEADERSHIP: "الأعمال والقيادة",
  HELPING_OTHERS: "مساعدة الآخرين",
};

export type CareerQuizOption = { label: string; trait: CareerTrait };
export type CareerQuizQuestion = { id: string; prompt: string; options: CareerQuizOption[] };

export const CAREER_QUIZ_QUESTIONS: CareerQuizQuestion[] = [
  {
    id: "q1",
    prompt: "في وقت فراغك، ما الذي تفضل فعله أكثر؟",
    options: [
      { label: "حل ألغاز أو مسائل رياضية", trait: "MATH_LOGIC" },
      { label: "الرسم أو تصميم شيء جديد", trait: "CREATIVE_DESIGN" },
      { label: "قراءة عن اكتشافات علمية", trait: "SCIENCE_RESEARCH" },
      { label: "التحدث مع أصدقاء ومناقشة أفكار", trait: "COMMUNICATION" },
    ],
  },
  {
    id: "q2",
    prompt: "إذا كان لديك مشروع مدرسي جماعي، ما الدور الذي تفضله؟",
    options: [
      { label: "تنظيم الفريق وتوزيع المهام", trait: "BUSINESS_LEADERSHIP" },
      { label: "بناء أو تركيب الجزء العملي بيدي", trait: "HANDS_ON" },
      { label: "كتابة الكود أو الجزء التقني", trait: "TECH_PROGRAMMING" },
      { label: "مساعدة زملائي الذين يواجهون صعوبة", trait: "HELPING_OTHERS" },
    ],
  },
  {
    id: "q3",
    prompt: "أي مادة دراسية تستمتع بها أكثر؟",
    options: [
      { label: "الرياضيات", trait: "MATH_LOGIC" },
      { label: "الفيزياء أو الكيمياء أو الأحياء", trait: "SCIENCE_RESEARCH" },
      { label: "الحاسب الآلي", trait: "TECH_PROGRAMMING" },
      { label: "الفنون", trait: "CREATIVE_DESIGN" },
    ],
  },
  {
    id: "q4",
    prompt: "ما الذي يمنحك أكبر شعور بالإنجاز؟",
    options: [
      { label: "إقناع شخص برأي أو فكرة", trait: "COMMUNICATION" },
      { label: "إصلاح أو صنع شيء بيدي", trait: "HANDS_ON" },
      { label: "مساعدة شخص يمر بوقت صعب", trait: "HELPING_OTHERS" },
      { label: "قيادة مشروع إلى النجاح", trait: "BUSINESS_LEADERSHIP" },
    ],
  },
  {
    id: "q5",
    prompt: "لو خُيّرت بين هذه الأنشطة، أيها تختار؟",
    options: [
      { label: "برمجة تطبيق بسيط", trait: "TECH_PROGRAMMING" },
      { label: "تصميم شعار أو ملصق", trait: "CREATIVE_DESIGN" },
      { label: "إجراء تجربة علمية", trait: "SCIENCE_RESEARCH" },
      { label: "التطوع لمساعدة الآخرين", trait: "HELPING_OTHERS" },
    ],
  },
];

const QUESTION_IDS = new Set(CAREER_QUIZ_QUESTIONS.map((q) => q.id));

export type CareerQuizAnswers = Record<string, CareerTrait>;

function validateAnswers(answers: CareerQuizAnswers) {
  for (const [questionId, trait] of Object.entries(answers)) {
    if (!QUESTION_IDS.has(questionId)) {
      throw new Error(`سؤال غير معروف: ${questionId}`);
    }
    if (!(CAREER_TRAITS as readonly string[]).includes(trait)) {
      throw new Error(`إجابة غير صالحة للسؤال ${questionId}`);
    }
  }
  if (Object.keys(answers).length !== CAREER_QUIZ_QUESTIONS.length) {
    throw new Error("الرجاء الإجابة على كل الأسئلة");
  }
}

function scoreTraits(answers: CareerQuizAnswers): Record<CareerTrait, number> {
  const scores = Object.fromEntries(CAREER_TRAITS.map((t) => [t, 0])) as Record<
    CareerTrait,
    number
  >;
  for (const trait of Object.values(answers)) {
    scores[trait] += 1;
  }
  return scores;
}

/**
 * Ranks every CareerField by how many of its own declared traits overlap
 * with the student's answered traits (weighted by how often the student
 * picked that trait), and saves the raw answers + top matches as a
 * permanent CareerExplorationResult. A field with zero trait overlap is
 * never suggested — no fallback padding to a fixed count.
 */
export async function submitCareerExplorationQuiz(
  prisma: PrismaClient,
  params: { studentId: string; answers: CareerQuizAnswers },
) {
  validateAnswers(params.answers);
  const traitScores = scoreTraits(params.answers);

  const fields = await prisma.careerField.findMany();
  const ranked = fields
    .map((field) => ({
      field,
      score: field.traits.reduce((sum, trait) => sum + (traitScores[trait as CareerTrait] ?? 0), 0),
    }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  const result = await prisma.careerExplorationResult.create({
    data: {
      studentId: params.studentId,
      answers: params.answers,
      suggestedFieldIds: ranked.map((r) => r.field.id),
    },
  });

  return { result, suggestedFields: ranked.map((r) => r.field) };
}

export async function getCareerExplorationHistory(prisma: PrismaClient, studentId: string) {
  const results = await prisma.careerExplorationResult.findMany({
    where: { studentId },
    orderBy: { takenAt: "desc" },
  });

  const allFieldIds = Array.from(new Set(results.flatMap((r) => r.suggestedFieldIds)));
  const fields = await prisma.careerField.findMany({ where: { id: { in: allFieldIds } } });
  const fieldById = new Map(fields.map((f) => [f.id, f]));

  return results.map((result) => ({
    result,
    suggestedFields: result.suggestedFieldIds
      .map((id) => fieldById.get(id))
      .filter((f): f is NonNullable<typeof f> => Boolean(f)),
  }));
}

export async function listCareerFields(prisma: PrismaClient) {
  return prisma.careerField.findMany({ orderBy: { order: "asc" } });
}

/** An ordered list of steps, e.g. "تعلّم أساسيات البرمجة" → "ابنِ مشروعًا صغيرًا". */
export type CareerRoadmap = string[];
export type CareerResource = { title: string; url: string };

export type CareerFieldInput = {
  name: string;
  description: string;
  commonJobs: string[];
  requiredSkills: string[];
  traits: string[];
  roadmap: CareerRoadmap;
  resources: CareerResource[];
  portfolioAdvice: string | null;
  jobPrepAdvice: string | null;
};

/** One roadmap step per non-empty line. */
export function parseRoadmap(raw: string): CareerRoadmap {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * One resource per non-empty line, as `title | url`. Resources are rendered
 * to students as clickable links, so only real http(s) URLs are accepted —
 * a `javascript:` (or any other scheme) URL is rejected outright rather
 * than stored and later rendered into an `href`.
 */
export function parseResources(raw: string): CareerResource[] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const separator = line.lastIndexOf("|");
      if (separator === -1) {
        throw new Error(`صيغة المصدر غير صحيحة (المطلوب: العنوان | الرابط): ${line}`);
      }
      const title = line.slice(0, separator).trim();
      const url = line.slice(separator + 1).trim();
      if (!title || !isSafeHttpUrl(url)) {
        throw new Error(`رابط المصدر يجب أن يبدأ بـ http:// أو https://: ${line}`);
      }
      return { title, url };
    });
}

function isSafeHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** Defensive readers for the Json columns — never trust their stored shape blindly. */
export function readRoadmap(value: unknown): CareerRoadmap {
  return Array.isArray(value) ? value.filter((s): s is string => typeof s === "string") : [];
}

export function readResources(value: unknown): CareerResource[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (r): r is CareerResource =>
      typeof r === "object" &&
      r !== null &&
      typeof (r as CareerResource).title === "string" &&
      typeof (r as CareerResource).url === "string" &&
      isSafeHttpUrl((r as CareerResource).url),
  );
}

function validateCareerFieldInput(input: CareerFieldInput): CareerFieldInput {
  const name = input.name.trim();
  const description = input.description.trim();
  if (!name || !description) {
    throw new Error("الرجاء إدخال اسم المجال ووصفه");
  }
  return {
    ...input,
    name,
    description,
    traits: input.traits.filter((t) => (CAREER_TRAITS as readonly string[]).includes(t)),
    resources: input.resources.map((r) => {
      if (!isSafeHttpUrl(r.url)) throw new Error("رابط مصدر غير صالح");
      return r;
    }),
  };
}

function slugify(name: string) {
  return `${name.trim().toLowerCase().replace(/\s+/g, "-")}-${Date.now().toString(36)}`;
}

export async function createCareerField(prisma: PrismaClient, input: CareerFieldInput) {
  const data = validateCareerFieldInput(input);
  return prisma.careerField.create({
    data: { ...data, slug: slugify(data.name) },
  });
}

/**
 * Edits a field in place — same id, same slug. Previously the only way to
 * fix a typo was delete + recreate, which silently orphaned the old id
 * inside every past CareerExplorationResult.suggestedFieldIds (so a
 * student's earlier results would lose that suggestion from their history).
 */
export async function updateCareerField(
  prisma: PrismaClient,
  fieldId: string,
  input: CareerFieldInput,
) {
  const data = validateCareerFieldInput(input);
  return prisma.careerField.update({ where: { id: fieldId }, data });
}
