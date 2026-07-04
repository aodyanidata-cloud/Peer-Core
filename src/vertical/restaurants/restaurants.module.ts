import { Module } from '@nestjs/common';
import { TenancyModule } from '../../modules/tenancy/tenancy.module';
import { TenancyService } from '../../modules/tenancy/tenancy.service';
import { CatalogModule } from '../../modules/catalog/catalog.module';
import { AgentModule } from '../../modules/agent/agent.module';
import { PaymentsModule } from '../../modules/payments/payments.module';
import { PAYMENT_PROVIDER, type PaymentProvider } from '../../modules/payments/payment-provider';
import { NotificationsModule } from '../../modules/notifications/notifications.module';
import { NotificationService } from '../../modules/notifications/notification.service';
import { IdentityModule } from '../../modules/identity/identity.module';
import { RestaurantService } from './restaurant.service';
import { PromotionService } from './promotion.service';
import { LoyaltyService } from './loyalty.service';
import { ReviewService } from './review.service';
import { DriverDirectoryService } from './driver-directory.service';
import { StaffController } from './staff.controller';
import { MenuService } from './menu.service';
import { MenuSyncService } from './menu-sync.service';
import { DinerAgentService } from './diner-agent.service';
import { FaqService } from './faq.service';
import { ReservationService } from './reservation.service';
import { ComplaintService } from './complaint.service';
import { OnboardingService } from './onboarding.service';
import { OrderService } from './order.service';
import { CartService } from './cart.service';
import { DeliveryService } from './delivery.service';
import { TenantResolver } from './tenant-resolver';
import { DinerController } from './diner.controller';
import { AdminController } from './admin.controller';

/**
 * RestaurantsModule — the Restaurants vertical (R1 + R2). A plug-in on the
 * generic engine: it depends on the core modules' contracts (tenancy, catalog,
 * agent, payments) and adds restaurant-shaped behavior. The engine never
 * depends on this.
 */
@Module({
  imports: [
    TenancyModule,
    CatalogModule,
    AgentModule,
    PaymentsModule,
    NotificationsModule,
    IdentityModule,
  ],
  controllers: [DinerController, StaffController, AdminController],
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
      inject: [TenancyService, PAYMENT_PROVIDER, NotificationService],
      useFactory: (
        tenancy: TenancyService,
        payments: PaymentProvider,
        notifier: NotificationService,
      ) => new OrderService(tenancy, payments, notifier),
    },
    {
      provide: CartService,
      inject: [TenancyService, OrderService],
      useFactory: (tenancy: TenancyService, orders: OrderService) =>
        new CartService(tenancy, orders),
    },
    DeliveryService,
    PromotionService,
    LoyaltyService,
    ReviewService,
    DriverDirectoryService,
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
    CartService,
    DeliveryService,
    PromotionService,
    LoyaltyService,
    ReviewService,
    DriverDirectoryService,
  ],
})
export class RestaurantsModule {}
