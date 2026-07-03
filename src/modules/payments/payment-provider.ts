/**
 * PaymentProvider — the two-phase money contract (R2). Authorize holds funds
 * (free, voidable); capture takes them at commitment; void releases a hold;
 * refund returns captured funds. The core depends only on this interface — the
 * real Moyasar adapter (Mada/Visa/MC/Apple Pay/STC Pay) implements it later,
 * behind the same seam, gated on the payment-provider decision.
 */
export type PaymentStatus = 'authorized' | 'captured' | 'voided' | 'refunded';

export interface AuthorizeRequest {
  amountMinor: number;
  currency: string;
  idempotencyKey: string;
}

export interface PaymentIntent {
  ref: string;
  status: PaymentStatus;
  amountMinor: number;
}

export class PaymentError extends Error {
  constructor(
    message: string,
    readonly code: 'declined' | 'not_found' | 'illegal_transition',
  ) {
    super(message);
    this.name = 'PaymentError';
  }
}

export interface PaymentProvider {
  readonly name: string;
  authorize(req: AuthorizeRequest): Promise<PaymentIntent>;
  capture(ref: string): Promise<PaymentIntent>;
  void(ref: string): Promise<PaymentIntent>;
  refund(ref: string): Promise<PaymentIntent>;
}

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');
