import { Module } from '@nestjs/common';
import { PAYMENT_PROVIDER, type PaymentProvider } from './payment-provider';
import { FakePaymentProvider } from './fake-payment-provider';
import { MoyasarPaymentProvider } from './moyasar-payment-provider';

/**
 * PaymentsModule
 * Selects the payment provider by config: the real Moyasar adapter when
 * MOYASAR_SECRET_KEY is set (⚠️ unverified until the Moyasar decision + live
 * credentials), otherwise the offline FakePaymentProvider. Everything else in
 * the codebase depends only on the PaymentProvider contract.
 */
@Module({
  providers: [
    {
      provide: PAYMENT_PROVIDER,
      useFactory: (): PaymentProvider => {
        const key = process.env.MOYASAR_SECRET_KEY;
        return key ? new MoyasarPaymentProvider(key) : new FakePaymentProvider();
      },
    },
  ],
  exports: [PAYMENT_PROVIDER],
})
export class PaymentsModule {}
