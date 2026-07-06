import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import { initDb } from '../src/db/schema';

const testDbPath = path.join(process.cwd(), 'data', 'chat-storage-admin-test.db');

function cleanup() {
  for (const file of [testDbPath, `${testDbPath}-wal`, `${testDbPath}-shm`]) {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
}

describe('ChatStorageAdminStore', () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  it('returns summary counts for chat storage dashboard', async () => {
    const { ChatStorageAdminStore } = await import('../src/features/chat-storage/admin');
    const db = initDb(testDbPath);
    const now = Date.now();
    db.prepare('INSERT INTO discord_servers (guild_id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run('guild-1', 'TD GAMES', now, now);
    db.prepare('INSERT INTO discord_channels (channel_id, guild_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run('channel-1', 'guild-1', 'pm-updates', now, now);
    db.prepare('INSERT INTO discord_messages (message_id, guild_id, channel_id, content, created_at, ingested_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run('msg-1', 'guild-1', 'channel-1', 'hello', now, now);
    db.prepare('INSERT INTO discord_backfill_cursors (channel_id, guild_id, scanned_messages, saved_messages, reached_cutoff, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run('channel-1', 'guild-1', 20, 10, 0, now);

    const store = new ChatStorageAdminStore(db);
    const summary = store.getSummary();

    expect(summary.totalMessages).toBe(1);
    expect(summary.messages24h).toBe(1);
    expect(summary.channelsIndexed).toBe(1);
    expect(summary.serversIndexed).toBe(1);
    expect(summary.backfill.scannedMessages).toBe(20);
    expect(summary.backfill.savedMessages).toBe(10);
    expect(summary.backfill.channelsWithCursor).toBe(1);

    db.close();
  });

  it('creates groups, assigns channels, and syncs agent access', async () => {
    const { ChatStorageAdminStore } = await import('../src/features/chat-storage/admin');
    const db = initDb(testDbPath);
    const now = Date.now();
    db.prepare('INSERT INTO discord_servers (guild_id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run('guild-1', 'TD GAMES', now, now);
    db.prepare('INSERT INTO discord_channels (channel_id, guild_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run('channel-1', 'guild-1', 'pm-updates', now, now);

    const store = new ChatStorageAdminStore(db);
    store.upsertGroup({ groupKey: 'pm_project_updates', displayName: 'PM — Project Updates', agentKey: 'pm', description: 'PM reads this' });
    store.setGroupChannels('pm_project_updates', ['channel-1']);
    const sync = store.syncAgentAccessFromGroups();

    expect(sync.upserted).toBe(1);
    const groups = store.listGroups();
    expect(groups[0]).toMatchObject({ groupKey: 'pm_project_updates', displayName: 'PM — Project Updates', agentKey: 'pm', channelCount: 1 });
    expect(groups[0].channels[0]).toMatchObject({ channelId: 'channel-1', name: 'pm-updates' });

    const access = db.prepare('SELECT agent_key, channel_id, access_level, is_active FROM discord_agent_channel_access').get() as any;
    expect(access).toMatchObject({ agent_key: 'pm', channel_id: 'channel-1', access_level: 'read', is_active: 1 });

    db.close();
  });

  it('builds a server/category/channel tree for assignment UI', async () => {
    const { ChatStorageAdminStore } = await import('../src/features/chat-storage/admin');
    const db = initDb(testDbPath);
    const now = Date.now();
    db.prepare('INSERT INTO discord_servers (guild_id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run('guild-1', 'TD_Games_Outsource', now, now);
    db.prepare('INSERT INTO discord_channels (channel_id, guild_id, name, category_name, parent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('channel-1', 'guild-1', 'walk_cycle', '🎬 ANIMATION', 'cat-1', now, now);
    db.prepare('INSERT INTO discord_channels (channel_id, guild_id, name, category_name, parent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('channel-2', 'guild-1', 'payment', '💰 PAYMENT', 'cat-2', now, now);
    db.prepare('INSERT INTO discord_messages (message_id, guild_id, channel_id, content, created_at, ingested_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run('msg-1', 'guild-1', 'channel-1', 'hello', now, now);

    const store = new ChatStorageAdminStore(db);
    store.upsertGroup({ groupKey: 'pm_project_updates', displayName: 'PM — Project Updates', agentKey: 'pm', description: '' });
    store.setGroupChannels('pm_project_updates', ['channel-1']);

    const tree = store.getChannelTree();

    expect(tree).toHaveLength(1);
    expect(tree[0]).toMatchObject({ guildId: 'guild-1', guildName: 'TD_Games_Outsource', channelCount: 2 });
    expect(tree[0].categories).toHaveLength(2);
    expect(tree[0].categories[0]).toMatchObject({ categoryName: '🎬 ANIMATION', channelCount: 1 });
    expect(tree[0].categories[0].channels[0]).toMatchObject({ channelId: 'channel-1', name: 'walk_cycle', messageCount: 1 });
    expect(tree[0].categories[0].channels[0].groups[0]).toMatchObject({ groupKey: 'pm_project_updates', agentKey: 'pm' });

    db.close();
  });

  it('saves server/category/channel assignment policies and expands them during agent sync', async () => {
    const { ChatStorageAdminStore } = await import('../src/features/chat-storage/admin');
    const db = initDb(testDbPath);
    const now = Date.now();
    db.prepare('INSERT INTO discord_servers (guild_id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run('guild-1', 'TD_Games_Outsource', now, now);
    db.prepare('INSERT INTO discord_channels (channel_id, guild_id, name, category_name, parent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('channel-1', 'guild-1', 'walk_cycle', '🎬 ANIMATION', 'cat-1', now, now);
    db.prepare('INSERT INTO discord_channels (channel_id, guild_id, name, category_name, parent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('channel-2', 'guild-1', 'animation_khiem', '🎬 ANIMATION', 'cat-1', now, now);
    db.prepare('INSERT INTO discord_channels (channel_id, guild_id, name, category_name, parent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('channel-3', 'guild-1', 'payment', '💰 PAYMENT', 'cat-2', now, now);

    const store = new ChatStorageAdminStore(db);
    store.upsertGroup({ groupKey: 'pm_project_updates', displayName: 'PM — Project Updates', agentKey: 'pm', description: '' });
    store.setGroupAssignmentPolicies('pm_project_updates', [
      { scopeType: 'guild', guildId: 'guild-1' },
      { scopeType: 'category', guildId: 'guild-1', parentId: 'cat-1', categoryName: '🎬 ANIMATION' },
      { scopeType: 'channel', channelId: 'channel-3' },
    ]);

    const groups = store.listGroups();
    expect(groups[0].policies).toEqual(expect.arrayContaining([
      expect.objectContaining({ scopeType: 'guild', guildId: 'guild-1' }),
      expect.objectContaining({ scopeType: 'category', guildId: 'guild-1', parentId: 'cat-1' }),
      expect.objectContaining({ scopeType: 'channel', channelId: 'channel-3' }),
    ]));

    const sync = store.syncAgentAccessFromGroups();
    expect(sync.upserted).toBe(3);
    const access = db.prepare('SELECT channel_id AS channelId FROM discord_agent_channel_access WHERE agent_key = ? ORDER BY channel_id').all('pm') as any[];
    expect(access.map((row) => row.channelId)).toEqual(['channel-1', 'channel-2', 'channel-3']);

    db.prepare('INSERT INTO discord_channels (channel_id, guild_id, name, category_name, parent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('channel-4', 'guild-1', 'new-later', 'NEW', 'cat-3', now, now);
    const syncAfterNewChannel = store.syncAgentAccessFromGroups();
    expect(syncAfterNewChannel.upserted).toBe(4);
    const inherited = db.prepare('SELECT channel_id FROM discord_agent_channel_access WHERE agent_key = ? AND channel_id = ?').get('pm', 'channel-4') as any;
    expect(inherited.channel_id).toBe('channel-4');

    db.prepare('UPDATE discord_channels SET is_active = 0 WHERE channel_id = ?').run('channel-2');
    const syncAfterDelete = store.syncAgentAccessFromGroups();
    expect(syncAfterDelete.upserted).toBe(3);
    const inactiveAccess = db.prepare('SELECT is_active FROM discord_agent_channel_access WHERE agent_key = ? AND channel_id = ?').get('pm', 'channel-2') as any;
    expect(inactiveAccess.is_active).toBe(0);

    db.close();
  });

  it('lists indexed channels with group memberships and message counts', async () => {
    const { ChatStorageAdminStore } = await import('../src/features/chat-storage/admin');
    const db = initDb(testDbPath);
    const now = Date.now();
    db.prepare('INSERT INTO discord_servers (guild_id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run('guild-1', 'TD GAMES', now, now);
    db.prepare('INSERT INTO discord_channels (channel_id, guild_id, name, category_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run('channel-1', 'guild-1', 'pm-updates', 'Project', now, now);
    db.prepare('INSERT INTO discord_messages (message_id, guild_id, channel_id, content, created_at, ingested_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run('msg-1', 'guild-1', 'channel-1', 'hello', now, now);

    const store = new ChatStorageAdminStore(db);
    store.upsertGroup({ groupKey: 'pm_project_updates', displayName: 'PM — Project Updates', agentKey: 'pm', description: '' });
    store.setGroupChannels('pm_project_updates', ['channel-1']);

    const channels = store.listChannels();

    expect(channels[0]).toMatchObject({
      channelId: 'channel-1',
      guildName: 'TD GAMES',
      name: 'pm-updates',
      categoryName: 'Project',
      messageCount: 1,
    });
    expect(channels[0].groups[0]).toMatchObject({ groupKey: 'pm_project_updates', agentKey: 'pm' });

    db.close();
  });
});
