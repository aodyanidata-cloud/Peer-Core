import { randomUUID } from 'node:crypto';
import {
  PaymentError,
  type AuthorizeRequest,
  type PaymentIntent,
  type PaymentProvider,
} from './payment-provider';

/**
 * FakePaymentProvider — deterministic, offline two-phase provider for building
 * and testing the money loop without a live PSP. Idempotent on the authorize
 * key; enforces the same legal transitions a real gateway would. `failNext`
 * lets a test simulate a declined authorization.
 */
export class FakePaymentProvider implements PaymentProvider {
  readonly name = 'fake';
  private readonly intents = new Map<string, PaymentIntent>();
  private readonly byKey = new Map<string, string>();
  failNext = false;

  async authorize(req: AuthorizeRequest): Promise<PaymentIntent> {
    if (this.failNext) {
      this.failNext = false;
      throw new PaymentError('card declined', 'declined');
    }
    const existingRef = this.byKey.get(req.idempotencyKey);
    if (existingRef) return this.intents.get(existingRef)!; // idempotent
    if (req.amountMinor <= 0) {
      throw new PaymentError('amount must be positive', 'declined');
    }
    const ref = `auth_${randomUUID()}`;
    const intent: PaymentIntent = {
      ref,
      status: 'authorized',
      amountMinor: req.amountMinor,
    };
    this.intents.set(ref, intent);
    this.byKey.set(req.idempotencyKey, ref);
    return intent;
  }

  private get(ref: string): PaymentIntent {
    const intent = this.intents.get(ref);
    if (!intent) throw new PaymentError('unknown payment', 'not_found');
    return intent;
  }

  async capture(ref: string): Promise<PaymentIntent> {
    const intent = this.get(ref);
    if (intent.status !== 'authorized') {
      throw new PaymentError(`cannot capture a ${intent.status} payment`, 'illegal_transition');
    }
    intent.status = 'captured';
    return intent;
  }

  async void(ref: string): Promise<PaymentIntent> {
    const intent = this.get(ref);
    if (intent.status !== 'authorized') {
      throw new PaymentError(`cannot void a ${intent.status} payment`, 'illegal_transition');
    }
    intent.status = 'voided';
    return intent;
  }

  async refund(ref: string): Promise<PaymentIntent> {
    const intent = this.get(ref);
    if (intent.status !== 'captured') {
      throw new PaymentError(`cannot refund a ${intent.status} payment`, 'illegal_transition');
    }
    intent.status = 'refunded';
    return intent;
  }
}
