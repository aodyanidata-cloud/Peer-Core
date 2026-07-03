import { randomUUID } from 'node:crypto';
import type { MessagingProvider, OutboundMessage, SmsProvider } from './contracts';

/**
 * Offline default adapters. They record/no-op instead of calling a vendor, so the
 * system runs end-to-end without external credentials. Real adapters (Unifonic,
 * WhatsApp Cloud API, …) register under their own names and are selected by config.
 */

export class LoggingSmsProvider implements SmsProvider {
  readonly name = 'logging';
  readonly sent: OutboundMessage[] = [];
  async send(msg: OutboundMessage): Promise<{ id: string }> {
    this.sent.push(msg);
    return { id: randomUUID() };
  }
}

export class LoggingMessagingProvider implements MessagingProvider {
  readonly name = 'logging';
  readonly sent: (OutboundMessage & { channel?: string })[] = [];
  async send(
    msg: OutboundMessage & { channel?: string },
  ): Promise<{ id: string }> {
    this.sent.push(msg);
    return { id: randomUUID() };
  }
}
