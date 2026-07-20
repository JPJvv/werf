import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { WerfErrorFilter } from './common/werf-error.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  // Every route lives under /api. This is what makes dev and production the same shape:
  // in dev Vite proxies /api straight through to this port, in production the reverse
  // proxy serves the PWA at / and passes /api here — same origin either way, so the
  // client never needs a base URL and we never need a CORS policy.
  app.setGlobalPrefix('api');
  app.useGlobalFilters(new WerfErrorFilter());
  // Without this, the DbModule's shutdown hook never fires and pools leak on restart.
  app.enableShutdownHooks();
  const port = process.env.PORT ?? 3000;
  await app.listen(port);
}

void bootstrap();
