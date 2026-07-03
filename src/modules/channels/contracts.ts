/**
 * Integration contracts (B7). The core depends only on these interfaces; each
 * vendor is one adapter, registered by name. Webhooks are normalized to internal
 * events and signature-verified inside the adapter, never in the core.
 */

export interface OutboundMessage {
  to: string; // E.164 phone or channel address
  body: string;
}

/** SMS delivery (Unifonic, Msegat, …). */
export interface SmsProvider {
  readonly name: string;
  send(msg: OutboundMessage): Promise<{ id: string }>;
}

/** Rich messaging channels (WhatsApp via Meta Cloud API / 360Dialog, …). */
export interface MessagingProvider {
  readonly name: string;
  send(msg: OutboundMessage & { channel?: string }): Promise<{ id: string }>;
}
