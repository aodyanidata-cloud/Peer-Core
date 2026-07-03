import { Module } from '@nestjs/common';
import { TenancyModule } from '../../modules/tenancy/tenancy.module';
import { TenancyService } from '../../modules/tenancy/tenancy.service';
import { CatalogModule } from '../../modules/catalog/catalog.module';
import { AgentModule } from '../../modules/agent/agent.module';
import { PaymentsModule } from '../../modules/payments/payments.module';
import { PAYMENT_PROVIDER, type PaymentProvider } from '../../modules/payments/payment-provider';
import { RestaurantService } from './restaurant.service';
import { MenuService } from './menu.service';
import { MenuSyncService } from './menu-sync.service';
import { DinerAgentService } from './diner-agent.service';
import { FaqService } from './faq.service';
import { ReservationService } from './reservation.service';
import { ComplaintService } from './complaint.service';
import { OnboardingService } from './onboarding.service';
import { OrderService } from './order.service';
import { TenantResolver } from './tenant-resolver';
import { DinerController } from './diner.controller';

/**
 * RestaurantsModule — the Restaurants vertical (R1 + R2). A plug-in on the
 * generic engine: it depends on the core modules' contracts (tenancy, catalog,
 * agent, payments) and adds restaurant-shaped behavior. The engine never
 * depends on this.
 */
@Module({
  imports: [TenancyModule, CatalogModule, AgentModule, PaymentsModule],
  controllers: [DinerController],
  providers: [
    RestaurantService,
    MenuService,
    MenuSyncService,
    DinerAgentService,
    FaqService,
    ReservationService,
    ComplaintService,
    OnboardingService,
    TenantResolver,
    {
      provide: OrderService,
      inject: [TenancyService, PAYMENT_PROVIDER],
      useFactory: (tenancy: TenancyService, payments: PaymentProvider) =>
        new OrderService(tenancy, payments),
    },
  ],
  exports: [
    RestaurantService,
    MenuService,
    MenuSyncService,
    DinerAgentService,
    FaqService,
    ReservationService,
    ComplaintService,
    OnboardingService,
    OrderService,
  ],
})
export class RestaurantsModule {}
