import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import { initDb } from '../src/db/schema';

const testDbPath = path.join(process.cwd(), 'data', 'chat-storage-test.db');

function makeMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: 'msg-1',
    guildId: 'guild-1',
    channelId: 'channel-1',
    createdTimestamp: 1_700_000_000_000,
    editedTimestamp: null,
    content: 'hello discord',
    cleanContent: 'hello discord',
    type: 0,
    pinned: false,
    tts: false,
    system: false,
    url: 'https://discord.com/channels/guild-1/channel-1/msg-1',
    author: {
      id: 'user-1',
      username: 'alice',
      globalName: 'Alice Global',
      bot: false,
    },
    guild: {
      id: 'guild-1',
      name: 'TD GAMES',
    },
    channel: {
      id: 'channel-1',
      type: 0,
      name: 'general',
      parentId: 'category-1',
      parent: { name: 'Community' },
      isThread: () => false,
    },
    attachments: {
      map: (fn: (attachment: unknown) => unknown) => [
        fn({ id: 'att-1', name: 'image.png', url: 'https://cdn/image.png', proxyURL: 'https://proxy/image.png', contentType: 'image/png', size: 123 }),
      ],
    },
    embeds: [{ title: 'embed title' }],
    mentions: {
      users: { map: (fn: (user: unknown) => unknown) => [fn({ id: 'user-2', username: 'bob' })] },
      roles: { map: (fn: (role: unknown) => unknown) => [fn({ id: 'role-1', name: 'Admin' })] },
      channels: { map: (fn: (channel: unknown) => unknown) => [fn({ id: 'channel-2', name: 'dev' })] },
    },
    reference: { messageId: 'parent-msg' },
    ...overrides,
  };
}

describe('ChatStorageStore', () => {
  beforeEach(() => {
    for (const file of [testDbPath, `${testDbPath}-wal`, `${testDbPath}-shm`]) {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }
  });

  afterEach(() => {
    for (const file of [testDbPath, `${testDbPath}-wal`, `${testDbPath}-shm`]) {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }
  });

  it('upserts guild, channel and message data from a Discord message', async () => {
    const { ChatStorageStore } = await import('../src/features/chat-storage/store');
    const db = initDb(testDbPath);
    const store = new ChatStorageStore(db);

    store.saveMessageCreate(makeMessage() as never);

    const server = db.prepare('SELECT guild_id, name, is_active FROM discord_servers WHERE guild_id = ?').get('guild-1') as any;
    expect(server).toMatchObject({ guild_id: 'guild-1', name: 'TD GAMES', is_active: 1 });

    const channel = db.prepare('SELECT channel_id, guild_id, name, category_name, is_active FROM discord_channels WHERE channel_id = ?').get('channel-1') as any;
    expect(channel).toMatchObject({ channel_id: 'channel-1', guild_id: 'guild-1', name: 'general', category_name: 'Community', is_active: 1 });

    const message = db.prepare('SELECT * FROM discord_messages WHERE message_id = ?').get('msg-1') as any;
    expect(message).toMatchObject({
      message_id: 'msg-1',
      guild_id: 'guild-1',
      channel_id: 'channel-1',
      author_id: 'user-1',
      author_name: 'alice',
      content: 'hello discord',
      clean_content: 'hello discord',
      reply_to_message_id: 'parent-msg',
      deleted_at: null,
    });
    expect(JSON.parse(message.attachments)[0]).toMatchObject({ id: 'att-1', name: 'image.png' });
    expect(JSON.parse(message.mentions).users[0]).toMatchObject({ id: 'user-2', username: 'bob' });

    const eventCount = db.prepare('SELECT COUNT(*) AS count FROM discord_message_events WHERE message_id = ? AND event_type = ?').get('msg-1', 'create') as any;
    expect(eventCount.count).toBe(1);

    db.close();
  });

  it('updates edited content and logs an update event', async () => {
    const { ChatStorageStore } = await import('../src/features/chat-storage/store');
    const db = initDb(testDbPath);
    const store = new ChatStorageStore(db);

    store.saveMessageCreate(makeMessage() as never);
    store.saveMessageUpdate(makeMessage({ content: 'edited text', cleanContent: 'edited text', editedTimestamp: 1_700_000_010_000 }) as never);

    const message = db.prepare('SELECT content, clean_content, edited_at FROM discord_messages WHERE message_id = ?').get('msg-1') as any;
    expect(message.content).toBe('edited text');
    expect(message.clean_content).toBe('edited text');
    expect(message.edited_at).toBe(1_700_000_010_000);

    const eventCount = db.prepare('SELECT COUNT(*) AS count FROM discord_message_events WHERE message_id = ? AND event_type = ?').get('msg-1', 'update') as any;
    expect(eventCount.count).toBe(1);

    db.close();
  });

  it('marks a message deleted without removing the original row', async () => {
    const { ChatStorageStore } = await import('../src/features/chat-storage/store');
    const db = initDb(testDbPath);
    const store = new ChatStorageStore(db);

    store.saveMessageCreate(makeMessage() as never);
    store.saveMessageDelete(makeMessage() as never);

    const message = db.prepare('SELECT content, deleted_at FROM discord_messages WHERE message_id = ?').get('msg-1') as any;
    expect(message.content).toBe('hello discord');
    expect(message.deleted_at).toEqual(expect.any(Number));

    const eventCount = db.prepare('SELECT COUNT(*) AS count FROM discord_message_events WHERE message_id = ? AND event_type = ?').get('msg-1', 'delete') as any;
    expect(eventCount.count).toBe(1);

    db.close();
  });

  it('upserts channel snapshots and marks deleted channels inactive', async () => {
    const { ChatStorageStore } = await import('../src/features/chat-storage/store');
    const db = initDb(testDbPath);
    const store = new ChatStorageStore(db);

    store.saveChannelSnapshot({
      id: 'channel-2',
      guildId: 'guild-1',
      guild: { id: 'guild-1', name: 'TD GAMES' },
      name: 'old-name',
      type: 0,
      parentId: 'category-1',
      parent: { name: 'Old Category' },
      isThread: () => false,
    });
    store.saveChannelSnapshot({
      id: 'channel-2',
      guildId: 'guild-1',
      guild: { id: 'guild-1', name: 'TD GAMES' },
      name: 'new-name',
      type: 0,
      parentId: 'category-2',
      parent: { name: 'New Category' },
      isThread: () => false,
    });

    const active = db.prepare('SELECT name, parent_id, category_name, is_active FROM discord_channels WHERE channel_id = ?').get('channel-2') as any;
    expect(active).toMatchObject({ name: 'new-name', parent_id: 'category-2', category_name: 'New Category', is_active: 1 });

    store.markChannelInactive('channel-2');

    const inactive = db.prepare('SELECT is_active FROM discord_channels WHERE channel_id = ?').get('channel-2') as any;
    expect(inactive.is_active).toBe(0);

    db.close();
  });

  it('upserts guild snapshots and marks removed guilds and channels inactive', async () => {
    const { ChatStorageStore } = await import('../src/features/chat-storage/store');
    const db = initDb(testDbPath);
    const store = new ChatStorageStore(db);

    store.saveGuildSnapshot({ id: 'guild-1', name: 'Old Server' });
    store.saveChannelSnapshot({ id: 'channel-1', guildId: 'guild-1', guild: { id: 'guild-1', name: 'Old Server' }, name: 'general' });
    store.saveGuildSnapshot({ id: 'guild-1', name: 'New Server' });

    const active = db.prepare('SELECT name, is_active FROM discord_servers WHERE guild_id = ?').get('guild-1') as any;
    expect(active).toMatchObject({ name: 'New Server', is_active: 1 });

    store.markGuildInactive('guild-1');

    const server = db.prepare('SELECT is_active FROM discord_servers WHERE guild_id = ?').get('guild-1') as any;
    const channel = db.prepare('SELECT is_active FROM discord_channels WHERE channel_id = ?').get('channel-1') as any;
    expect(server.is_active).toBe(0);
    expect(channel.is_active).toBe(0);

    db.close();
  });
});
