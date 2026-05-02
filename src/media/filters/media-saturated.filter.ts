import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import { Response } from 'express';
import { MediaSaturatedException } from '../services/media-processing-gate.service';

/**
 * Maps MediaSaturatedException to a 503 response with Retry-After and the
 * X-Inflight / X-Queue-Depth observability headers. Clients that honour
 * Retry-After (the upload helpers in web-groagen-v2, web-groadmin-v2,
 * app-groagen, app-groperti) will back off for the advertised duration and
 * retry transparently.
 */
@Catch(MediaSaturatedException)
export class MediaSaturatedFilter implements ExceptionFilter {
  catch(exception: MediaSaturatedException, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    res
      .setHeader('Retry-After', String(exception.retryAfter))
      .setHeader('X-Inflight', String(exception.inflight))
      .setHeader('X-Queue-Depth', String(exception.queued))
      .status(503)
      .json({
        statusCode: 503,
        error: 'Service Unavailable',
        message: 'Server media padat — coba lagi dalam beberapa detik.',
        retryAfter: exception.retryAfter,
        inflight: exception.inflight,
        queued: exception.queued,
      });
  }
}
