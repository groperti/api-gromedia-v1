import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { Request, Response } from 'express';
import { TelegramService } from '../telegram/telegram.service';

/**
 * Catch-all filter that mirrors the default Nest behaviour but additionally
 * posts a structured Telegram alert for failures on the upload-shaped routes.
 *
 * It deliberately runs LAST in the filter chain (registered globally in
 * main.ts) so route-specific filters like MediaSaturatedFilter still own
 * shaping their own response. We let those filters write the response first,
 * then we just emit the alert from inside the catch.
 *
 * Alerts include the request id so the same failure can be cross-referenced
 * between this notification and the gromedia container logs.
 */
@Catch()
export class UploadErrorAlertFilter implements ExceptionFilter {
  private readonly logger = new Logger(UploadErrorAlertFilter.name);

  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    private readonly telegram: TelegramService,
  ) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request & { user?: any; requestId?: string }>();
    const res = ctx.getResponse<Response>();
    const { httpAdapter } = this.httpAdapterHost;

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const payload =
      exception instanceof HttpException
        ? exception.getResponse()
        : { statusCode: status, message: 'Internal server error' };

    // If a more specific filter (e.g. MediaSaturatedFilter) already wrote the
    // response, don't overwrite it. Otherwise, fall back to the default
    // shape used by Nest.
    if (!res.headersSent) {
      httpAdapter.reply(res, payload, status);
    }

    this.maybeAlert(req, status, exception, payload);
  }

  private maybeAlert(
    req: Request & { user?: any; requestId?: string },
    status: number,
    exception: unknown,
    payload: any,
  ): void {
    try {
      const url = (req.originalUrl || req.url || '').split('?')[0];
      // Only the routes where users actually feel pain. Library reads are
      // noisy and not worth a Telegram ping per 401.
      const isUploadRoute =
        /^\/media\/(upload|upload-jpg|convert)\b/.test(url);
      if (!isUploadRoute) return;

      // Pull useful context from the request without touching the file body.
      const reqId = req.requestId || (req.headers['x-request-id'] as string) || '-';
      const ip =
        (req.headers['cf-connecting-ip'] as string) ||
        (req.headers['x-forwarded-for'] as string) ||
        req.ip ||
        '-';
      const ua = (req.headers['user-agent'] as string) || '-';
      const userId =
        (req.body && req.body.userId) || (req as any).user?.userId || '-';
      const file = (req as any).file as
        | { originalname?: string; size?: number; mimetype?: string }
        | undefined;
      const fileInfo = file
        ? `${file.originalname || '?'} (${file.mimetype || '?'}, ${humanSize(file.size)})`
        : '-';

      const errMsg =
        exception instanceof Error
          ? exception.message
          : typeof payload === 'string'
            ? payload
            : (payload?.message ?? JSON.stringify(payload));
      const stack = exception instanceof Error ? exception.stack : undefined;

      const text = [
        `<b>🚨 gromedia upload error — ${status}</b>`,
        `<b>route:</b> ${escapeHtml(req.method)} ${escapeHtml(url)}`,
        `<b>reqId:</b> <code>${escapeHtml(reqId)}</code>`,
        `<b>userId:</b> <code>${escapeHtml(String(userId))}</code>`,
        `<b>file:</b> ${escapeHtml(fileInfo)}`,
        `<b>ip:</b> <code>${escapeHtml(ip)}</code>`,
        `<b>ua:</b> ${escapeHtml(truncate(ua, 240))}`,
        `<b>error:</b> <code>${escapeHtml(truncate(String(errMsg ?? ''), 600))}</code>`,
        stack ? `<pre>${escapeHtml(truncate(stack, 1200))}</pre>` : '',
      ]
        .filter(Boolean)
        .join('\n');

      this.telegram.alert(text);
    } catch (err) {
      // Alerting must never poison the response path.
      this.logger.warn(`alert path failed: ${(err as Error)?.message || err}`);
    }
  }
}

function humanSize(bytes?: number): string {
  if (!bytes || !Number.isFinite(bytes)) return '?';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
