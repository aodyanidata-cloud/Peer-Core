/** Tenant-scoped roles. A user with NO tenant membership is a plain end-user. */
export type Role = 'owner' | 'staff';
export const ROLES: readonly Role[] = ['owner', 'staff'];

export interface Membership {
  tenantId: string;
  role: Role;
}

/**
 * The resolved identity for an authenticated request. `memberships` is the ONLY
 * source of a user's tenant/role authority — it comes from the database, never
 * from a client-supplied header or body field.
 */
export interface AuthContext {
  userId: string;
  phone: string;
  memberships: Membership[];
  /** True when the user is a platform operator (super-admin), from platform_admins. */
  isPlatformAdmin: boolean;
}

export class AuthError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'unauthenticated'
      | 'forbidden'
      | 'invalid_otp'
      | 'otp_locked'
      | 'invalid_phone',
  ) {
    super(message);
    this.name = 'AuthError';
  }
}
