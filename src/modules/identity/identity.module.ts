import { Module } from '@nestjs/common';
import { getDb } from '../../db';
import { AuthService } from './auth.service';
import { AuthGuard } from './auth.guard';
import { OTP_SENDER, LoggingOtpSender, type OtpSender } from './otp-sender';

/**
 * IdentityModule
 * User accounts, mobile-OTP identity, hashed sessions, tenant/role authority (B2 🔴).
 * Generic; no vertical logic.
 */
@Module({
  providers: [
    { provide: OTP_SENDER, useClass: LoggingOtpSender },
    {
      provide: AuthService,
      inject: [OTP_SENDER],
      useFactory: (sender: OtpSender) => new AuthService(getDb(), sender),
    },
    AuthGuard,
  ],
  exports: [AuthService, AuthGuard],
})
export class IdentityModule {}
