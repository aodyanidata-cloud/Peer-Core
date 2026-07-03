import { describe, it } from 'vitest';

/**
 * AUTH & AUTHORIZATION SAFETY SUITE (🔴) — harness only at Stage A1.
 * Real assertions land with task B2 (Auth & roles).
 */
describe('auth & authorization', () => {
  it.todo('unauthenticated requests to protected routes are rejected');
  it.todo('a user cannot act outside their tenant or role scope');
  it.todo('OTP verification is required before a session is issued');
  it.todo('privilege escalation via forged claims is rejected');
});
