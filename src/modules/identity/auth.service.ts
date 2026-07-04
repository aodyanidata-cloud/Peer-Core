import { and, desc, eq, gt, gte, isNull, sql } from 'drizzle-orm';
import * as schema from '../../db/schema';
import type { Db } from '../tenancy/tenant-context';
import {
  generateOtpCode,
  generateSessionToken,
  hashSecret,
  hashToken,
  verifySecret,
} from './crypto';
import type { OtpSender } from './otp-sender';
import {
  AuthError,
  ROLES,
  type AuthContext,
  type Membership,
  type Role,
} from './auth.types';

const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutes
const OTP_MAX_ATTEMPTS = 5;
const OTP_REQUEST_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const OTP_MAX_REQUESTS = 3; // per phone per window
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const E164 = /^\+[1-9]\d{6,14}$/;

export interface VerifyResult {
  token: string;
  userId: string;
}

/**
 * AuthService — mobile-OTP identity, hashed sessions, and tenant/role
 * authorization (B2 🔴).
 *
 * Invariants:
 *  - OTP codes and session tokens are stored ONLY as hashes; never plaintext.
 *  - OTP codes expire, are single-use, and lock after too many attempts.
 *  - A session is issued only after a verified OTP.
 *  - Tenant/role authority comes solely from `memberships` in the database; a
 *    client cannot assert a role or tenant it does not hold.
 */
export class AuthService {
  constructor(
    private readonly db: Db,
    private readonly sender: OtpSender,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async requestOtp(phone: string): Promise<void> {
    if (!E164.test(phone)) {
      throw new AuthError('phone must be E.164', 'invalid_phone');
    }
    // Rate-limit code requests per phone (SMS-bomb / cost-abuse guard).
    // Count-then-insert is a TOCTOU race: concurrent requests could each read
    // count < max and all insert. A transaction-scoped advisory lock keyed on
    // the phone serializes requests for the SAME phone, so the check and insert
    // are atomic and the window cap actually holds under concurrency.
    const code = generateOtpCode();
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${phone}))`);
      const windowStart = new Date(this.now().getTime() - OTP_REQUEST_WINDOW_MS);
      const recent = await tx
        .select({ id: schema.otpChallenges.id })
        .from(schema.otpChallenges)
        .where(
          and(
            eq(schema.otpChallenges.phone, phone),
            gte(schema.otpChallenges.createdAt, windowStart),
          ),
        );
      if (recent.length >= OTP_MAX_REQUESTS) {
        throw new AuthError('too many code requests; try again later', 'otp_locked');
      }
      await tx.insert(schema.otpChallenges).values({
        phone,
        codeHash: hashSecret(code),
        expiresAt: new Date(this.now().getTime() + OTP_TTL_MS),
      });
    });
    // Send only after the challenge is durably committed.
    await this.sender.send(phone, code);
  }

  async verifyOtp(phone: string, code: string): Promise<VerifyResult> {
    // Serialize the challenge accounting per-phone so concurrent verifies can't
    // read the same `attempts` and each get a guess past the cap, and can't
    // both consume the same challenge (double-use). The transaction RETURNS a
    // decision rather than throwing, so the attempt increment commits even when
    // the code is wrong (brute-force stays bounded); the throw happens after.
    const outcome = await this.db.transaction(
      async (
        tx,
      ): Promise<'no_code' | 'locked' | 'bad_code' | 'ok'> => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${phone}))`);
        const [challenge] = await tx
          .select()
          .from(schema.otpChallenges)
          .where(
            and(
              eq(schema.otpChallenges.phone, phone),
              isNull(schema.otpChallenges.consumedAt),
            ),
          )
          .orderBy(desc(schema.otpChallenges.createdAt))
          .limit(1);

        if (!challenge || challenge.expiresAt.getTime() <= this.now().getTime()) {
          return 'no_code';
        }
        if (challenge.attempts >= OTP_MAX_ATTEMPTS) {
          return 'locked';
        }

        // Count this attempt before checking, so brute-force is bounded. This
        // update is committed regardless of whether the code is correct.
        await tx
          .update(schema.otpChallenges)
          .set({ attempts: challenge.attempts + 1 })
          .where(eq(schema.otpChallenges.id, challenge.id));

        if (!verifySecret(code, challenge.codeHash)) {
          return 'bad_code';
        }

        // Single-use: consume the challenge inside the locked transaction.
        await tx
          .update(schema.otpChallenges)
          .set({ consumedAt: this.now() })
          .where(eq(schema.otpChallenges.id, challenge.id));
        return 'ok';
      },
    );

    if (outcome === 'no_code') {
      throw new AuthError('no active code', 'invalid_otp');
    }
    if (outcome === 'locked') {
      throw new AuthError('too many attempts', 'otp_locked');
    }
    if (outcome === 'bad_code') {
      throw new AuthError('incorrect code', 'invalid_otp');
    }

    const [user] = await this.db
      .insert(schema.users)
      .values({ phone })
      .onConflictDoUpdate({ target: schema.users.phone, set: { phone } })
      .returning({ id: schema.users.id });

    const token = generateSessionToken();
    await this.db.insert(schema.sessions).values({
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(this.now().getTime() + SESSION_TTL_MS),
    });

    return { token, userId: user.id };
  }

  /** Resolve a bearer token to an authenticated identity, or reject. */
  async authenticate(token: string): Promise<AuthContext> {
    const [session] = await this.db
      .select()
      .from(schema.sessions)
      .where(
        and(
          eq(schema.sessions.tokenHash, hashToken(token)),
          isNull(schema.sessions.revokedAt),
          gt(schema.sessions.expiresAt, this.now()),
        ),
      )
      .limit(1);

    if (!session) {
      throw new AuthError('invalid or expired session', 'unauthenticated');
    }

    const [user] = await this.db
      .select({ id: schema.users.id, phone: schema.users.phone })
      .from(schema.users)
      .where(eq(schema.users.id, session.userId))
      .limit(1);

    if (!user) {
      throw new AuthError('invalid or expired session', 'unauthenticated');
    }

    const rows = await this.db
      .select({
        tenantId: schema.memberships.tenantId,
        role: schema.memberships.role,
      })
      .from(schema.memberships)
      .where(eq(schema.memberships.userId, user.id));

    const memberships: Membership[] = rows
      .filter((r): r is { tenantId: string; role: Role } =>
        (ROLES as readonly string[]).includes(r.role),
      )
      .map((r) => ({ tenantId: r.tenantId, role: r.role }));

    const [admin] = await this.db
      .select({ id: schema.platformAdmins.id })
      .from(schema.platformAdmins)
      .where(eq(schema.platformAdmins.userId, user.id))
      .limit(1);

    return {
      userId: user.id,
      phone: user.phone,
      memberships,
      isPlatformAdmin: Boolean(admin),
    };
  }

  /** Mark a user (by phone) a platform super-admin. Admin-plane; used by seeding/ops. */
  async grantPlatformAdmin(phone: string): Promise<void> {
    const [user] = await this.db
      .insert(schema.users)
      .values({ phone })
      .onConflictDoUpdate({ target: schema.users.phone, set: { phone } })
      .returning({ id: schema.users.id });
    await this.db
      .insert(schema.platformAdmins)
      .values({ userId: user.id })
      .onConflictDoNothing({ target: schema.platformAdmins.userId });
  }

  async revokeSession(token: string): Promise<void> {
    await this.db
      .update(schema.sessions)
      .set({ revokedAt: this.now() })
      .where(eq(schema.sessions.tokenHash, hashToken(token)));
  }

  /**
   * Authorize `ctx` to act in `tenantId` with one of `allowed` roles, returning
   * the tenant id for use as the (server-derived) RLS context. Throws if the
   * user has no matching membership. This is the ONLY sanctioned way to turn an
   * authenticated request into a tenant context — closing the loop with B1.
   */
  authorizeTenant(
    ctx: AuthContext,
    tenantId: string,
    allowed: readonly Role[],
  ): string {
    const membership = ctx.memberships.find(
      (m) => m.tenantId === tenantId && allowed.includes(m.role),
    );
    if (!membership) {
      throw new AuthError('not authorized for this tenant/role', 'forbidden');
    }
    return tenantId;
  }
}
