import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterAll,
} from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../../src/db/schema';
import { applyMigrations } from '../../src/db/migrate';
import { AuthService } from '../../src/modules/identity/auth.service';
import type { OtpSender } from '../../src/modules/identity/otp-sender';
import { AuthError } from '../../src/modules/identity/auth.types';

/**
 * AUTH & AUTHORIZATION SAFETY SUITE (🔴 B2). Real tests against Postgres.
 * Skips cleanly if DATABASE_URL is absent.
 */
const url = process.env.DATABASE_URL;
const d = url ? describe : describe.skip;

/** Captures issued OTP codes so tests can complete the flow. */
class CapturingOtpSender implements OtpSender {
  last = new Map<string, string>();
  async send(phone: string, code: string): Promise<void> {
    this.last.set(phone, code);
  }
}

d('auth & authorization', () => {
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;
  let sender: CapturingOtpSender;
  let auth: AuthService;
  let now: Date;

  const phone = '+966500000001';

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    db = drizzle(pool, { schema });
    await applyMigrations(pool);
  });

  beforeEach(async () => {
    await pool.query(
      'TRUNCATE sessions, otp_challenges, memberships, users RESTART IDENTITY CASCADE',
    );
    sender = new CapturingOtpSender();
    now = new Date('2026-07-03T12:00:00Z');
    auth = new AuthService(db, sender, () => now);
  });

  afterAll(async () => {
    await pool.end();
  });

  async function login(p = phone): Promise<string> {
    await auth.requestOtp(p);
    const code = sender.last.get(p)!;
    const { token } = await auth.verifyOtp(p, code);
    return token;
  }

  it('unauthenticated requests are rejected', async () => {
    await expect(auth.authenticate('not-a-real-token')).rejects.toMatchObject({
      code: 'unauthenticated',
    });
  });

  it('a session is issued only after a verified OTP; the token authenticates', async () => {
    const token = await login();
    const ctx = await auth.authenticate(token);
    expect(ctx.phone).toBe(phone);
    expect(ctx.memberships).toEqual([]);
  });

  it('an incorrect OTP code is rejected', async () => {
    await auth.requestOtp(phone);
    await expect(auth.verifyOtp(phone, '000000')).rejects.toMatchObject({
      code: 'invalid_otp',
    });
  });

  it('an expired OTP code is rejected', async () => {
    await auth.requestOtp(phone);
    const code = sender.last.get(phone)!;
    now = new Date(now.getTime() + 6 * 60 * 1000); // +6 min > 5 min TTL
    await expect(auth.verifyOtp(phone, code)).rejects.toMatchObject({
      code: 'invalid_otp',
    });
  });

  it('an OTP code is single-use (cannot be replayed)', async () => {
    await auth.requestOtp(phone);
    const code = sender.last.get(phone)!;
    await auth.verifyOtp(phone, code); // consumes it
    await expect(auth.verifyOtp(phone, code)).rejects.toBeInstanceOf(AuthError);
  });

  it('OTP locks after too many attempts', async () => {
    await auth.requestOtp(phone);
    for (let i = 0; i < 5; i++) {
      await expect(auth.verifyOtp(phone, '111111')).rejects.toMatchObject({
        code: 'invalid_otp',
      });
    }
    // 6th attempt — even the right code is locked out now.
    const code = sender.last.get(phone)!;
    await expect(auth.verifyOtp(phone, code)).rejects.toMatchObject({
      code: 'otp_locked',
    });
  });

  it('OTP codes and session tokens are stored hashed, never in plaintext', async () => {
    await auth.requestOtp(phone);
    const code = sender.last.get(phone)!;
    const { token } = await auth.verifyOtp(phone, code);

    const [ch] = await db.select().from(schema.otpChallenges);
    expect(ch.codeHash).not.toContain(code);
    const [s] = await db.select().from(schema.sessions);
    expect(s.tokenHash).not.toBe(token);
    expect(s.tokenHash).not.toContain(token);
  });

  it('a revoked session no longer authenticates', async () => {
    const token = await login();
    await auth.revokeSession(token);
    await expect(auth.authenticate(token)).rejects.toMatchObject({
      code: 'unauthenticated',
    });
  });

  it('privilege: a user cannot act in a tenant/role it has no membership for', async () => {
    const tenantA = randomUUID();
    const tenantB = randomUUID();
    await db.insert(schema.tenants).values([
      { id: tenantA, slug: 'a-' + tenantA.slice(0, 8), name: 'A' },
      { id: tenantB, slug: 'b-' + tenantB.slice(0, 8), name: 'B' },
    ]);

    const token = await login();
    const ctx = await auth.authenticate(token);
    // Grant staff on A only.
    await db.insert(schema.memberships).values({
      userId: ctx.userId,
      tenantId: tenantA,
      role: 'staff',
    });
    const ctx2 = await auth.authenticate(token);

    // Allowed: staff on A.
    expect(auth.authorizeTenant(ctx2, tenantA, ['owner', 'staff'])).toBe(tenantA);
    // Denied: no membership on B.
    expect(() => auth.authorizeTenant(ctx2, tenantB, ['owner', 'staff'])).toThrow(
      AuthError,
    );
    // Denied: has staff on A but owner is required.
    expect(() => auth.authorizeTenant(ctx2, tenantA, ['owner'])).toThrow(AuthError);
  });

  it('a bad phone number is rejected before any code is issued', async () => {
    await expect(auth.requestOtp('12345')).rejects.toMatchObject({
      code: 'invalid_phone',
    });
    const count = await db.select().from(schema.otpChallenges);
    expect(count).toHaveLength(0);
  });
});
