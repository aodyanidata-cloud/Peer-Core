import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { DomainExceptionFilter } from './common/domain-exception.filter';
import { loadDotEnv } from './load-env';

const API_PREFIX = 'api/v1';

export async function createApp(): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
    { logger: ['error', 'warn', 'log'] },
  );
  app.setGlobalPrefix(API_PREFIX);
  app.useGlobalFilters(new DomainExceptionFilter());
  return app;
}

async function bootstrap(): Promise<void> {
  loadDotEnv(); // pick up a local .env when run directly (not during tests)
  const app = await createApp();
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
  console.log(`peers-restaurants listening on :${port}/${API_PREFIX}`);
}

// Only auto-start when run directly (not when imported by tests).
if (require.main === module) {
  bootstrap().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
