import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import * as schema from '../../db/schema';
import { getDb } from '../../db';
import { ROLES, type AuthContext } from '../identity/auth.types';
import { withTenant, type Db } from '../tenancy/tenant-context';
import { ToolRegistry } from './registry';
import {
  DispatchError,
  type DispatchOptions,
  type ToolArgs,
  type ToolDefinition,
} from './types';

/**
 * ToolDispatcher — the authority boundary (B4 🔴).
 *
 * The model PROPOSES a tool name + args; the dispatcher is the ONLY thing that
 * authorizes and executes. Guarantees:
 *  - unknown tools never run;
 *  - authority (tenant + role) comes from the AuthContext's DB memberships, never
 *    from the model-supplied args — args are tool inputs, not permissions;
 *  - a tool marked requiresConfirmation runs only when explicitly confirmed;
 *  - every dispatch is idempotent (per tenant + key) and audited in a single
 *    tenant-scoped transaction (RLS applies), so effects happen at most once and
 *    a failure rolls back atomically.
 */
@Injectable()
export class ToolDispatcher {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly db: Db = getDb(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  private authorize(
    ctx: AuthContext,
    tenantId: string,
    tool: ToolDefinition,
  ): void {
    const allowed = tool.requiredRoles ?? ROLES;
    const ok = ctx.memberships.some(
      (m) => m.tenantId === tenantId && allowed.includes(m.role),
    );
    if (!ok) {
      throw new DispatchError(
        `not authorized to run ${tool.name} in this tenant`,
        'forbidden',
      );
    }
  }

  async dispatch(
    ctx: AuthContext,
    tenantId: string,
    toolName: string,
    args: ToolArgs = {},
    opts: DispatchOptions = {},
  ): Promise<unknown> {
    const tool = this.registry.get(toolName);
    if (!tool) {
      throw new DispatchError(`unknown tool: ${toolName}`, 'unknown_tool');
    }
    // Authorize BEFORE any execution; uses server-side memberships only.
    this.authorize(ctx, tenantId, tool);
    if (tool.requiresConfirmation && !opts.confirmed) {
      throw new DispatchError(
        `${tool.name} requires explicit confirmation`,
        'confirmation_required',
      );
    }

    return withTenant(this.db, tenantId, async (tx) => {
      if (opts.idempotencyKey) {
        const [existing] = await tx
          .select()
          .from(schema.toolInvocations)
          .where(
            and(
              eq(schema.toolInvocations.tenantId, tenantId),
              eq(schema.toolInvocations.idempotencyKey, opts.idempotencyKey),
            ),
          )
          .limit(1);
        if (existing?.status === 'completed') {
          return existing.result; // dedupe: no re-execution
        }
      }

      const [inv] = await tx
        .insert(schema.toolInvocations)
        .values({
          tenantId,
          tool: toolName,
          idempotencyKey: opts.idempotencyKey ?? null,
          actorUserId: ctx.userId,
          args,
          status: 'pending',
        })
        .returning({ id: schema.toolInvocations.id });

      // A throw here rolls back the whole transaction: the invocation row and any
      // handler effect vanish together (no partial state), and the idempotency
      // key is free to retry.
      const result = await tool.handler(args, { ctx, tenantId, tx });

      await tx
        .update(schema.toolInvocations)
        .set({
          status: 'completed',
          result: (result ?? null) as never,
          completedAt: this.now(),
        })
        .where(eq(schema.toolInvocations.id, inv.id));

      return result;
    });
  }
}
