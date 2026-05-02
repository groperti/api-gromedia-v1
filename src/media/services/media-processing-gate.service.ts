import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

/**
 * Layer 2 admission control. The encoding pipeline (sharp + ffmpeg) is the
 * scarce resource — once libuv is saturated, accepting more work just queues
 * inside Node until the proxy times out and the user sees "Network Error".
 *
 * MediaProcessingGate caps in-flight encodes to MEDIA_MAX_INFLIGHT and queues
 * up to MEDIA_MAX_QUEUED additional callers. Anything beyond is rejected with
 * a fast 503 + Retry-After so the client can back off and retry instead of
 * stalling.
 *
 * Contract:
 *   await gate.acquire();      // resolves when a slot is free; throws if full
 *   try { …slow work… }
 *   finally { gate.release(); }
 *
 * The gate is a pure-JS Promise queue. JS is single-threaded, so no mutex is
 * needed; FIFO ordering comes from the array shift().
 */

export interface GateSnapshot {
  inflight: number;
  queued: number;
  max_inflight: number;
  max_queued: number;
}

export class MediaSaturatedException extends ServiceUnavailableException {
  readonly retryAfter: number;
  readonly inflight: number;
  readonly queued: number;

  constructor(snapshot: { inflight: number; queued: number; retryAfter: number }) {
    super({
      statusCode: 503,
      error: 'Service Unavailable',
      message: 'Server media padat — coba lagi dalam beberapa detik.',
      retryAfter: snapshot.retryAfter,
      inflight: snapshot.inflight,
      queued: snapshot.queued,
    });
    this.retryAfter = snapshot.retryAfter;
    this.inflight = snapshot.inflight;
    this.queued = snapshot.queued;
  }
}

@Injectable()
export class MediaProcessingGate {
  private readonly logger = new Logger(MediaProcessingGate.name);
  private readonly maxInflight: number;
  private readonly maxQueued: number;
  private readonly retryAfterSec: number;
  private inflight = 0;
  private waiters: Array<() => void> = [];

  constructor() {
    this.maxInflight = Math.max(
      1,
      parseInt(process.env.MEDIA_MAX_INFLIGHT || '16', 10) || 16,
    );
    this.maxQueued = Math.max(
      0,
      parseInt(process.env.MEDIA_MAX_QUEUED || '32', 10) || 32,
    );
    this.retryAfterSec = Math.max(
      1,
      parseInt(process.env.MEDIA_RETRY_AFTER_SEC || '5', 10) || 5,
    );
    this.logger.log(
      `gate ready (max_inflight=${this.maxInflight}, max_queued=${this.maxQueued}, retry_after=${this.retryAfterSec}s)`,
    );
  }

  snapshot(): GateSnapshot {
    return {
      inflight: this.inflight,
      queued: this.waiters.length,
      max_inflight: this.maxInflight,
      max_queued: this.maxQueued,
    };
  }

  /** True when /readyz should return 503 so the LB stops sending new traffic. */
  isSaturated(): boolean {
    return this.waiters.length >= this.maxQueued;
  }

  async acquire(): Promise<void> {
    if (this.inflight < this.maxInflight) {
      this.inflight++;
      return;
    }
    if (this.waiters.length >= this.maxQueued) {
      this.logger.warn(
        `saturated — rejecting (inflight=${this.inflight}, queued=${this.waiters.length})`,
      );
      throw new MediaSaturatedException({
        inflight: this.inflight,
        queued: this.waiters.length,
        retryAfter: this.retryAfterSec,
      });
    }
    await new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
    // Slot was transferred to us by the previous holder's release(); inflight
    // count is unchanged.
  }

  release(): void {
    const next = this.waiters.shift();
    if (next) {
      // Hand the slot directly to the next waiter — keeps inflight stable.
      next();
    } else if (this.inflight > 0) {
      this.inflight--;
    }
  }
}
