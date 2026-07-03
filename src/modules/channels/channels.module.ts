import { Module } from '@nestjs/common';
import { AdapterRegistry } from '../../integrations/registry';
import { LoggingSmsProvider, LoggingMessagingProvider } from './logging-adapters';
import type { SmsProvider, MessagingProvider } from './contracts';
import type { PosProvider } from './pos-provider';

export const SMS_REGISTRY = Symbol('SMS_REGISTRY');
export const MESSAGING_REGISTRY = Symbol('MESSAGING_REGISTRY');
export const POS_REGISTRY = Symbol('POS_REGISTRY');

/**
 * ChannelsModule
 * Integration contracts + adapter registries (B7): SMS, messaging (WhatsApp),
 * and the POS contract (Foodics, R3). Offline logging adapters are the defaults;
 * real adapters register by name and are selected by config.
 */
@Module({
  providers: [
    {
      provide: SMS_REGISTRY,
      useFactory: () =>
        new AdapterRegistry<SmsProvider>().register(
          'logging',
          new LoggingSmsProvider(),
        ),
    },
    {
      provide: MESSAGING_REGISTRY,
      useFactory: () =>
        new AdapterRegistry<MessagingProvider>().register(
          'logging',
          new LoggingMessagingProvider(),
        ),
    },
    {
      // No POS adapter is wired yet; the registry exists so R3 Foodics slots in.
      provide: POS_REGISTRY,
      useFactory: () => new AdapterRegistry<PosProvider>(),
    },
  ],
  exports: [SMS_REGISTRY, MESSAGING_REGISTRY, POS_REGISTRY],
})
export class ChannelsModule {}
