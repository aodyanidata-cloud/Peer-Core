import { Module } from '@nestjs/common';
import { getDb } from '../../db';
import { AuthService } from './auth.service';
import { AuthGuard } from './auth.guard';
import { AdminGuard } from './admin.guard';
import { AuthController } from './auth.controller';
import { OTP_SENDER, LoggingOtpSender, type OtpSender } from './otp-sender';

/**
 * IdentityModule
 * User accounts, mobile-OTP identity, hashed sessions, tenant/role authority (B2 🔴).
 * Exposes the login surface (AuthController) and both guards. Generic; no vertical logic.
 */
@Module({
  controllers: [AuthController],
  providers: [
    { provide: OTP_SENDER, useClass: LoggingOtpSender },
    {
      provide: AuthService,
      inject: [OTP_SENDER],
      useFactory: (sender: OtpSender) => new AuthService(getDb(), sender),
    },
    AuthGuard,
    AdminGuard,
  ],
  exports: [AuthService, AuthGuard, AdminGuard],
})
export class IdentityModule {}
