/**
 * OtpSender — the seam through which an OTP code reaches a phone. In production
 * this is backed by an SmsProvider adapter (contract → adapter → registry); the
 * auth core depends only on this interface, never on a vendor SDK.
 */
export interface OtpSender {
  send(phone: string, code: string): Promise<void>;
}

export const OTP_SENDER = Symbol('OTP_SENDER');

/**
 * Default sender: logs that a code was issued, never the code itself, and never
 * in production. Real delivery is wired via the SMS adapter in a later task.
 */
export class LoggingOtpSender implements OtpSender {
  async send(phone: string, _code: string): Promise<void> {
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[otp] issued a code for ${phone} (delivery not wired yet)`);
    }
  }
}
