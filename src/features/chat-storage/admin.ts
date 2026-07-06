import type Database from 'better-sqlite3';

// ── ClickUp Mapping ───────────────────────────────────────────────────────────

export interface ClickUpMappingInput {
  scopeType: 'guild' | 'category' | 'channel';
  guildId?: string | null;
  parentId?: string | null;
  categoryName?: string | null;
  channelId?: string | null;
  clickupProjectId: string;
  clickupProjectName: string;
  folderId?: string | null;
  listId?: string | null;
  agentKey: string;
}

export interface ClickUpMapping {
  id: number;
  scopeKey: string;
  scopeType: 'guild' | 'category' | 'channel';
  guildId: string | null;
  parentId: string | null;
  categoryName: string | null;
  channelId: string | null;
  clickupProjectId: string;
  clickupProjectName: string;
  folderId: string | null;
  listId: string | null;
  agentKey: string;
  isActive: number;
  createdAt: number;
  updatedAt: number;
}

function buildScopeKey(input: Pick<ClickUpMappingInput, 'scopeType' | 'guildId' | 'parentId' | 'categoryName' | 'channelId'>): string {
  return `${input.scopeType}:${input.guildId ?? ''}:${input.parentId ?? ''}:${input.categoryName ?? ''}:${input.channelId ?? ''}`;
}

export interface ChatStorageGroupInput {
  groupKey: string;
  displayName: string;
  agentKey: string;
  description?: string;
}

export type ChatStoragePolicyScope = 'guild' | 'category' | 'channel';

export interface ChatStorageGroupPolicyInput {
  scopeType: ChatStoragePolicyScope;
  guildId?: string | null;
  parentId?: string | null;
  categoryName?: string | null;
  channelId?: string | null;
}

export interface ChatStorageGroupPolicy extends ChatStorageGroupPolicyInput {
  id: number;
  groupKey: string;
  createdAt: number;
  updatedAt: number;
}

export interface ChatStorageSummary {
  totalMessages: number;
  messages24h: number;
  channelsIndexed: number;
  serversIndexed: number;
  backfill: {
    scannedMessages: number;
    savedMessages: number;
    channelsWithCursor: number;
    channelsReachedCutoff: number;
    lastUpdatedAt: number | null;
    errors: Array<{ channelId: string; guildId: string | null; lastError: string; updatedAt: number }>;
  };
}

export class ChatStorageAdminStore {
  constructor(private readonly db: Database.Database) {}

  getSummary(): ChatStorageSummary {
    const one = <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) =>
      this.db.prepare(sql).get(...params) as T;
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const totalMessages = one<{ count: number }>('SELECT COUNT(*) AS count FROM discord_messages').count;
    const messages24h = one<{ count: number }>('SELECT COUNT(*) AS count FROM discord_messages WHERE created_at >= ?', [cutoff]).count;
    const channelsIndexed = one<{ count: number }>('SELECT COUNT(*) AS count FROM discord_channels').count;
    const serversIndexed = one<{ count: number }>('SELECT COUNT(*) AS count FROM discord_servers').count;
    const backfill = one<{ scanned: number; saved: number; channels: number; reached: number; last_updated: number | null }>(`
      SELECT COALESCE(SUM(scanned_messages),0) AS scanned,
             COALESCE(SUM(saved_messages),0) AS saved,
             COUNT(*) AS channels,
             COALESCE(SUM(reached_cutoff),0) AS reached,
             MAX(updated_at) AS last_updated
      FROM discord_backfill_cursors
    `);
    const errors = this.db.prepare(`
      SELECT channel_id AS channelId, guild_id AS guildId, last_error AS lastError, updated_at AS updatedAt
      FROM discord_backfill_cursors
      WHERE last_error IS NOT NULL AND last_error != ''
      ORDER BY updated_at DESC LIMIT 20
    `).all() as ChatStorageSummary['backfill']['errors'];
    return {
      totalMessages,
      messages24h,
      channelsIndexed,
      serversIndexed,
      backfill: {
        scannedMessages: backfill.scanned,
        savedMessages: backfill.saved,
        channelsWithCursor: backfill.channels,
        channelsReachedCutoff: backfill.reached,
        lastUpdatedAt: backfill.last_updated,
        errors,
      },
    };
  }

  listChannels(): Array<{
    channelId: string;
    guildId: string | null;
    guildName: string | null;
    name: string | null;
    categoryName: string | null;
    parentId: string | null;
    messageCount: number;
    lastMessageAt: number | null;
    groups: Array<{ groupKey: string; displayName: string; agentKey: string | null }>;
  }> {
    const rows = this.db.prepare(`
      SELECT c.channel_id AS channelId, c.guild_id AS guildId, s.name AS guildName,
             c.name, c.category_name AS categoryName, c.parent_id AS parentId,
             COUNT(m.message_id) AS messageCount,
             MAX(m.created_at) AS lastMessageAt
      FROM discord_channels c
      LEFT JOIN discord_servers s ON s.guild_id = c.guild_id
      LEFT JOIN discord_messages m ON m.channel_id = c.channel_id
      WHERE c.is_active = 1 AND COALESCE(s.is_active, 1) = 1
      GROUP BY c.channel_id
      ORDER BY messageCount DESC, c.name ASC
    `).all() as any[];

    const groupRows = this.db.prepare(`
      SELECT gm.channel_id AS channelId, g.group_key AS groupKey, g.display_name AS displayName, g.agent_key AS agentKey
      FROM discord_channel_group_members gm
      JOIN discord_channel_groups g ON g.group_key = gm.group_key
      ORDER BY g.agent_key, g.display_name
    `).all() as any[];
    const groupsByChannel = new Map<string, any[]>();
    for (const row of groupRows) {
      const list = groupsByChannel.get(row.channelId) ?? [];
      list.push({ groupKey: row.groupKey, displayName: row.displayName, agentKey: row.agentKey });
      groupsByChannel.set(row.channelId, list);
    }
    return rows.map((r) => ({ ...r, groups: groupsByChannel.get(r.channelId) ?? [] }));
  }

  getChannelTree(): Array<{
    guildId: string | null;
    guildName: string | null;
    channelCount: number;
    categories: Array<{
      categoryKey: string;
      categoryName: string;
      channelCount: number;
      parentId: string | null;
      channels: Array<{
        channelId: string;
        name: string | null;
        messageCount: number;
        lastMessageAt: number | null;
        groups: Array<{ groupKey: string; displayName: string; agentKey: string | null }>;
        clickupMappings: Array<Pick<ClickUpMapping, 'id' | 'clickupProjectId' | 'clickupProjectName' | 'folderId' | 'listId' | 'agentKey' | 'isActive'>>;
      }>;
    }>;
  }> {
    const channels = this.listChannels();
    const channelMappings = this._clickupMappingsByChannel();
    const guildMap = new Map<string, any>();
    for (const ch of channels) {
      const guildKey = ch.guildId ?? '__unknown_guild__';
      let guild = guildMap.get(guildKey);
      if (!guild) {
        guild = {
          guildId: ch.guildId,
          guildName: ch.guildName ?? 'Unknown Server',
          channelCount: 0,
          categories: [],
          _categoryMap: new Map<string, any>(),
        };
        guildMap.set(guildKey, guild);
      }
      const categoryName = ch.categoryName ?? 'No Category';
      const categoryKey = `${guildKey}:${categoryName}`;
      let category = guild._categoryMap.get(categoryKey);
      if (!category) {
        category = { categoryKey, categoryName, parentId: ch.parentId, channelCount: 0, channels: [] };
        guild._categoryMap.set(categoryKey, category);
        guild.categories.push(category);
      }
      category.channels.push({
        channelId: ch.channelId,
        name: ch.name,
        messageCount: ch.messageCount,
        lastMessageAt: ch.lastMessageAt,
        groups: ch.groups,
        clickupMappings: channelMappings.get(ch.channelId) ?? [],
      });
      category.channelCount += 1;
      guild.channelCount += 1;
    }
    return [...guildMap.values()].map((guild) => {
      guild.categories.sort((a: any, b: any) => a.categoryName.localeCompare(b.categoryName));
      for (const category of guild.categories) {
        category.channels.sort((a: any, b: any) => (a.name ?? a.channelId).localeCompare(b.name ?? b.channelId));
      }
      delete guild._categoryMap;
      return guild;
    }).sort((a, b) => (a.guildName ?? '').localeCompare(b.guildName ?? ''));
  }

  listGroups(): Array<{
    groupKey: string;
    displayName: string;
    agentKey: string | null;
    description: string | null;
    channelCount: number;
    channels: Array<{ channelId: string; name: string | null; guildName: string | null }>;
    policies: ChatStorageGroupPolicy[];
  }> {
    const groups = this.db.prepare(`
      SELECT g.group_key AS groupKey, g.display_name AS displayName, g.agent_key AS agentKey,
             g.description, COUNT(gm.channel_id) AS channelCount
      FROM discord_channel_groups g
      LEFT JOIN discord_channel_group_members gm ON gm.group_key = g.group_key
      GROUP BY g.group_key
      ORDER BY g.agent_key, g.display_name
    `).all() as any[];
    const channels = this.db.prepare(`
      SELECT gm.group_key AS groupKey, c.channel_id AS channelId, c.name, s.name AS guildName
      FROM discord_channel_group_members gm
      JOIN discord_channels c ON c.channel_id = gm.channel_id
      LEFT JOIN discord_servers s ON s.guild_id = c.guild_id
      ORDER BY s.name, c.name
    `).all() as any[];
    const byGroup = new Map<string, any[]>();
    for (const ch of channels) {
      const list = byGroup.get(ch.groupKey) ?? [];
      list.push({ channelId: ch.channelId, name: ch.name, guildName: ch.guildName });
      byGroup.set(ch.groupKey, list);
    }
    const policies = this.db.prepare(`
      SELECT id, group_key AS groupKey, scope_type AS scopeType, guild_id AS guildId,
             parent_id AS parentId, category_name AS categoryName, channel_id AS channelId,
             created_at AS createdAt, updated_at AS updatedAt
      FROM discord_channel_group_policies
      ORDER BY scope_type, guild_id, category_name, channel_id
    `).all() as ChatStorageGroupPolicy[];
    const policiesByGroup = new Map<string, ChatStorageGroupPolicy[]>();
    for (const policy of policies) {
      const list = policiesByGroup.get(policy.groupKey) ?? [];
      list.push(policy);
      policiesByGroup.set(policy.groupKey, list);
    }
    return groups.map((g) => ({ ...g, channels: byGroup.get(g.groupKey) ?? [], policies: policiesByGroup.get(g.groupKey) ?? [] }));
  }

  upsertGroup(input: ChatStorageGroupInput): void {
    const groupKey = input.groupKey.trim();
    if (!groupKey) throw new Error('groupKey required');
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO discord_channel_groups (group_key, display_name, description, agent_key, created_at, updated_at)
      VALUES (@groupKey, @displayName, @description, @agentKey, @now, @now)
      ON CONFLICT(group_key) DO UPDATE SET
        display_name = excluded.display_name,
        description = excluded.description,
        agent_key = excluded.agent_key,
        updated_at = excluded.updated_at
    `).run({
      groupKey,
      displayName: input.displayName?.trim() || groupKey,
      description: input.description ?? '',
      agentKey: input.agentKey?.trim() || null,
      now,
    });
  }

  deleteGroup(groupKey: string): void {
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM discord_channel_group_members WHERE group_key = ?').run(groupKey);
      this.db.prepare('DELETE FROM discord_channel_groups WHERE group_key = ?').run(groupKey);
    });
    tx();
  }

  setGroupChannels(groupKey: string, channelIds: string[]): void {
    const now = Date.now();
    const ids = [...new Set(channelIds.map((id) => id.trim()).filter(Boolean))];
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM discord_channel_group_members WHERE group_key = ?').run(groupKey);
      this.db.prepare('DELETE FROM discord_channel_group_policies WHERE group_key = ?').run(groupKey);
      const insert = this.db.prepare(`
        INSERT OR IGNORE INTO discord_channel_group_members (group_key, channel_id, created_at)
        VALUES (?, ?, ?)
      `);
      for (const channelId of ids) insert.run(groupKey, channelId, now);
    });
    tx();
  }

  setGroupAssignmentPolicies(groupKey: string, policies: ChatStorageGroupPolicyInput[]): void {
    const now = Date.now();
    const normalized = policies
      .filter((policy) => ['guild', 'category', 'channel'].includes(policy.scopeType))
      .map((policy) => ({
        scopeType: policy.scopeType,
        guildId: policy.guildId?.trim() || null,
        parentId: policy.parentId?.trim() || null,
        categoryName: policy.categoryName?.trim() || null,
        channelId: policy.channelId?.trim() || null,
      }))
      .filter((policy) => {
        if (policy.scopeType === 'guild') return Boolean(policy.guildId);
        if (policy.scopeType === 'category') return Boolean(policy.guildId) && Boolean(policy.parentId || policy.categoryName);
        return Boolean(policy.channelId);
      });

    const expandedChannelIds = this.expandPoliciesToChannelIds(normalized);
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM discord_channel_group_policies WHERE group_key = ?').run(groupKey);
      this.db.prepare('DELETE FROM discord_channel_group_members WHERE group_key = ?').run(groupKey);
      const insertPolicy = this.db.prepare(`
        INSERT INTO discord_channel_group_policies (
          group_key, scope_type, guild_id, parent_id, category_name, channel_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const policy of normalized) {
        insertPolicy.run(groupKey, policy.scopeType, policy.guildId, policy.parentId, policy.categoryName, policy.channelId, now, now);
      }
      const insertMember = this.db.prepare(`
        INSERT OR IGNORE INTO discord_channel_group_members (group_key, channel_id, created_at)
        VALUES (?, ?, ?)
      `);
      for (const channelId of expandedChannelIds) insertMember.run(groupKey, channelId, now);
    });
    tx();
  }

  private expandPoliciesToChannelIds(policies: ChatStorageGroupPolicyInput[]): string[] {
    const ids = new Set<string>();
    const byGuild = this.db.prepare(`
      SELECT channel_id AS channelId FROM discord_channels
      WHERE guild_id = ? AND is_active = 1
    `);
    const byCategoryParent = this.db.prepare(`
      SELECT channel_id AS channelId FROM discord_channels
      WHERE guild_id = ? AND parent_id = ? AND is_active = 1
    `);
    const byCategoryName = this.db.prepare(`
      SELECT channel_id AS channelId FROM discord_channels
      WHERE guild_id = ? AND category_name = ? AND is_active = 1
    `);
    const byChannel = this.db.prepare(`
      SELECT channel_id AS channelId FROM discord_channels
      WHERE channel_id = ? AND is_active = 1
    `);

    for (const policy of policies) {
      let rows: Array<{ channelId: string }> = [];
      if (policy.scopeType === 'guild' && policy.guildId) rows = byGuild.all(policy.guildId) as Array<{ channelId: string }>;
      if (policy.scopeType === 'category' && policy.guildId) {
        rows = policy.parentId
          ? byCategoryParent.all(policy.guildId, policy.parentId) as Array<{ channelId: string }>
          : byCategoryName.all(policy.guildId, policy.categoryName) as Array<{ channelId: string }>;
      }
      if (policy.scopeType === 'channel' && policy.channelId) rows = byChannel.all(policy.channelId) as Array<{ channelId: string }>;
      for (const row of rows) ids.add(row.channelId);
    }
    return [...ids];
  }

  private refreshGroupMembersFromPolicies(): void {
    const groupKeys = this.db.prepare('SELECT DISTINCT group_key AS groupKey FROM discord_channel_group_policies').all() as Array<{ groupKey: string }>;
    const selectPolicies = this.db.prepare(`
      SELECT scope_type AS scopeType, guild_id AS guildId, parent_id AS parentId,
             category_name AS categoryName, channel_id AS channelId
      FROM discord_channel_group_policies
      WHERE group_key = ?
    `);
    const now = Date.now();
    const tx = this.db.transaction(() => {
      const insertMember = this.db.prepare(`
        INSERT OR IGNORE INTO discord_channel_group_members (group_key, channel_id, created_at)
        VALUES (?, ?, ?)
      `);
      for (const row of groupKeys) {
        const policies = selectPolicies.all(row.groupKey) as ChatStorageGroupPolicyInput[];
        const expandedChannelIds = this.expandPoliciesToChannelIds(policies);
        this.db.prepare('DELETE FROM discord_channel_group_members WHERE group_key = ?').run(row.groupKey);
        for (const channelId of expandedChannelIds) insertMember.run(row.groupKey, channelId, now);
      }
    });
    tx();
  }

  syncAgentAccessFromGroups(): { upserted: number } {
    const now = Date.now();
    this.refreshGroupMembersFromPolicies();
    const rows = this.db.prepare(`
      SELECT DISTINCT g.agent_key AS agentKey, gm.channel_id AS channelId, c.guild_id AS guildId, g.display_name AS groupName
      FROM discord_channel_groups g
      JOIN discord_channel_group_members gm ON gm.group_key = g.group_key
      JOIN discord_channels c ON c.channel_id = gm.channel_id
      LEFT JOIN discord_servers s ON s.guild_id = c.guild_id
      WHERE g.agent_key IS NOT NULL AND g.agent_key != ''
        AND c.is_active = 1 AND COALESCE(s.is_active, 1) = 1
    `).all() as any[];
    const agentRows = this.db.prepare(`
      SELECT DISTINCT agent_key AS agentKey
      FROM discord_channel_groups
      WHERE agent_key IS NOT NULL AND agent_key != ''
    `).all() as Array<{ agentKey: string }>;
    const tx = this.db.transaction(() => {
      for (const agent of agentRows) {
        this.db
          .prepare('UPDATE discord_agent_channel_access SET is_active = 0, updated_at = ? WHERE agent_key = ?')
          .run(now, agent.agentKey);
      }
      for (const row of rows) {
        this.db.prepare(`
          INSERT INTO discord_agents (agent_key, profile_name, display_name, is_active, created_at, updated_at)
          VALUES (?, NULL, ?, 1, ?, ?)
          ON CONFLICT(agent_key) DO UPDATE SET display_name = COALESCE(discord_agents.display_name, excluded.display_name), updated_at = excluded.updated_at
        `).run(row.agentKey, row.agentKey.toUpperCase(), now, now);
        this.db.prepare(`
          INSERT INTO discord_agent_channel_access (agent_key, guild_id, channel_id, access_level, purpose, is_active, created_at, updated_at)
          VALUES (?, ?, ?, 'read', ?, 1, ?, ?)
          ON CONFLICT(agent_key, channel_id) DO UPDATE SET
            guild_id = excluded.guild_id,
            access_level = excluded.access_level,
            purpose = excluded.purpose,
            is_active = 1,
            updated_at = excluded.updated_at
        `).run(row.agentKey, row.guildId, row.channelId, `Synced from group: ${row.groupName}`, now, now);
      }
    });
    tx();
    return { upserted: rows.length };
  }

  // ── ClickUp Mapping CRUD ───────────────────────────────────────────────────

  upsertClickUpMapping(input: ClickUpMappingInput): number {
    const now = Date.now();
    const scopeKey = buildScopeKey(input);
    const result = this.db.prepare(`
      INSERT INTO discord_clickup_mappings
        (scope_key, scope_type, guild_id, parent_id, category_name, channel_id,
         clickup_project_id, clickup_project_name, folder_id, list_id, agent_key,
         is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(scope_key, agent_key) DO UPDATE SET
        scope_type           = excluded.scope_type,
        guild_id             = excluded.guild_id,
        parent_id            = excluded.parent_id,
        category_name        = excluded.category_name,
        channel_id           = excluded.channel_id,
        clickup_project_id   = excluded.clickup_project_id,
        clickup_project_name = excluded.clickup_project_name,
        folder_id            = excluded.folder_id,
        list_id              = excluded.list_id,
        is_active            = 1,
        updated_at           = excluded.updated_at
    `).run(
      scopeKey,
      input.scopeType,
      input.guildId ?? null,
      input.parentId ?? null,
      input.categoryName ?? null,
      input.channelId ?? null,
      input.clickupProjectId.trim(),
      input.clickupProjectName.trim(),
      input.folderId ?? null,
      input.listId ?? null,
      input.agentKey.trim(),
      now,
      now,
    );
    if (result.changes === 0) {
      const row = this.db.prepare('SELECT id FROM discord_clickup_mappings WHERE scope_key = ? AND agent_key = ?').get(scopeKey, input.agentKey.trim()) as { id: number } | undefined;
      return row?.id ?? 0;
    }
    return Number(result.lastInsertRowid);
  }

  listClickUpMappings(agentKey?: string): ClickUpMapping[] {
    const sql = `
      SELECT id, scope_key AS scopeKey, scope_type AS scopeType,
             guild_id AS guildId, parent_id AS parentId, category_name AS categoryName,
             channel_id AS channelId, clickup_project_id AS clickupProjectId,
             clickup_project_name AS clickupProjectName, folder_id AS folderId,
             list_id AS listId, agent_key AS agentKey, is_active AS isActive,
             created_at AS createdAt, updated_at AS updatedAt
      FROM discord_clickup_mappings
      ${agentKey ? 'WHERE agent_key = ?' : ''}
      ORDER BY scope_type, agent_key, clickup_project_name
    `;
    return (agentKey
      ? this.db.prepare(sql).all(agentKey)
      : this.db.prepare(sql).all()) as ClickUpMapping[];
  }

  deleteClickUpMapping(id: number): void {
    this.db.prepare('DELETE FROM discord_clickup_mappings WHERE id = ?').run(id);
  }

  toggleClickUpMapping(id: number, isActive: boolean): void {
    this.db.prepare('UPDATE discord_clickup_mappings SET is_active = ?, updated_at = ? WHERE id = ?').run(isActive ? 1 : 0, Date.now(), id);
  }

  private _clickupMappingsByChannel(): Map<string, ClickUpMapping[]> {
    const rows = this.db.prepare(`
      SELECT id, scope_key AS scopeKey, scope_type AS scopeType,
             guild_id AS guildId, parent_id AS parentId, category_name AS categoryName,
             channel_id AS channelId, clickup_project_id AS clickupProjectId,
             clickup_project_name AS clickupProjectName, folder_id AS folderId,
             list_id AS listId, agent_key AS agentKey, is_active AS isActive,
             created_at AS createdAt, updated_at AS updatedAt
      FROM discord_clickup_mappings
      WHERE scope_type = 'channel' AND channel_id IS NOT NULL
      ORDER BY agent_key, clickup_project_name
    `).all() as ClickUpMapping[];
    const map = new Map<string, ClickUpMapping[]>();
    for (const row of rows) {
      const list = map.get(row.channelId!) ?? [];
      list.push(row);
      map.set(row.channelId!, list);
    }
    return map;
  }
}
