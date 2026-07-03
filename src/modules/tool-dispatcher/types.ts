import type { AuthContext, Role } from '../identity/auth.types';
import type { Tx } from '../tenancy/tenant-context';

export interface ToolContext {
  ctx: AuthContext;
  tenantId: string;
  tx: Tx;
}

export type ToolArgs = Record<string, unknown>;

/**
 * A tool the model may PROPOSE. The model never executes it; the dispatcher
 * authorizes and runs it. `requiredRoles` and `requiresConfirmation` are the
 * authority the model cannot influence — they live on the server-side definition.
 */
export interface ToolDefinition {
  name: string;
  sideEffect: 'read' | 'write';
  requiredRoles?: readonly Role[];
  requiresConfirmation?: boolean;
  handler: (args: ToolArgs, tc: ToolContext) => Promise<unknown>;
}

export interface DispatchOptions {
  idempotencyKey?: string;
  confirmed?: boolean;
}

export class DispatchError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'unknown_tool'
      | 'forbidden'
      | 'confirmation_required',
  ) {
    super(message);
    this.name = 'DispatchError';
  }
}
