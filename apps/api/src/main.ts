import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { WerfErrorFilter } from './common/werf-error.filter';

// Local development has a reproducible, git-ignored root environment created by
// `pnpm setup:local`. Load it here rather than asking every shell that starts apps/api to retain
// six secrets forever. Node does not overwrite variables already supplied by the caller, and a
// production process explicitly ignores this convenience file.
const localEnvPath = resolve(__dirname, '../../../.env');
if (process.env['NODE_ENV'] !== 'production' && existsSync(localEnvPath)) {
  process.loadEnvFile(localEnvPath);
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  // API responses still receive a fail-safe header baseline. The PWA document is served by the
  // edge/static layer, whose equivalent policy lives in apps/web/public/_headers; both layers are
  // required because Helmet cannot protect HTML it never serves.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
      ...(process.env['NODE_ENV'] === 'production' ? {} : { hsts: false }),
    }),
  );
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
