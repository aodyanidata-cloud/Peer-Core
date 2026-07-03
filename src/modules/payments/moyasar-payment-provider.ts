import {
  PaymentError,
  type AuthorizeRequest,
  type PaymentIntent,
  type PaymentProvider,
  type PaymentStatus,
} from './payment-provider';

/**
 * MoyasarPaymentProvider — the real KSA gateway adapter (Mada/Visa/MC/Apple Pay/
 * STC Pay), implementing the two-phase contract against Moyasar's API.
 *
 * ⚠️ STRUCTURAL / UNVERIFIED. This compiles and slots in behind the seam, but it
 * is NOT production-ready until the captain's Moyasar decision is made and it is
 * verified end-to-end with live credentials. Open items that decision resolves:
 *   - the exact authorize→capture window per method (Mada ~14d, Visa/MC ~30d);
 *   - manual-capture vs auto-capture and the exact void/refund endpoints;
 *   - recurring / tokenized billing support (needed for meal-plans, §6.9);
 *   - PCI SAQ level and where the card token is minted (client-side Moyasar form).
 * Until then the FakePaymentProvider is the default; this activates only when
 * MOYASAR_SECRET_KEY is set.
 *
 * Docs to confirm against before go-live: https://docs.moyasar.com
 */
const BASE = 'https://api.moyasar.com/v1';

function mapStatus(moyasarStatus: string): PaymentStatus {
  switch (moyasarStatus) {
    case 'authorized':
      return 'authorized';
    case 'paid':
    case 'captured':
      return 'captured';
    case 'voided':
      return 'voided';
    case 'refunded':
      return 'refunded';
    default:
      throw new PaymentError(`unexpected Moyasar status: ${moyasarStatus}`, 'declined');
  }
}

export class MoyasarPaymentProvider implements PaymentProvider {
  readonly name = 'moyasar';

  constructor(private readonly secretKey: string) {}

  private async call(
    path: string,
    body?: Record<string, unknown>,
  ): Promise<{ id: string; status: string; amount: number }> {
    const auth = Buffer.from(`${this.secretKey}:`).toString('base64');
    const res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) {
      throw new PaymentError(
        `Moyasar ${path} failed: ${res.status}`,
        res.status === 404 ? 'not_found' : 'declined',
      );
    }
    return (await res.json()) as { id: string; status: string; amount: number };
  }

  async authorize(req: AuthorizeRequest): Promise<PaymentIntent> {
    // manual:true holds funds (authorize) rather than capturing immediately.
    const p = await this.call('/payments', {
      amount: req.amountMinor,
      currency: req.currency,
      manual: true,
      source: req.source,
      metadata: { idempotency_key: req.idempotencyKey },
    });
    return { ref: p.id, status: mapStatus(p.status), amountMinor: p.amount };
  }

  async capture(ref: string): Promise<PaymentIntent> {
    const p = await this.call(`/payments/${ref}/capture`);
    return { ref: p.id, status: mapStatus(p.status), amountMinor: p.amount };
  }

  async void(ref: string): Promise<PaymentIntent> {
    const p = await this.call(`/payments/${ref}/void`);
    return { ref: p.id, status: mapStatus(p.status), amountMinor: p.amount };
  }

  async refund(ref: string): Promise<PaymentIntent> {
    const p = await this.call(`/payments/${ref}/refund`);
    return { ref: p.id, status: mapStatus(p.status), amountMinor: p.amount };
  }
}
