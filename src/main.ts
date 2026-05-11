import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { AppModule } from './app.module';
import { TelegramService } from './common/telegram/telegram.service';
import { UploadErrorAlertFilter } from './common/filters/upload-error-alert.filter';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Trust the Cloudflare proxy in front of us so req.ip / X-Forwarded-For
  // resolve to the real mobile client, not the CF edge IP. Required for
  // sane log correlation when debugging upload drops.
  app.set('trust proxy', true);

  // Per-request id surfaces in logs and is echoed back to the browser, so
  // when a user reports "upload failed" we can grep for the same id in the
  // server logs even if Cloudflare ate the response on the wire.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const incoming = req.headers['x-request-id'];
    const reqId = (typeof incoming === 'string' && incoming) || randomUUID();
    res.setHeader('x-request-id', reqId);
    (req as any).requestId = reqId;
    next();
  });

  app.enableCors({
    // Regex covers https://groperti.com plus every subdomain and `www.`
    // variant (e.g. https://www.agen.groperti.com). The previous string-only
    // allowlist silently rejected the `www.` host: NestJS's CORS middleware
    // returned 204 with no Access-Control-Allow-Origin header, which the
    // browser surfaces to axios as ERR_NETWORK — the exact failure mode in
    // the production upload alerts (e.g. 2026-05-11 anisamuhaimin07@gmail.com
    // hitting POST from https://www.agen.groperti.com).
    origin: [
      'http://localhost:3000',
      'http://localhost:3001',
      'http://localhost:3002',
      'http://localhost:3003',
      'http://localhost:3004',
      'http://localhost:9010',
      'http://localhost:9030',
      'http://localhost:9040',
      /^https:\/\/([a-z0-9-]+\.)*groperti\.com$/,
    ],
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'x-api-key',
      'x-token',
      'x-request-id',
    ],
    exposedHeaders: ['x-request-id', 'retry-after', 'x-inflight', 'x-queue-depth'],
    // Cache the OPTIONS preflight for 24h. Without this, every upload from
    // a different origin pays a fresh OPTIONS roundtrip through Cloudflare,
    // which doubles the failure surface on flaky cellular.
    maxAge: 86_400,
    credentials: false,
  });

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true }),
  );

  // Catch-all alert filter — runs after route-specific filters
  // (e.g. MediaSaturatedFilter) so it never overwrites their response, but
  // mirrors every upload failure to Telegram for triage.
  const httpAdapterHost = app.get(HttpAdapterHost);
  const telegram = app.get(TelegramService);
  app.useGlobalFilters(new UploadErrorAlertFilter(httpAdapterHost, telegram));

  const port = Number(process.env.PORT || 4881);
  const server = await app.listen(port);

  // Cloudflare's free-tier proxy keeps idle origin connections alive for
  // ~100s. Node's defaults (5s keepAlive / 60s headers) can drop a socket
  // mid-handshake from the proxy's perspective, surfacing to clients as
  // "connection reset" with no response body. Tune above CF's window so the
  // origin always closes last.
  server.keepAliveTimeout = 120_000;
  server.headersTimeout = 125_000;
  // Disable per-request timeout — uploads of 20MB on slow cellular routinely
  // run past the 2-minute Node default. Admission control (MediaProcessingGate)
  // and multer's fileSize limit already bound resource usage.
  server.requestTimeout = 0;

  logger.log(`api-gromedia running on port ${port} (keepAlive=${server.keepAliveTimeout}ms)`);
}

bootstrap();
