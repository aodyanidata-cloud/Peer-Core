import { Module } from '@nestjs/common';
import { TenancyModule } from '../tenancy/tenancy.module';
import { TenancyService } from '../tenancy/tenancy.service';
import { NotificationService } from './notification.service';
import { LoggingSmsProvider } from '../channels/logging-adapters';
import { WhatsAppProvider } from '../channels/whatsapp-provider';

/**
 * NotificationsModule
 * Event-driven user notifications across channels (R1.10). Opt-out aware, deduped.
 * Delivers through the channel adapter contracts (B7).
 */
@Module({
  imports: [TenancyModule],
  providers: [
    {
      provide: NotificationService,
      inject: [TenancyService],
      useFactory: (tenancy: TenancyService) =>
        new NotificationService(
          tenancy,
          new LoggingSmsProvider(),
          new WhatsAppProvider(),
        ),
    },
  ],
  exports: [NotificationService],
})
export class NotificationsModule {}
