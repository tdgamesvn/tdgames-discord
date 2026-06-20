import { Client, TextChannel } from 'discord.js';

/**
 * ErrorReporter — sends structured error notifications to a dedicated Discord channel.
 *
 * Usage:
 *   const reporter = new ErrorReporter(client, config.discord.errorChannelId);
 *   await reporter.report(err, { source: 'imageHandler', userId: '123', prompt: '...' });
 *
 * If errorChannelId is null/undefined the reporter is a no-op (safe to call anywhere).
 */
export class ErrorReporter {
  private client: Client;
  private channelId: string | null;

  constructor(client: Client, channelId: string | null | undefined) {
    this.client = client;
    this.channelId = channelId ?? null;
  }

  /** Whether reporting is active (channelId configured). */
  get enabled(): boolean {
    return this.channelId !== null;
  }

  /**
   * Report an error to the error channel.
   * @param err   The error (Error object or any thrown value).
   * @param ctx   Optional key–value context (source, userId, channelId, prompt…).
   */
  async report(err: unknown, ctx?: Record<string, string>): Promise<void> {
    if (!this.channelId) return;

    try {
      const channel = await this.client.channels.fetch(this.channelId);
      if (!channel || !(channel instanceof TextChannel)) return;

      const errMsg = err instanceof Error ? err.message : String(err);
      const stack =
        err instanceof Error && err.stack
          ? `\n\`\`\`\n${err.stack.slice(0, 800)}\n\`\`\``
          : '';

      const ctxLines =
        ctx && Object.keys(ctx).length > 0
          ? Object.entries(ctx)
              .map(([k, v]) => `**${k}:** ${v}`)
              .join('\n')
          : '';

      const lines = [
        `🚨 **Bot Error**`,
        ctxLines,
        `**Message:** ${errMsg}`,
        stack,
        `<t:${Math.floor(Date.now() / 1000)}:R>`,
      ].filter(Boolean);

      const content = lines.join('\n').slice(0, 2000);
      await channel.send({ content });
    } catch {
      // Never let error reporting cause another error — swallow silently.
    }
  }
}
