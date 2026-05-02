import {
  Controller,
  Get,
  HttpCode,
  ServiceUnavailableException,
} from '@nestjs/common';
import { MediaProcessingGate } from '../media/services/media-processing-gate.service';

@Controller()
export class HealthController {
  constructor(private readonly gate: MediaProcessingGate) {}

  @Get('health')
  health() {
    const mem = process.memoryUsage();
    return {
      status: 'ok',
      uptime: Math.round(process.uptime()),
      rss_mb: Math.round(mem.rss / 1024 / 1024),
      heap_used_mb: Math.round(mem.heapUsed / 1024 / 1024),
      gate: this.gate.snapshot(),
      ts: new Date().toISOString(),
    };
  }

  /**
   * Readiness probe. Returns 503 when the encode queue is full so the LB
   * stops sending new traffic until this container drains.
   */
  @Get('readyz')
  @HttpCode(200)
  readyz() {
    const snapshot = this.gate.snapshot();
    if (this.gate.isSaturated()) {
      throw new ServiceUnavailableException({
        statusCode: 503,
        status: 'saturated',
        ...snapshot,
      });
    }
    return { status: 'ready', ...snapshot };
  }
}
