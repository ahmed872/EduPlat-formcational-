import bcrypt from "bcryptjs";

/**
 * One password policy for every path that sets a password (registration,
 * reset, change). The minimum is the length registration has always
 * required. The maximum is bcrypt's 72-byte input limit: bcrypt silently
 * ignores everything after it, so a longer password would give a false
 * sense of strength and must be refused instead of truncated.
 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_BYTES = 72;
const BCRYPT_ROUNDS = 12;

/** Returns an Arabic error message, or null when the password is acceptable. */
export function passwordPolicyError(password: string, context: { email?: string } = {}): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `كلمة المرور يجب ألا تقل عن ${PASSWORD_MIN_LENGTH} أحرف`;
  }
  if (Buffer.byteLength(password, "utf8") > PASSWORD_MAX_BYTES) {
    return "كلمة المرور طويلة جدًا (الحد الأقصى 72 بايت)";
  }
  if (password.trim().length === 0) {
    return "كلمة المرور لا يمكن أن تكون مسافات فقط";
  }
  if (context.email && password.trim().toLowerCase() === context.email.trim().toLowerCase()) {
    return "كلمة المرور لا يمكن أن تطابق البريد الإلكتروني";
  }
  return null;
}

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  return bcrypt.compare(password, passwordHash);
}
