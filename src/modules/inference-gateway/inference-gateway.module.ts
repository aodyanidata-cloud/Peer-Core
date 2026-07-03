import { Module } from '@nestjs/common';

/**
 * InferenceGatewayModule
 * Single seam for all LLM calls. Provider adapter behind a contract; nothing calls a model SDK directly.
 * Scaffold only (Stage A1) — no business logic yet.
 */
@Module({})
export class InferenceGatewayModule {}
