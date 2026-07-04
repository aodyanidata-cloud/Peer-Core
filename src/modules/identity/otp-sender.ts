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
 * Default sender: no real SMS is wired, so for LOCAL DEV it prints the code to
 * the server console (that is how you sign in without an SMS provider). In
 * production it prints only that a code was issued — never the code — so a real
 * SMS adapter must be wired before going live.
 */
export class LoggingOtpSender implements OtpSender {
  async send(phone: string, code: string): Promise<void> {
    if (process.env.NODE_ENV === 'production') {
      console.log(`[otp] issued a code for ${phone} (no SMS provider wired)`);
    } else {
      console.log(`[otp] DEV ONLY — code for ${phone} is: ${code}`);
    }
  }
}
