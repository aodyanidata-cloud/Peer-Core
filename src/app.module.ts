import { Module } from '@nestjs/common';
import { HealthModule } from './health/health.module';

// Engine-core modules — scaffold only (Stage A1). Wired in as their tasks land
// (Stage B / Stage C-R1). Kept imported so the module boundaries are real from
// day one and the dependency graph is visible.
import { IdentityModule } from './modules/identity/identity.module';
import { TenancyModule } from './modules/tenancy/tenancy.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { AgentModule } from './modules/agent/agent.module';
import { InferenceGatewayModule } from './modules/inference-gateway/inference-gateway.module';
import { ToolDispatcherModule } from './modules/tool-dispatcher/tool-dispatcher.module';
import { ChannelsModule } from './modules/channels/channels.module';
import { NotificationsModule } from './modules/notifications/notifications.module';

// Vertical plug-in (depends on the engine; the engine never depends on it).
import { RestaurantsModule } from './vertical/restaurants/restaurants.module';

@Module({
  imports: [
    HealthModule,
    IdentityModule,
    TenancyModule,
    CatalogModule,
    AgentModule,
    InferenceGatewayModule,
    ToolDispatcherModule,
    ChannelsModule,
    NotificationsModule,
    RestaurantsModule,
  ],
})
export class AppModule {}
