import { and, eq } from 'drizzle-orm';
import * as schema from '../../db/schema';
import { TenancyService } from '../tenancy/tenancy.service';
import type { SmsProvider, MessagingProvider } from '../channels/contracts';

export interface NotifyInput {
  recipient: string;
  channel: 'sms' | 'whatsapp';
  event: string;
  body: string;
  dedupeKey?: string;
}

export type NotifyResult =
  | { status: 'sent'; id: string }
  | { status: 'deduped' }
  | { status: 'opted_out' };

/**
 * NotificationService — event-driven notifications (R1.10). Generic (no vertical
 * logic): respects opt-out, dedupes on a per-tenant key, delivers through the
 * channel adapter contracts (B7), and records every send. Tenant-scoped.
 */
export class NotificationService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly sms: SmsProvider,
    private readonly whatsapp: MessagingProvider,
  ) {}

  async notify(tenantId: string, input: NotifyInput): Promise<NotifyResult> {
    return this.tenancy.runAs(tenantId, async (tx) => {
      // Respect opt-out.
      const [optout] = await tx
        .select()
        .from(schema.notificationOptouts)
        .where(
          and(
            eq(schema.notificationOptouts.recipient, input.recipient),
            eq(schema.notificationOptouts.channel, input.channel),
          ),
        )
        .limit(1);
      if (optout) return { status: 'opted_out' };

      // Dedupe.
      if (input.dedupeKey) {
        const [existing] = await tx
          .select({ id: schema.notifications.id })
          .from(schema.notifications)
          .where(eq(schema.notifications.dedupeKey, input.dedupeKey))
          .limit(1);
        if (existing) return { status: 'deduped' };
      }

      // Deliver through the channel adapter, then record.
      if (input.channel === 'sms') {
        await this.sms.send({ to: input.recipient, body: input.body });
      } else {
        await this.whatsapp.send({
          to: input.recipient,
          body: input.body,
          channel: 'whatsapp',
        });
      }

      const [row] = await tx
        .insert(schema.notifications)
        .values({
          tenantId,
          recipient: input.recipient,
          channel: input.channel,
          event: input.event,
          body: input.body,
          dedupeKey: input.dedupeKey ?? null,
        })
        .returning({ id: schema.notifications.id });
      return { status: 'sent', id: row.id };
    });
  }

  optOut(tenantId: string, recipient: string, channel: string) {
    return this.tenancy.runAs(tenantId, async (tx) => {
      await tx
        .insert(schema.notificationOptouts)
        .values({ tenantId, recipient, channel })
        .onConflictDoNothing();
    });
  }
}
