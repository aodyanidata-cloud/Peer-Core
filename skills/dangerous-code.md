# Skill: dangerous-code

**Trigger:** any change touching money, tenant isolation, auth, a state machine, payment
webhooks, KYC, refunds/payouts, or pricing/amount computation. If unsure, treat it as dangerous.

**Protocol (do not shortcut):**
1. **Tiny scope.** One dangerous behavior at a time.
2. **Adversarial tests first.** Write the failing tests that try to break it — cross-tenant read,
   double-charge, illegal transition, forged tenant_id, negative amount — before the implementation.
   A human reviews the test assertions.
3. **Implement** to pass them.
4. **Structural invariant.** Prefer a DB constraint / RLS policy / type that makes the bad state
   unrepresentable over a runtime check.
5. **CI gate.** The matching `test/safety/` suite and `npm run fitness` must be green.
6. **Human review of the diff.** 🔴 never merges on an agent's own approval.

**Ten non-negotiables:** tenant_id server-derived only · RLS ENABLEd+FORCEd · money moves only on
the escrow/payment rail · payment success set only by verified webhook · idempotency key on every
money/state POST · only legal state transitions · amounts computed server-side in integer minor
units · the model never authorizes an action · secrets never in code · fail closed, never open.
