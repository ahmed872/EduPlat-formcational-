import { prisma } from "@/lib/prisma";

/**
 * Central registry of configurable business rules. Every "default" mentioned
 * in the product spec (view limit, passing score, view-consumption
 * threshold, subscription expiry rule, ...) lives here instead of being
 * hardcoded, so the teacher/admin can change it without a code change.
 */
export const PLATFORM_SETTING_KEYS = {
  DEFAULT_VIDEO_VIEW_LIMIT: "default_video_view_limit",
  VIEW_CONSUMPTION_THRESHOLD_PERCENT: "view_consumption_threshold_percent",
  DEFAULT_PASSING_SCORE_PERCENT: "default_passing_score_percent",
  DEFAULT_QUIZ_MAX_ATTEMPTS: "default_quiz_max_attempts",
  ACADEMIC_YEAR_END: "academic_year_end", // ISO date string; subscriptions expire here by default
  DAILY_STREAK_MIN_ACTIVE_MINUTES: "daily_streak_min_active_minutes",
  SHORT_MAX_DURATION_SECONDS: "short_max_duration_seconds",
  REFERRAL_REWARD_DAYS: "referral_reward_days",
  LOGIN_RATE_LIMIT_MAX_ATTEMPTS: "login_rate_limit_max_attempts",
  LOGIN_RATE_LIMIT_WINDOW_MINUTES: "login_rate_limit_window_minutes",
} as const;

export type PlatformSettingKey =
  (typeof PLATFORM_SETTING_KEYS)[keyof typeof PLATFORM_SETTING_KEYS];

const DEFAULTS: Record<PlatformSettingKey, unknown> = {
  [PLATFORM_SETTING_KEYS.DEFAULT_VIDEO_VIEW_LIMIT]: 3,
  [PLATFORM_SETTING_KEYS.VIEW_CONSUMPTION_THRESHOLD_PERCENT]: 80,
  [PLATFORM_SETTING_KEYS.DEFAULT_PASSING_SCORE_PERCENT]: 60,
  [PLATFORM_SETTING_KEYS.DEFAULT_QUIZ_MAX_ATTEMPTS]: 3,
  [PLATFORM_SETTING_KEYS.ACADEMIC_YEAR_END]: `${new Date().getFullYear() + 1}-07-31`,
  [PLATFORM_SETTING_KEYS.DAILY_STREAK_MIN_ACTIVE_MINUTES]: 15,
  [PLATFORM_SETTING_KEYS.SHORT_MAX_DURATION_SECONDS]: 300,
  [PLATFORM_SETTING_KEYS.REFERRAL_REWARD_DAYS]: 7,
  [PLATFORM_SETTING_KEYS.LOGIN_RATE_LIMIT_MAX_ATTEMPTS]: 5,
  [PLATFORM_SETTING_KEYS.LOGIN_RATE_LIMIT_WINDOW_MINUTES]: 15,
};

export async function getPlatformSetting<T = unknown>(
  key: PlatformSettingKey,
): Promise<T> {
  const row = await prisma.platformSetting.findUnique({ where: { key } });
  if (!row) return DEFAULTS[key] as T;
  return row.value as T;
}

export async function setPlatformSetting(
  key: PlatformSettingKey,
  value: unknown,
): Promise<void> {
  await prisma.platformSetting.upsert({
    where: { key },
    create: { key, value: value as never },
    update: { value: value as never },
  });
}

export function getDefaultPlatformSetting<T = unknown>(
  key: PlatformSettingKey,
): T {
  return DEFAULTS[key] as T;
}
