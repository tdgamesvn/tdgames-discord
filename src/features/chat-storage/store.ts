import type Database from 'better-sqlite3';
import type { Message, PartialMessage } from 'discord.js';
import { ChatStorageAdminStore } from './admin';

type AnyDiscordMessage = Message | PartialMessage | Record<string, any>;

export interface SerializedAttachment {
  id: string;
  name: string | null;
  url: string | null;
  proxy_url: string | null;
  content_type: string | null;
  size: number | null;
}

function collectionToArray<T = any>(value: any): T[] {
  if (!value) return [];
  if (Array.isArray(value)) return value as T[];
  if (typeof value.map === 'function') {
    try {
      const mapped = value.map((item: T) => item);
      return Array.isArray(mapped) ? mapped : [...mapped.values?.() ?? []];
    } catch {
      // Fall through to values()
    }
  }
  if (typeof value.values === 'function') return [...value.values()];
  return [];
}

function jsonStringify(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function timestampFromMessage(message: AnyDiscordMessage): number {
  return typeof message.createdTimestamp === 'number' ? message.createdTimestamp : Date.now();
}

function getChannelName(channel: any): string | null {
  return typeof channel?.name === 'string' ? channel.name : null;
}

function getChannelParentName(channel: any): string | null {
  return typeof channel?.parent?.name === 'string' ? channel.parent.name : null;
}

function getChannelParentId(channel: any): string | null {
  return typeof channel?.parentId === 'string' ? channel.parentId : null;
}

function serializeAttachments(message: AnyDiscordMessage): SerializedAttachment[] {
  return collectionToArray<any>(message.attachments).map((attachment) => ({
    id: String(attachment.id ?? ''),
    name: attachment.name ?? null,
    url: attachment.url ?? null,
    proxy_url: attachment.proxyURL ?? attachment.proxy_url ?? null,
    content_type: attachment.contentType ?? attachment.content_type ?? null,
    size: typeof attachment.size === 'number' ? attachment.size : null,
  }));
}

function serializeEmbeds(message: AnyDiscordMessage): unknown[] {
  return collectionToArray(message.embeds).map((embed: any) => {
    if (typeof embed?.toJSON === 'function') return embed.toJSON();
    return embed;
  });
}

function serializeMentions(message: AnyDiscordMessage): Record<string, unknown[]> {
  const mentions = message.mentions ?? {};
  return {
    users: collectionToArray<any>(mentions.users).map((user) => ({
      id: String(user.id ?? ''),
      username: user.username ?? null,
      global_name: user.globalName ?? null,
      bot: Boolean(user.bot),
    })),
    roles: collectionToArray<any>(mentions.roles).map((role) => ({
      id: String(role.id ?? ''),
      name: role.name ?? null,
    })),
    channels: collectionToArray<any>(mentions.channels).map((channel) => ({
      id: String(channel.id ?? ''),
      name: channel.name ?? null,
    })),
  };
}

function serializeRaw(message: AnyDiscordMessage): Record<string, unknown> {
  return {
    id: message.id ?? null,
    guild_id: message.guildId ?? message.guild?.id ?? null,
    channel_id: message.channelId ?? message.channel?.id ?? null,
    type: message.type ?? null,
    system: Boolean(message.system),
    pinned: Boolean(message.pinned),
    tts: Boolean(message.tts),
    url: message.url ?? null,
    created_timestamp: message.createdTimestamp ?? null,
    edited_timestamp: message.editedTimestamp ?? null,
  };
}

export class ChatStorageStore {
  constructor(private readonly db: Database.Database) {}

  saveGuildSnapshot(guild: Record<string, any>): void {
    const guildId = guild.id ?? guild.guildId;
    if (!guildId) return;
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO discord_servers (guild_id, name, is_active, created_at, updated_at)
      VALUES (@guild_id, @name, 1, @now, @now)
      ON CONFLICT(guild_id) DO UPDATE SET
        name = COALESCE(excluded.name, discord_servers.name),
        is_active = 1,
        updated_at = excluded.updated_at
    `).run({
      guild_id: String(guildId),
      name: guild.name ?? null,
      now,
    });
  }

  markGuildInactive(guildId: string): void {
    if (!guildId) return;
    const now = Date.now();
    const tx = this.db.transaction(() => {
      this.db
        .prepare('UPDATE discord_servers SET is_active = 0, updated_at = ? WHERE guild_id = ?')
        .run(now, String(guildId));
      this.db
        .prepare('UPDATE discord_channels SET is_active = 0, updated_at = ? WHERE guild_id = ?')
        .run(now, String(guildId));
    });
    tx();
  }

  saveChannelSnapshot(channel: Record<string, any>): void {
    const now = Date.now();
    const guildId = channel.guildId ?? channel.guild?.id ?? null;
    if (guildId) {
      this.saveGuildSnapshot({ id: guildId, name: channel.guild?.name ?? null });
    }
    const channelId = channel.id;
    if (!channelId) return;
    const isThread = typeof channel.isThread === 'function' ? channel.isThread() : false;
    this.db.prepare(`
      INSERT INTO discord_channels (
        channel_id, guild_id, name, type, parent_id, category_name, is_thread, is_active, created_at, updated_at
      ) VALUES (
        @channel_id, @guild_id, @name, @type, @parent_id, @category_name, @is_thread, 1, @now, @now
      )
      ON CONFLICT(channel_id) DO UPDATE SET
        guild_id = COALESCE(excluded.guild_id, discord_channels.guild_id),
        name = COALESCE(excluded.name, discord_channels.name),
        type = COALESCE(excluded.type, discord_channels.type),
        parent_id = COALESCE(excluded.parent_id, discord_channels.parent_id),
        category_name = COALESCE(excluded.category_name, discord_channels.category_name),
        is_thread = excluded.is_thread,
        is_active = 1,
        updated_at = excluded.updated_at
    `).run({
      channel_id: String(channelId),
      guild_id: guildId != null ? String(guildId) : null,
      name: getChannelName(channel),
      type: channel.type != null ? String(channel.type) : null,
      parent_id: getChannelParentId(channel),
      category_name: getChannelParentName(channel),
      is_thread: isThread ? 1 : 0,
      now,
    });
  }

  markChannelInactive(channelId: string): void {
    if (!channelId) return;
    this.db
      .prepare('UPDATE discord_channels SET is_active = 0, updated_at = ? WHERE channel_id = ?')
      .run(Date.now(), String(channelId));
  }

  syncAgentAccessFromPolicies(): { upserted: number } {
    return new ChatStorageAdminStore(this.db).syncAgentAccessFromGroups();
  }

  saveMessageCreate(message: AnyDiscordMessage): void {
    this.upsertServer(message);
    this.upsertChannel(message);
    this.upsertMessage(message, null);
    this.insertEvent('create', message);
  }

  saveMessageUpdate(message: AnyDiscordMessage): void {
    this.upsertServer(message);
    this.upsertChannel(message);
    this.upsertMessage(message, null);
    this.insertEvent('update', message);
  }

  saveMessageDelete(message: AnyDiscordMessage): void {
    const deletedAt = Date.now();
    const messageId = String(message.id ?? '');
    if (!messageId) return;

    const existing = this.db
      .prepare('SELECT message_id FROM discord_messages WHERE message_id = ?')
      .get(messageId);

    if (existing) {
      this.db
        .prepare('UPDATE discord_messages SET deleted_at = ?, ingested_at = ? WHERE message_id = ?')
        .run(deletedAt, Date.now(), messageId);
    } else {
      this.upsertServer(message);
      this.upsertChannel(message);
      this.upsertMessage(message, deletedAt);
    }

    this.insertEvent('delete', message);
  }

  private upsertServer(message: AnyDiscordMessage): void {
    const guildId = message.guildId ?? message.guild?.id;
    if (!guildId) return;
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO discord_servers (guild_id, name, is_active, created_at, updated_at)
      VALUES (@guild_id, @name, 1, @now, @now)
      ON CONFLICT(guild_id) DO UPDATE SET
        name = COALESCE(excluded.name, discord_servers.name),
        is_active = 1,
        updated_at = excluded.updated_at
    `).run({
      guild_id: String(guildId),
      name: message.guild?.name ?? null,
      now,
    });
  }

  private upsertChannel(message: AnyDiscordMessage): void {
    const channelId = message.channelId ?? message.channel?.id;
    if (!channelId) return;
    const now = Date.now();
    const channel = message.channel ?? {};
    const isThread = typeof channel.isThread === 'function' ? channel.isThread() : false;
    this.db.prepare(`
      INSERT INTO discord_channels (
        channel_id, guild_id, name, type, parent_id, category_name, is_thread, is_active, created_at, updated_at
      ) VALUES (
        @channel_id, @guild_id, @name, @type, @parent_id, @category_name, @is_thread, 1, @now, @now
      )
      ON CONFLICT(channel_id) DO UPDATE SET
        guild_id = COALESCE(excluded.guild_id, discord_channels.guild_id),
        name = COALESCE(excluded.name, discord_channels.name),
        type = COALESCE(excluded.type, discord_channels.type),
        parent_id = COALESCE(excluded.parent_id, discord_channels.parent_id),
        category_name = COALESCE(excluded.category_name, discord_channels.category_name),
        is_thread = excluded.is_thread,
        is_active = 1,
        updated_at = excluded.updated_at
    `).run({
      channel_id: String(channelId),
      guild_id: message.guildId ?? message.guild?.id ?? null,
      name: getChannelName(channel),
      type: channel.type != null ? String(channel.type) : null,
      parent_id: getChannelParentId(channel),
      category_name: getChannelParentName(channel),
      is_thread: isThread ? 1 : 0,
      now,
    });
  }

  private upsertMessage(message: AnyDiscordMessage, deletedAt: number | null): void {
    const messageId = String(message.id ?? '');
    const channelId = message.channelId ?? message.channel?.id;
    if (!messageId || !channelId) return;

    const author = message.author ?? {};
    const createdAt = timestampFromMessage(message);
    const ingestedAt = Date.now();

    this.db.prepare(`
      INSERT INTO discord_messages (
        message_id, guild_id, channel_id, author_id, author_name, author_global_name, author_is_bot,
        content, clean_content, attachments, embeds, mentions, reply_to_message_id, thread_id,
        message_type, url, created_at, edited_at, deleted_at, ingested_at, raw
      ) VALUES (
        @message_id, @guild_id, @channel_id, @author_id, @author_name, @author_global_name, @author_is_bot,
        @content, @clean_content, @attachments, @embeds, @mentions, @reply_to_message_id, @thread_id,
        @message_type, @url, @created_at, @edited_at, @deleted_at, @ingested_at, @raw
      )
      ON CONFLICT(message_id) DO UPDATE SET
        guild_id = COALESCE(excluded.guild_id, discord_messages.guild_id),
        channel_id = excluded.channel_id,
        author_id = COALESCE(excluded.author_id, discord_messages.author_id),
        author_name = COALESCE(excluded.author_name, discord_messages.author_name),
        author_global_name = COALESCE(excluded.author_global_name, discord_messages.author_global_name),
        author_is_bot = excluded.author_is_bot,
        content = COALESCE(excluded.content, discord_messages.content),
        clean_content = COALESCE(excluded.clean_content, discord_messages.clean_content),
        attachments = excluded.attachments,
        embeds = excluded.embeds,
        mentions = excluded.mentions,
        reply_to_message_id = COALESCE(excluded.reply_to_message_id, discord_messages.reply_to_message_id),
        thread_id = COALESCE(excluded.thread_id, discord_messages.thread_id),
        message_type = COALESCE(excluded.message_type, discord_messages.message_type),
        url = COALESCE(excluded.url, discord_messages.url),
        edited_at = COALESCE(excluded.edited_at, discord_messages.edited_at),
        deleted_at = excluded.deleted_at,
        ingested_at = excluded.ingested_at,
        raw = excluded.raw
    `).run({
      message_id: messageId,
      guild_id: message.guildId ?? message.guild?.id ?? null,
      channel_id: String(channelId),
      author_id: author.id != null ? String(author.id) : null,
      author_name: author.username ?? null,
      author_global_name: author.globalName ?? null,
      author_is_bot: author.bot ? 1 : 0,
      content: typeof message.content === 'string' ? message.content : null,
      clean_content: typeof message.cleanContent === 'string' ? message.cleanContent : null,
      attachments: jsonStringify(serializeAttachments(message)),
      embeds: jsonStringify(serializeEmbeds(message)),
      mentions: jsonStringify(serializeMentions(message)),
      reply_to_message_id: message.reference?.messageId ?? null,
      thread_id: message.channel?.isThread?.() ? String(channelId) : null,
      message_type: message.type != null ? String(message.type) : null,
      url: message.url ?? null,
      created_at: createdAt,
      edited_at: typeof message.editedTimestamp === 'number' ? message.editedTimestamp : null,
      deleted_at: deletedAt,
      ingested_at: ingestedAt,
      raw: jsonStringify(serializeRaw(message)),
    });
  }

  private insertEvent(eventType: 'create' | 'update' | 'delete', message: AnyDiscordMessage): void {
    const messageId = String(message.id ?? '');
    if (!messageId) return;
    this.db.prepare(`
      INSERT INTO discord_message_events (
        event_type, message_id, guild_id, channel_id, event_at, raw
      ) VALUES (
        @event_type, @message_id, @guild_id, @channel_id, @event_at, @raw
      )
    `).run({
      event_type: eventType,
      message_id: messageId,
      guild_id: message.guildId ?? message.guild?.id ?? null,
      channel_id: message.channelId ?? message.channel?.id ?? null,
      event_at: Date.now(),
      raw: jsonStringify(serializeRaw(message)),
    });
  }
}
