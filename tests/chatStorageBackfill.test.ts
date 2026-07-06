import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import fs from 'fs';
import { initDb } from '../src/db/schema';

const testDbPath = path.join(process.cwd(), 'data', 'backfill-test.db');

function cleanup() {
  for (const file of [testDbPath, `${testDbPath}-wal`, `${testDbPath}-shm`]) {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
}

function makeChannel(id: string, batches: any[][]) {
  let calls = 0;
  return {
    id,
    guildId: 'guild-1',
    name: `channel-${id}`,
    type: 0,
    parentId: null,
    parent: null,
    isThread: () => false,
    isTextBased: () => true,
    messages: {
      fetch: vi.fn(async () => {
        const batch = batches[calls++] ?? [];
        return {
          size: batch.length,
          values: () => batch.values(),
          last: () => batch[batch.length - 1],
        };
      }),
    },
  };
}

function makeMessage(id: string, channel: any, createdTimestamp: number, bot = false) {
  return {
    id,
    guildId: channel.guildId,
    channelId: channel.id,
    guild: { id: channel.guildId, name: 'TD GAMES' },
    channel,
    createdTimestamp,
    editedTimestamp: null,
    content: `message ${id}`,
    cleanContent: `message ${id}`,
    author: { id: `author-${id}`, username: `author-${id}`, bot },
    attachments: { map: () => [] },
    embeds: [],
    mentions: {
      users: { map: () => [] },
      roles: { map: () => [] },
      channels: { map: () => [] },
    },
    reference: null,
    url: `https://discord.com/channels/guild-1/${channel.id}/${id}`,
    type: 0,
  };
}

describe('Discord history backfill', () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  it('stores progress cursor and resumes from the last fetched message id', async () => {
    const { BackfillCursorStore, runBackfillOnce } = await import('../src/features/chat-storage/backfill');
    const db = initDb(testDbPath);
    const channel = makeChannel('channel-1', []);
    channel.messages.fetch
      .mockResolvedValueOnce({
        size: 2,
        values: () => [
          makeMessage('msg-new', channel, 1_700_000_000_000),
          makeMessage('msg-old', channel, 1_699_999_000_000),
        ].values(),
        last: () => makeMessage('msg-old', channel, 1_699_999_000_000),
      })
      .mockResolvedValueOnce({ size: 0, values: () => [].values(), last: () => undefined });

    const cursorStore = new BackfillCursorStore(db);
    await runBackfillOnce({
      db,
      channels: [channel as never],
      cutoffTimestamp: 1_690_000_000_000,
      maxMessagesPerRun: 2,
      batchSize: 100,
      delayMs: 0,
      includeBotMessages: false,
      cursorStore,
    });

    expect(channel.messages.fetch).toHaveBeenCalledWith({ limit: 100 });
    expect(cursorStore.get('channel-1')).toMatchObject({ before_message_id: 'msg-old' });

    await runBackfillOnce({
      db,
      channels: [channel as never],
      cutoffTimestamp: 1_690_000_000_000,
      maxMessagesPerRun: 2,
      batchSize: 100,
      delayMs: 0,
      includeBotMessages: false,
      cursorStore,
    });

    expect(channel.messages.fetch).toHaveBeenLastCalledWith({ limit: 100, before: 'msg-old' });
    db.close();
  });

  it('stops at the per-run message limit to avoid aggressive Discord API usage', async () => {
    const { BackfillCursorStore, runBackfillOnce } = await import('../src/features/chat-storage/backfill');
    const db = initDb(testDbPath);
    const channel = makeChannel('channel-1', []);
    channel.messages.fetch.mockResolvedValue({
      size: 3,
      values: () => [
        makeMessage('msg-1', channel, 1_700_000_000_000),
        makeMessage('msg-2', channel, 1_699_999_000_000),
        makeMessage('msg-3', channel, 1_699_998_000_000),
      ].values(),
      last: () => makeMessage('msg-3', channel, 1_699_998_000_000),
    });

    const result = await runBackfillOnce({
      db,
      channels: [channel as never],
      cutoffTimestamp: 1_690_000_000_000,
      maxMessagesPerRun: 2,
      batchSize: 100,
      delayMs: 0,
      includeBotMessages: false,
      cursorStore: new BackfillCursorStore(db),
    });

    expect(result.savedMessages).toBe(2);
    expect(channel.messages.fetch).toHaveBeenCalledTimes(1);
    db.close();
  });

  it('indexes channels even when they have no messages', async () => {
    const { BackfillCursorStore, runBackfillOnce } = await import('../src/features/chat-storage/backfill');
    const db = initDb(testDbPath);
    const emptyChannel = makeChannel('empty-channel', [[]]);

    const result = await runBackfillOnce({
      db,
      channels: [emptyChannel as never],
      cutoffTimestamp: 1_690_000_000_000,
      maxMessagesPerRun: 10,
      batchSize: 100,
      delayMs: 0,
      includeBotMessages: false,
      cursorStore: new BackfillCursorStore(db),
    });

    const channel = db.prepare('SELECT channel_id, guild_id, name FROM discord_channels WHERE channel_id = ?').get('empty-channel') as any;
    expect(channel).toMatchObject({ channel_id: 'empty-channel', guild_id: 'guild-1', name: 'channel-empty-channel' });
    expect(result.channelsVisited).toBe(1);
    expect(result.channelsCompleted).toBe(1);

    db.close();
  });

  it('indexes all channels before applying message save limits', async () => {
    const { indexChannelsForBackfill, BackfillCursorStore, runBackfillOnce } = await import('../src/features/chat-storage/backfill');
    const db = initDb(testDbPath);
    const channelA = makeChannel('channel-a', []);
    const channelB = makeChannel('channel-b', [[]]);
    const channelC = makeChannel('channel-c', [[]]);
    // fix channel reference for message generated before channel assigned
    channelA.messages.fetch.mockResolvedValueOnce({
      size: 1,
      values: () => [makeMessage('a1', channelA, 1_700_000_000_000)].values(),
      last: () => makeMessage('a1', channelA, 1_700_000_000_000),
    });

    const indexed = indexChannelsForBackfill(db, [channelA as never, channelB as never, channelC as never]);
    const result = await runBackfillOnce({
      db,
      channels: [channelA as never, channelB as never, channelC as never],
      cutoffTimestamp: 1_690_000_000_000,
      maxMessagesPerRun: 1,
      batchSize: 100,
      delayMs: 0,
      includeBotMessages: false,
      cursorStore: new BackfillCursorStore(db),
      skipChannelIndex: true,
    });

    const count = db.prepare('SELECT COUNT(*) AS count FROM discord_channels').get() as any;
    expect(indexed.indexedChannels).toBe(3);
    expect(count.count).toBe(3);
    expect(result.savedMessages).toBe(1);
    expect(result.hitRunLimit).toBe(true);

    db.close();
  });

  it('skips bot messages when configured to exclude bots', async () => {
    const { BackfillCursorStore, runBackfillOnce } = await import('../src/features/chat-storage/backfill');
    const db = initDb(testDbPath);
    const channel = makeChannel('channel-1', []);
    channel.messages.fetch.mockResolvedValueOnce({
      size: 2,
      values: () => [
        makeMessage('human-msg', channel, 1_700_000_000_000, false),
        makeMessage('bot-msg', channel, 1_699_999_000_000, true),
      ].values(),
      last: () => makeMessage('bot-msg', channel, 1_699_999_000_000, true),
    });

    const result = await runBackfillOnce({
      db,
      channels: [channel as never],
      cutoffTimestamp: 1_690_000_000_000,
      maxMessagesPerRun: 10,
      batchSize: 100,
      delayMs: 0,
      includeBotMessages: false,
      cursorStore: new BackfillCursorStore(db),
    });

    expect(result.savedMessages).toBe(1);
    const botRow = db.prepare('SELECT message_id FROM discord_messages WHERE message_id = ?').get('bot-msg');
    expect(botRow).toBeUndefined();
    db.close();
  });
});
