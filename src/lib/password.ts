import bcrypt from "bcryptjs";

const SALT_ROUNDS = 12;
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MINUTES = 15;

/**
 * Hash a password using bcrypt
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

/**
 * Verify a password against a hash
 */
export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Validate password strength
 * Returns null if valid, error message if invalid
 */
export function validatePassword(password: string): string | null {
  if (password.length < 8) {
    return "Password must be at least 8 characters long";
  }

  if (!/[A-Z]/.test(password)) {
    return "Password must contain at least one uppercase letter";
  }

  if (!/[a-z]/.test(password)) {
    return "Password must contain at least one lowercase letter";
  }

  if (!/[0-9]/.test(password)) {
    return "Password must contain at least one number";
  }

  return null;
}

/**
 * Generate a temporary password
 */
export function generateTempPassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let password = "";

  // Ensure at least one uppercase, lowercase, and number
  password += "ABCDEFGHJKLMNPQRSTUVWXYZ"[Math.floor(Math.random() * 24)];
  password += "abcdefghjkmnpqrstuvwxyz"[Math.floor(Math.random() * 23)];
  password += "23456789"[Math.floor(Math.random() * 8)];

  // Fill the rest
  for (let i = 0; i < 5; i++) {
    password += chars[Math.floor(Math.random() * chars.length)];
  }

  // Shuffle
  return password
    .split("")
    .sort(() => Math.random() - 0.5)
    .join("");
}

/**
 * Check if account should be locked
 */
export function isAccountLocked(
  loginAttempts: number,
  lockedUntil: Date | null
): { locked: boolean; message?: string } {
  // Check if currently locked
  if (lockedUntil && new Date(lockedUntil) > new Date()) {
    const minutesLeft = Math.ceil(
      (new Date(lockedUntil).getTime() - Date.now()) / 60000
    );
    return {
      locked: true,
      message: `Account is locked. Try again in ${minutesLeft} minute${minutesLeft !== 1 ? "s" : ""}.`,
    };
  }

  // Check if should be locked due to attempts
  if (loginAttempts >= MAX_LOGIN_ATTEMPTS) {
    return {
      locked: true,
      message: `Too many failed attempts. Account locked for ${LOCKOUT_DURATION_MINUTES} minutes.`,
    };
  }

  return { locked: false };
}

/**
 * Calculate lockout time
 */
export function getLockoutTime(): Date {
  return new Date(Date.now() + LOCKOUT_DURATION_MINUTES * 60 * 1000);
}

export { MAX_LOGIN_ATTEMPTS, LOCKOUT_DURATION_MINUTES };
