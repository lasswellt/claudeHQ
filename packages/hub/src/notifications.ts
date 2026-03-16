import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { FastifyBaseLogger } from 'fastify';

export interface NotificationEvent {
  type: string;
  sessionId?: string;
  machineId?: string;
  data: Record<string, unknown>;
}

export class NotificationEngine {
  private readonly db: Database.Database;
  private readonly logger: FastifyBaseLogger;

  constructor(db: Database.Database, logger: FastifyBaseLogger) {
    this.db = db;
    this.logger = logger;
  }

  async dispatch(event: NotificationEvent): Promise<void> {
    const config = this.db
      .prepare("SELECT * FROM notification_config WHERE id = 'default'")
      .get() as Record<string, unknown> | undefined;

    if (!config || !(config.enabled as number)) return;

    let enabledEvents: string[] = [];
    try { enabledEvents = JSON.parse((config.events as string) || '[]') as string[]; } catch { return; }
    if (!enabledEvents.includes(event.type)) return;

    let webhooks: WebhookConfig[] = [];
    try { webhooks = config.webhooks ? (JSON.parse(config.webhooks as string) as WebhookConfig[]) : []; } catch { return; }

    for (const webhook of webhooks) {
      // Check if this webhook cares about this event type
      if (webhook.events && !webhook.events.includes(event.type)) continue;

      await this.sendWebhook(webhook, event);
    }

    // Store notification record
    this.db
      .prepare(
        'INSERT INTO notifications (id, session_id, type, channel, payload, sent_at, delivered) VALUES (?, ?, ?, ?, ?, unixepoch(), 1)',
      )
      .run(
        randomUUID(),
        event.sessionId ?? null,
        event.type,
        'webhook',
        JSON.stringify(event.data),
      );
  }

  private isAllowedWebhookUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase();

      // Block internal/private IPv4 hostnames and loopback
      const forbiddenHosts = ['localhost', '127.0.0.1', '0.0.0.0', '169.254.169.254'];
      if (forbiddenHosts.includes(host)) return false;

      // Block IPv6 loopback and private ranges (literal addresses in brackets)
      // Matches ::1, fc00::/7 (fc** / fd**), fe80::/10 (link-local)
      if (host === '::1' || host === '[::1]') return false;
      const ipv6Bare = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
      if (/^fe[89ab][0-9a-f]:/i.test(ipv6Bare)) return false; // fe80::/10 link-local
      if (/^f[cd][0-9a-f]{2}:/i.test(ipv6Bare)) return false; // fc00::/7 ULA

      // Block private IPv4 ranges
      if (parsed.hostname.startsWith('10.') || parsed.hostname.startsWith('192.168.') ||
          parsed.hostname.match(/^172\.(1[6-9]|2\d|3[01])\./)) return false;

      // Must be HTTPS — allow HTTP only for exact known webhook domains (not substring match)
      const isDiscord = host === 'discord.com' || host.endsWith('.discord.com');
      const isSlack = host === 'hooks.slack.com' || host.endsWith('.slack.com');
      if (parsed.protocol !== 'https:' && !isDiscord && !isSlack) {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  private async sendWebhook(webhook: WebhookConfig, event: NotificationEvent): Promise<void> {
    if (!this.isAllowedWebhookUrl(webhook.url)) {
      this.logger.warn({ url: webhook.url }, 'Webhook URL blocked — private/internal address');
      return;
    }

    const payload = this.formatPayload(webhook.format, event);

    try {
      const res = await fetch(webhook.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) {
        this.logger.warn(
          { url: webhook.url, status: res.status },
          'Webhook delivery failed',
        );
      }
    } catch (err) {
      this.logger.error({ url: webhook.url, err }, 'Webhook delivery error');
    }
  }

  private formatPayload(
    format: string | undefined,
    event: NotificationEvent,
  ): Record<string, unknown> {
    const basePayload = {
      event: event.type,
      timestamp: new Date().toISOString(),
      session_id: event.sessionId,
      machine_id: event.machineId,
      ...event.data,
    };

    switch (format) {
      case 'discord':
        return {
          embeds: [
            {
              title: `Claude HQ: ${event.type.replace(/_/g, ' ')}`,
              description: event.data.prompt
                ? `**Prompt:** ${event.data.prompt as string}`
                : undefined,
              color: event.type.includes('failed') ? 0xff0000 : 0x00ff00,
              fields: [
                { name: 'Machine', value: event.machineId ?? 'N/A', inline: true },
                {
                  name: 'Session',
                  value: event.sessionId?.slice(0, 8) ?? 'N/A',
                  inline: true,
                },
              ],
              timestamp: new Date().toISOString(),
            },
          ],
        };

      case 'slack':
        return {
          blocks: [
            {
              type: 'header',
              text: {
                type: 'plain_text',
                text: `Claude HQ: ${event.type.replace(/_/g, ' ')}`,
              },
            },
            {
              type: 'section',
              fields: [
                { type: 'mrkdwn', text: `*Machine:* ${event.machineId ?? 'N/A'}` },
                {
                  type: 'mrkdwn',
                  text: `*Session:* ${event.sessionId?.slice(0, 8) ?? 'N/A'}`,
                },
              ],
            },
          ],
        };

      default:
        return basePayload;
    }
  }
}

interface WebhookConfig {
  url: string;
  label?: string;
  events?: string[];
  format?: 'json' | 'discord' | 'slack';
}
