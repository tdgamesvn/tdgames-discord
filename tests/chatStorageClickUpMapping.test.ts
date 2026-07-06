import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import { initDb } from '../src/db/schema';

const testDbPath = path.join(process.cwd(), 'data', 'clickup-mapping-test.db');

function cleanup() {
  for (const f of [testDbPath, `${testDbPath}-wal`, `${testDbPath}-shm`]) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
}

describe('ClickUp Project Mapping', () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  it('upserts a channel-scoped mapping and lists it back', async () => {
    const { ChatStorageAdminStore } = await import('../src/features/chat-storage/admin');
    const db = initDb(testDbPath);
    const now = Date.now();
    db.prepare('INSERT INTO discord_servers (guild_id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run('g1', 'TD Games', now, now);
    db.prepare('INSERT INTO discord_channels (channel_id, guild_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('c1', 'g1', 'pm-updates', now, now);

    const store = new ChatStorageAdminStore(db);
    const id = store.upsertClickUpMapping({
      scopeType: 'channel',
      channelId: 'c1',
      guildId: 'g1',
      clickupProjectId: 'cu-proj-1',
      clickupProjectName: 'TD Games Platform',
      agentKey: 'pm',
      folderId: 'f-99',
    });

    expect(id).toBeGreaterThan(0);
    const mappings = store.listClickUpMappings();
    expect(mappings).toHaveLength(1);
    expect(mappings[0]).toMatchObject({
      id,
      scopeType: 'channel',
      channelId: 'c1',
      guildId: 'g1',
      clickupProjectId: 'cu-proj-1',
      clickupProjectName: 'TD Games Platform',
      agentKey: 'pm',
      folderId: 'f-99',
      isActive: 1,
    });

    db.close();
  });

  it('upsert is idempotent — updates project name on same scope+agent', async () => {
    const { ChatStorageAdminStore } = await import('../src/features/chat-storage/admin');
    const db = initDb(testDbPath);
    const now = Date.now();
    db.prepare('INSERT INTO discord_servers (guild_id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run('g1', 'TD', now, now);
    db.prepare('INSERT INTO discord_channels (channel_id, guild_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('c1', 'g1', 'ch', now, now);

    const store = new ChatStorageAdminStore(db);
    store.upsertClickUpMapping({ scopeType: 'channel', channelId: 'c1', clickupProjectId: 'p1', clickupProjectName: 'Old', agentKey: 'pm' });
    store.upsertClickUpMapping({ scopeType: 'channel', channelId: 'c1', clickupProjectId: 'p1', clickupProjectName: 'New', agentKey: 'pm' });

    const mappings = store.listClickUpMappings();
    expect(mappings).toHaveLength(1);
    expect(mappings[0].clickupProjectName).toBe('New');

    db.close();
  });

  it('upserts guild-scoped and category-scoped mappings', async () => {
    const { ChatStorageAdminStore } = await import('../src/features/chat-storage/admin');
    const db = initDb(testDbPath);
    const now = Date.now();
    db.prepare('INSERT INTO discord_servers (guild_id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run('g1', 'TD', now, now);

    const store = new ChatStorageAdminStore(db);
    store.upsertClickUpMapping({ scopeType: 'guild', guildId: 'g1', clickupProjectId: 'p-guild', clickupProjectName: 'Guild Project', agentKey: 'ceo' });
    store.upsertClickUpMapping({ scopeType: 'category', guildId: 'g1', parentId: 'cat-1', categoryName: '🎬 ANIMATION', clickupProjectId: 'p-cat', clickupProjectName: 'Anim Project', agentKey: 'pm', listId: 'l-5' });

    const mappings = store.listClickUpMappings();
    expect(mappings).toHaveLength(2);
    expect(mappings.find((m) => m.scopeType === 'guild')).toMatchObject({ guildId: 'g1', clickupProjectId: 'p-guild', agentKey: 'ceo' });
    expect(mappings.find((m) => m.scopeType === 'category')).toMatchObject({ parentId: 'cat-1', categoryName: '🎬 ANIMATION', clickupProjectId: 'p-cat', listId: 'l-5', agentKey: 'pm' });

    db.close();
  });

  it('deletes a mapping by id', async () => {
    const { ChatStorageAdminStore } = await import('../src/features/chat-storage/admin');
    const db = initDb(testDbPath);
    const now = Date.now();
    db.prepare('INSERT INTO discord_servers (guild_id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run('g1', 'TD', now, now);
    db.prepare('INSERT INTO discord_channels (channel_id, guild_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('c1', 'g1', 'ch', now, now);

    const store = new ChatStorageAdminStore(db);
    const id = store.upsertClickUpMapping({ scopeType: 'channel', channelId: 'c1', clickupProjectId: 'p1', clickupProjectName: 'P', agentKey: 'pm' });
    store.deleteClickUpMapping(id);

    expect(store.listClickUpMappings()).toHaveLength(0);

    db.close();
  });

  it('toggles is_active on a mapping', async () => {
    const { ChatStorageAdminStore } = await import('../src/features/chat-storage/admin');
    const db = initDb(testDbPath);
    const now = Date.now();
    db.prepare('INSERT INTO discord_servers (guild_id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run('g1', 'TD', now, now);
    db.prepare('INSERT INTO discord_channels (channel_id, guild_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('c1', 'g1', 'ch', now, now);

    const store = new ChatStorageAdminStore(db);
    const id = store.upsertClickUpMapping({ scopeType: 'channel', channelId: 'c1', clickupProjectId: 'p1', clickupProjectName: 'P', agentKey: 'pm' });

    store.toggleClickUpMapping(id, false);
    expect(store.listClickUpMappings()[0].isActive).toBe(0);

    store.toggleClickUpMapping(id, true);
    expect(store.listClickUpMappings()[0].isActive).toBe(1);

    db.close();
  });

  it('different agents can map same scope to different ClickUp projects', async () => {
    const { ChatStorageAdminStore } = await import('../src/features/chat-storage/admin');
    const db = initDb(testDbPath);
    const now = Date.now();
    db.prepare('INSERT INTO discord_servers (guild_id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run('g1', 'TD', now, now);
    db.prepare('INSERT INTO discord_channels (channel_id, guild_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('c1', 'g1', 'ch', now, now);

    const store = new ChatStorageAdminStore(db);
    store.upsertClickUpMapping({ scopeType: 'channel', channelId: 'c1', clickupProjectId: 'pm-proj', clickupProjectName: 'PM Project', agentKey: 'pm' });
    store.upsertClickUpMapping({ scopeType: 'channel', channelId: 'c1', clickupProjectId: 'ceo-proj', clickupProjectName: 'CEO Project', agentKey: 'ceo' });

    const mappings = store.listClickUpMappings();
    expect(mappings).toHaveLength(2);
    expect(mappings.map((m) => m.agentKey).sort()).toEqual(['ceo', 'pm']);

    db.close();
  });

  it('getChannelTree includes clickupMappings for channel-scoped entries', async () => {
    const { ChatStorageAdminStore } = await import('../src/features/chat-storage/admin');
    const db = initDb(testDbPath);
    const now = Date.now();
    db.prepare('INSERT INTO discord_servers (guild_id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run('g1', 'TD', now, now);
    db.prepare('INSERT INTO discord_channels (channel_id, guild_id, name, category_name, parent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run('c1', 'g1', 'pm-updates', 'Project', 'cat-1', now, now);

    const store = new ChatStorageAdminStore(db);
    store.upsertClickUpMapping({ scopeType: 'channel', channelId: 'c1', clickupProjectId: 'cu-1', clickupProjectName: 'My Project', agentKey: 'pm', folderId: 'f1' });

    const tree = store.getChannelTree();
    const ch = tree[0].categories[0].channels[0];
    expect(ch.clickupMappings).toBeDefined();
    expect(ch.clickupMappings).toHaveLength(1);
    expect(ch.clickupMappings[0]).toMatchObject({
      clickupProjectId: 'cu-1',
      clickupProjectName: 'My Project',
      agentKey: 'pm',
      folderId: 'f1',
    });

    db.close();
  });

  it('listClickUpMappings filters by agentKey when provided', async () => {
    const { ChatStorageAdminStore } = await import('../src/features/chat-storage/admin');
    const db = initDb(testDbPath);
    const now = Date.now();
    db.prepare('INSERT INTO discord_servers (guild_id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run('g1', 'TD', now, now);
    db.prepare('INSERT INTO discord_channels (channel_id, guild_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('c1', 'g1', 'ch1', now, now);
    db.prepare('INSERT INTO discord_channels (channel_id, guild_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('c2', 'g1', 'ch2', now, now);

    const store = new ChatStorageAdminStore(db);
    store.upsertClickUpMapping({ scopeType: 'channel', channelId: 'c1', clickupProjectId: 'pm-p', clickupProjectName: 'PM P', agentKey: 'pm' });
    store.upsertClickUpMapping({ scopeType: 'channel', channelId: 'c2', clickupProjectId: 'ceo-p', clickupProjectName: 'CEO P', agentKey: 'ceo' });

    const pmOnly = store.listClickUpMappings('pm');
    expect(pmOnly).toHaveLength(1);
    expect(pmOnly[0].agentKey).toBe('pm');

    const all = store.listClickUpMappings();
    expect(all).toHaveLength(2);

    db.close();
  });
});
