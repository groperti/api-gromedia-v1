import { Injectable, Logger } from '@nestjs/common';

/**
 * Fire-and-forget Telegram bot client used to surface user-facing failures
 * (upload drops, saturation 503s, unexpected exceptions) to a private chat
 * the team monitors. Two design constraints:
 *
 *   1) Never block the request lifecycle — alerting must not extend the
 *      response time of an already-failing upload, so every send is detached
 *      and its own errors are swallowed (logged, not thrown).
 *
 *   2) Fail-soft when not configured — missing env vars or a Telegram outage
 *      must not affect production traffic.
 */
@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);
  private readonly botToken: string;
  private readonly chatId: string;
  private readonly enabled: boolean;

  constructor() {
    this.botToken = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
    this.chatId = (process.env.TELEGRAM_CHAT_ID || '').trim();
    const flag = (process.env.TELEGRAM_ALERTS_ENABLED || '').toLowerCase();
    const explicitDisable = flag === '0' || flag === 'false' || flag === 'no';
    this.enabled = !!this.botToken && !!this.chatId && !explicitDisable;

    if (!this.enabled) {
      this.logger.warn(
        'Telegram alerts disabled (set TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, TELEGRAM_ALERTS_ENABLED to enable)',
      );
    } else {
      this.logger.log('Telegram alerts enabled');
    }
  }

  /** Detached send — never throws, never awaits the network call. */
  alert(text: string): void {
    if (!this.enabled) return;
    void this.send(text).catch((err) => {
      this.logger.warn(`telegram send failed: ${err?.message || err}`);
    });
  }

  private async send(text: string): Promise<void> {
    // Telegram caps a single message at 4096 chars. Truncate slightly under
    // that to leave headroom for the suffix marker.
    const MAX = 3900;
    const body =
      text.length <= MAX ? text : `${text.slice(0, MAX)}\n…(truncated)`;

    const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: this.chatId,
        text: body,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`telegram ${res.status}: ${errText.slice(0, 200)}`);
    }
  }
}
