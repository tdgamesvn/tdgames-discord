import type Database from 'better-sqlite3';
import type { Message, TextBasedChannel } from 'discord.js';
import { ChatStorageStore } from './store';

type FetchableChannel = TextBasedChannel & {
  id: string;
  guildId?: string | null;
  name?: string;
  messages: {
    fetch: (options: { limit: number; before?: string }) => Promise<{
      size: number;
      values: () => IterableIterator<Message> | Iterable<Message>;
      last?: () => Message | undefined;
    }>;
  };
};

export interface BackfillCursor {
  channel_id: string;
  guild_id: string | null;
  before_message_id: string | null;
  oldest_message_created_at: number | null;
  reached_cutoff: number;
  scanned_messages: number;
  saved_messages: number;
  last_error: string | null;
  updated_at: number;
}

export class BackfillCursorStore {
  constructor(private readonly db: Database.Database) {}

  get(channelId: string): BackfillCursor | undefined {
    return this.db
      .prepare('SELECT * FROM discord_backfill_cursors WHERE channel_id = ?')
      .get(channelId) as BackfillCursor | undefined;
  }

  markProgress(input: {
    channelId: string;
    guildId?: string | null;
    beforeMessageId?: string | null;
    oldestMessageCreatedAt?: number | null;
    scannedDelta: number;
    savedDelta: number;
    reachedCutoff?: boolean;
    lastError?: string | null;
  }): void {
    const existing = this.get(input.channelId);
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO discord_backfill_cursors (
        channel_id, guild_id, before_message_id, oldest_message_created_at,
        reached_cutoff, scanned_messages, saved_messages, last_error, updated_at
      ) VALUES (
        @channel_id, @guild_id, @before_message_id, @oldest_message_created_at,
        @reached_cutoff, @scanned_messages, @saved_messages, @last_error, @updated_at
      )
      ON CONFLICT(channel_id) DO UPDATE SET
        guild_id = COALESCE(excluded.guild_id, discord_backfill_cursors.guild_id),
        before_message_id = COALESCE(excluded.before_message_id, discord_backfill_cursors.before_message_id),
        oldest_message_created_at = COALESCE(excluded.oldest_message_created_at, discord_backfill_cursors.oldest_message_created_at),
        reached_cutoff = MAX(excluded.reached_cutoff, discord_backfill_cursors.reached_cutoff),
        scanned_messages = discord_backfill_cursors.scanned_messages + @scanned_delta,
        saved_messages = discord_backfill_cursors.saved_messages + @saved_delta,
        last_error = excluded.last_error,
        updated_at = excluded.updated_at
    `).run({
      channel_id: input.channelId,
      guild_id: input.guildId ?? existing?.guild_id ?? null,
      before_message_id: input.beforeMessageId ?? existing?.before_message_id ?? null,
      oldest_message_created_at: input.oldestMessageCreatedAt ?? existing?.oldest_message_created_at ?? null,
      reached_cutoff: input.reachedCutoff ? 1 : existing?.reached_cutoff ?? 0,
      scanned_messages: (existing?.scanned_messages ?? 0) + input.scannedDelta,
      saved_messages: (existing?.saved_messages ?? 0) + input.savedDelta,
      scanned_delta: input.scannedDelta,
      saved_delta: input.savedDelta,
      last_error: input.lastError ?? null,
      updated_at: now,
    });
  }

  markError(channelId: string, guildId: string | null | undefined, error: unknown): void {
    this.markProgress({
      channelId,
      guildId,
      scannedDelta: 0,
      savedDelta: 0,
      lastError: error instanceof Error ? error.message : String(error),
    });
  }
}

export interface RunBackfillOnceOptions {
  db: Database.Database;
  channels: FetchableChannel[];
  cutoffTimestamp: number;
  maxMessagesPerRun: number;
  batchSize: number;
  delayMs: number;
  includeBotMessages: boolean;
  cursorStore?: BackfillCursorStore;
  logger?: Pick<Console, 'log' | 'warn' | 'error'>;
  skipChannelIndex?: boolean;
}

export interface BackfillResult {
  scannedMessages: number;
  savedMessages: number;
  channelsVisited: number;
  channelsCompleted: number;
  hitRunLimit: boolean;
}

export function monthsAgoTimestamp(months: number, now = new Date()): number {
  const d = new Date(now);
  d.setMonth(d.getMonth() - months);
  return d.getTime();
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getLastMessage(messages: Message[]): Message | undefined {
  return messages[messages.length - 1];
}

export function indexChannelsForBackfill(
  db: Database.Database,
  channels: FetchableChannel[],
): { indexedChannels: number } {
  const store = new ChatStorageStore(db);
  let indexedChannels = 0;
  for (const channel of channels) {
    store.saveChannelSnapshot(channel as never);
    indexedChannels += 1;
  }
  return { indexedChannels };
}

export async function runBackfillOnce(options: RunBackfillOnceOptions): Promise<BackfillResult> {
  const cursorStore = options.cursorStore ?? new BackfillCursorStore(options.db);
  const store = new ChatStorageStore(options.db);
  const batchSize = Math.max(1, Math.min(options.batchSize, 100));
  const result: BackfillResult = {
    scannedMessages: 0,
    savedMessages: 0,
    channelsVisited: 0,
    channelsCompleted: 0,
    hitRunLimit: false,
  };

  for (const channel of options.channels) {
    if (result.savedMessages >= options.maxMessagesPerRun) {
      result.hitRunLimit = true;
      break;
    }

    if (!options.skipChannelIndex) {
      store.saveChannelSnapshot(channel as never);
    }

    const cursor = cursorStore.get(channel.id);
    if (cursor?.reached_cutoff) continue;

    result.channelsVisited += 1;
    let before = cursor?.before_message_id ?? undefined;

    while (result.savedMessages < options.maxMessagesPerRun) {
      const fetchOptions = before ? { limit: batchSize, before } : { limit: batchSize };
      let batch;
      try {
        batch = await channel.messages.fetch(fetchOptions);
      } catch (error) {
        cursorStore.markError(channel.id, channel.guildId, error);
        options.logger?.warn?.(`[backfill] fetch failed for channel ${channel.id}: ${error}`);
        break;
      }

      const messages = Array.from(batch.values() as Iterable<Message>);
      if (messages.length === 0) {
        cursorStore.markProgress({
          channelId: channel.id,
          guildId: channel.guildId,
          scannedDelta: 0,
          savedDelta: 0,
          reachedCutoff: true,
        });
        result.channelsCompleted += 1;
        break;
      }

      let savedThisBatch = 0;
      let scannedThisBatch = 0;
      let reachedCutoff = false;
      let oldestMessage: Message | undefined;

      for (const message of messages) {
        scannedThisBatch += 1;
        result.scannedMessages += 1;
        oldestMessage = message;

        if (message.createdTimestamp < options.cutoffTimestamp) {
          reachedCutoff = true;
          break;
        }

        before = message.id;
        if (!options.includeBotMessages && message.author?.bot) continue;
        if (result.savedMessages >= options.maxMessagesPerRun) {
          result.hitRunLimit = true;
          break;
        }

        store.saveMessageCreate(message);
        savedThisBatch += 1;
        result.savedMessages += 1;
      }

      const last = oldestMessage ?? getLastMessage(messages);
      cursorStore.markProgress({
        channelId: channel.id,
        guildId: channel.guildId,
        beforeMessageId: last?.id ?? before ?? null,
        oldestMessageCreatedAt: last?.createdTimestamp ?? null,
        scannedDelta: scannedThisBatch,
        savedDelta: savedThisBatch,
        reachedCutoff,
      });

      if (reachedCutoff) {
        result.channelsCompleted += 1;
        break;
      }
      if (result.savedMessages >= options.maxMessagesPerRun) {
        result.hitRunLimit = true;
        break;
      }
      if (messages.length < batchSize) {
        cursorStore.markProgress({
          channelId: channel.id,
          guildId: channel.guildId,
          scannedDelta: 0,
          savedDelta: 0,
          reachedCutoff: true,
        });
        result.channelsCompleted += 1;
        break;
      }

      await sleep(options.delayMs);
    }
  }

  return result;
}
