import { Module } from '@nestjs/common';
import { PAYMENT_PROVIDER } from './payment-provider';
import { FakePaymentProvider } from './fake-payment-provider';

/**
 * PaymentsModule
 * The PaymentProvider contract + the offline FakePaymentProvider default. The
 * real Moyasar adapter registers here later, behind the same seam.
 */
@Module({
  providers: [{ provide: PAYMENT_PROVIDER, useClass: FakePaymentProvider }],
  exports: [PAYMENT_PROVIDER],
})
export class PaymentsModule {}
