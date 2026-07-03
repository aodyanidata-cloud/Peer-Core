import { randomUUID } from 'node:crypto';
import type { MessagingProvider, OutboundMessage } from './contracts';

/**
 * WhatsAppProvider (R1.11) — the WhatsApp channel adapter. Offline stub for now:
 * it records outbound messages. A real adapter (Meta Cloud API / 360Dialog)
 * registers under the same 'whatsapp' name and is selected by config; nothing
 * else in the codebase changes because everything goes through the contract.
 */
export class WhatsAppProvider implements MessagingProvider {
  readonly name = 'whatsapp';
  readonly sent: (OutboundMessage & { channel?: string })[] = [];

  async send(
    msg: OutboundMessage & { channel?: string },
  ): Promise<{ id: string }> {
    this.sent.push({ ...msg, channel: msg.channel ?? 'whatsapp' });
    return { id: `wamid.${randomUUID()}` };
  }
}
