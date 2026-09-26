import { Prisma, type PrismaClient } from "@prisma/client";

export async function getTeacherProfile(prisma: PrismaClient, userId: string) {
  const [profile, courses] = await Promise.all([
    prisma.teacherProfile.findUnique({
      where: { userId },
      include: { user: true },
    }),
    prisma.course.findMany({
      where: { teacherId: userId, status: "PUBLISHED" },
      include: { category: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  return { profile, courses };
}

export type SocialLink = { platform: string; url: string };
export type ContactInfo = { email: string | null; phone: string | null; whatsapp: string | null };
/** A place the teacher teaches in person, with its schedule (free text, e.g. "السبت 4م"). */
export type TeachingLocation = { name: string; address: string | null; schedule: string | null };

function isSafeHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Digits with an optional leading +, and spaces/dashes as separators — the
// value is rendered into a tel: link, so nothing else is let through.
const PHONE_PATTERN = /^\+?[0-9][0-9\s-]{5,19}$/;

function splitLines(raw: string) {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/** One link per non-empty line, as `المنصة | الرابط`. */
export function parseSocialLinks(raw: string): SocialLink[] {
  return splitLines(raw).map((line) => {
    const separator = line.lastIndexOf("|");
    if (separator === -1) {
      throw new Error(`صيغة الرابط غير صحيحة (المطلوب: المنصة | الرابط): ${line}`);
    }
    return { platform: line.slice(0, separator).trim(), url: line.slice(separator + 1).trim() };
  });
}

/** One location per non-empty line, as `اسم المكان | العنوان | المواعيد` (the last two optional). */
export function parseLocations(raw: string): TeachingLocation[] {
  return splitLines(raw).map((line) => {
    const [name, address, schedule] = line.split("|").map((part) => part.trim());
    return { name: name ?? "", address: address || null, schedule: schedule || null };
  });
}

function validateSocialLinks(links: SocialLink[]): SocialLink[] {
  return links.map((link) => {
    // Rendered publicly as clickable links — a javascript:/data: URL must
    // never be stored, let alone rendered into an href.
    if (!link.platform || !isSafeHttpUrl(link.url)) {
      throw new Error(`رابط التواصل يجب أن يبدأ بـ http:// أو https://: ${link.url}`);
    }
    return link;
  });
}

function validateContactInfo(info: ContactInfo): ContactInfo | null {
  const email = info.email?.trim() || null;
  const phone = info.phone?.trim() || null;
  const whatsapp = info.whatsapp?.trim() || null;
  if (email && !EMAIL_PATTERN.test(email)) throw new Error("البريد الإلكتروني غير صالح");
  if (phone && !PHONE_PATTERN.test(phone)) throw new Error("رقم الهاتف غير صالح");
  if (whatsapp && !PHONE_PATTERN.test(whatsapp)) throw new Error("رقم واتساب غير صالح");
  return email || phone || whatsapp ? { email, phone, whatsapp } : null;
}

function validateLocations(locations: TeachingLocation[]): TeachingLocation[] {
  return locations.map((location) => {
    if (!location.name) throw new Error("اسم مكان التدريس مطلوب");
    return location;
  });
}

/** Defensive readers for the Json columns — never trust their stored shape blindly. */
export function readSocialLinks(value: unknown): SocialLink[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (l): l is SocialLink =>
      typeof l === "object" &&
      l !== null &&
      typeof (l as SocialLink).platform === "string" &&
      typeof (l as SocialLink).url === "string" &&
      isSafeHttpUrl((l as SocialLink).url),
  );
}

export function readContactInfo(value: unknown): ContactInfo | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const pick = (key: string, pattern: RegExp) =>
    typeof raw[key] === "string" && pattern.test(raw[key] as string) ? (raw[key] as string) : null;
  const info = {
    email: pick("email", EMAIL_PATTERN),
    phone: pick("phone", PHONE_PATTERN),
    whatsapp: pick("whatsapp", PHONE_PATTERN),
  };
  return info.email || info.phone || info.whatsapp ? info : null;
}

export function readLocations(value: unknown): TeachingLocation[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (l): l is TeachingLocation =>
        typeof l === "object" && l !== null && typeof (l as TeachingLocation).name === "string",
    )
    .map((l) => ({
      name: l.name,
      address: typeof l.address === "string" ? l.address : null,
      schedule: typeof l.schedule === "string" ? l.schedule : null,
    }));
}

/** Empty lists / empty contact info are stored as SQL NULL, not as `[]`/`{}`. */
function jsonOrNull<T>(value: T | null | undefined, isEmpty: (v: T) => boolean) {
  return value == null || isEmpty(value) ? Prisma.DbNull : (value as Prisma.InputJsonValue);
}

export async function updateTeacherProfile(
  prisma: PrismaClient,
  params: {
    userId: string;
    bio?: string | null;
    photoUrl?: string | null;
    education?: string | null;
    experience?: string | null;
    philosophy?: string | null;
    socialLinks?: SocialLink[] | null;
    contactInfo?: ContactInfo | null;
    locations?: TeachingLocation[] | null;
  },
) {
  const socialLinks = params.socialLinks ? validateSocialLinks(params.socialLinks) : null;
  const contactInfo = params.contactInfo ? validateContactInfo(params.contactInfo) : null;
  const locations = params.locations ? validateLocations(params.locations) : null;
  // Rendered as <img src> on the public profile: http(s) only, like the
  // social links (a javascript:/data: value was stored as-is before).
  if (params.photoUrl && !isSafeHttpUrl(params.photoUrl)) {
    throw new Error("رابط الصورة يجب أن يبدأ بـ http:// أو https://");
  }

  const data = {
    bio: params.bio ?? null,
    photoUrl: params.photoUrl ?? null,
    education: params.education ?? null,
    experience: params.experience ?? null,
    philosophy: params.philosophy ?? null,
    socialLinks: jsonOrNull(socialLinks, (v) => v.length === 0),
    contactInfo: jsonOrNull(contactInfo, () => false),
    locations: jsonOrNull(locations, (v) => v.length === 0),
  };

  return prisma.teacherProfile.upsert({
    where: { userId: params.userId },
    create: { userId: params.userId, ...data },
    update: data,
  });
}
