import { Module } from '@nestjs/common';
import { InferenceGateway } from './inference-gateway.service';
import { EchoProvider } from './echo-provider';
import { INFERENCE_PROVIDER, type InferenceProvider } from './types';

/**
 * InferenceGatewayModule
 * Single seam for all LLM calls. Provider adapter behind a contract; nothing
 * calls a model SDK directly. EchoProvider is the offline default; a real
 * provider (vLLM / hosted API) replaces it by config in a later task.
 */
@Module({
  providers: [
    { provide: INFERENCE_PROVIDER, useClass: EchoProvider },
    {
      provide: InferenceGateway,
      inject: [INFERENCE_PROVIDER],
      useFactory: (provider: InferenceProvider) =>
        new InferenceGateway(provider),
    },
  ],
  exports: [InferenceGateway],
})
export class InferenceGatewayModule {}
