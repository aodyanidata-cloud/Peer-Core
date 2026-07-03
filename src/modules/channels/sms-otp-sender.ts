import type { OtpSender } from '../identity/otp-sender';
import type { SmsProvider } from './contracts';

/**
 * Adapts an SmsProvider to the identity module's OtpSender seam — showing the
 * contracts compose: auth (B2) depends on the OtpSender interface, and here an
 * SMS adapter satisfies it, with no coupling between the two modules' internals.
 */
export class SmsOtpSender implements OtpSender {
  constructor(private readonly sms: SmsProvider) {}
  async send(phone: string, code: string): Promise<void> {
    await this.sms.send({ to: phone, body: `Your code is ${code}` });
  }
}
