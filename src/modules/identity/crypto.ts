import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
} from 'node:crypto';

/**
 * Password-grade hashing for low-entropy secrets (OTP codes). Salted scrypt with
 * a constant-time compare. Format: "<saltHex>:<dkHex>".
 */
export function hashSecret(secret: string): string {
  const salt = randomBytes(16);
  const dk = scryptSync(secret, salt, 32);
  return `${salt.toString('hex')}:${dk.toString('hex')}`;
}

export function verifySecret(secret: string, stored: string): boolean {
  const [saltHex, dkHex] = stored.split(':');
  if (!saltHex || !dkHex) return false;
  const expected = Buffer.from(dkHex, 'hex');
  const actual = scryptSync(secret, Buffer.from(saltHex, 'hex'), expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** Cryptographically-random 6-digit OTP code. */
export function generateOtpCode(): string {
  const n = randomBytes(4).readUInt32BE(0) % 1_000_000;
  return n.toString().padStart(6, '0');
}

/** High-entropy (256-bit) opaque session token. */
export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * One-way hash for high-entropy tokens. sha256 is sufficient here (the token is
 * 256 random bits, not a guessable password), and it keeps session lookup a
 * simple indexed equality on the hash — the raw token is never stored.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
