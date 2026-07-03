import { Module } from '@nestjs/common';
import { getDb } from '../../db';
import { ToolRegistry } from './registry';
import { ToolDispatcher } from './tool-dispatcher.service';

/**
 * ToolDispatcherModule
 * Authorizes and executes tools the model proposes. Scoped, idempotent, audited.
 * The authority boundary (B4 🔴).
 */
@Module({
  providers: [
    ToolRegistry,
    {
      provide: ToolDispatcher,
      inject: [ToolRegistry],
      useFactory: (registry: ToolRegistry) =>
        new ToolDispatcher(registry, getDb()),
    },
  ],
  exports: [ToolDispatcher, ToolRegistry],
})
export class ToolDispatcherModule {}
