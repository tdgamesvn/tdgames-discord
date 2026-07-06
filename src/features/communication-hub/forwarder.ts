import type { Channel, Client, Guild, Message, PartialMessage } from 'discord.js';
import type { Config } from '../../config';
import type { ErrorReporter } from '../../shared/errorReporter';

type EventPayload = Record<string, unknown> & { eventType: string };

function collectionToArray<T = any>(value: any): T[] {
  if (!value) return [];
  if (Array.isArray(value)) return value as T[];
  if (typeof value.map === 'function') {
    try {
      const mapped = value.map((item: T) => item);
      return Array.isArray(mapped) ? mapped : [...mapped.values?.() ?? []];
    } catch {}
  }
  if (typeof value.values === 'function') return [...value.values()];
  return [];
}

function channelSnapshot(channel: Channel | Record<string, any>): Record<string, unknown> {
  const c = channel as any;
  return {
    guildId: c.guildId ?? c.guild?.id ?? null,
    guildName: c.guild?.name ?? null,
    channelId: c.id ?? null,
    channelName: typeof c.name === 'string' ? c.name : null,
    channelType: c.type ?? null,
    parentId: typeof c.parentId === 'string' ? c.parentId : null,
    categoryName: typeof c.parent?.name === 'string' ? c.parent.name : null,
    isThread: typeof c.isThread === 'function' ? c.isThread() : false,
  };
}

function messageSnapshot(message: Message | PartialMessage | Record<string, any>): Record<string, unknown> {
  const m = message as any;
  const author = m.author ?? {};
  return {
    ...channelSnapshot(m.channel ?? {}),
    guildId: m.guildId ?? m.guild?.id ?? null,
    guildName: m.guild?.name ?? null,
    channelId: m.channelId ?? m.channel?.id ?? null,
    messageId: m.id ?? null,
    authorId: author.id != null ? String(author.id) : null,
    authorName: author.username ?? null,
    authorGlobalName: author.globalName ?? null,
    authorIsBot: Boolean(author.bot),
    content: typeof m.content === 'string' ? m.content : '',
    cleanContent: typeof m.cleanContent === 'string' ? m.cleanContent : (typeof m.content === 'string' ? m.content : ''),
    attachments: collectionToArray<any>(m.attachments).map((a) => ({
      id: String(a.id ?? ''),
      name: a.name ?? null,
      url: a.url ?? null,
      proxy_url: a.proxyURL ?? a.proxy_url ?? null,
      content_type: a.contentType ?? a.content_type ?? null,
      size: typeof a.size === 'number' ? a.size : null,
    })),
    embeds: collectionToArray<any>(m.embeds).map((e) => typeof e?.toJSON === 'function' ? e.toJSON() : e),
    mentions: {
      users: collectionToArray<any>(m.mentions?.users).map((u) => ({ id: String(u.id ?? ''), username: u.username ?? null, global_name: u.globalName ?? null, bot: Boolean(u.bot) })),
      roles: collectionToArray<any>(m.mentions?.roles).map((r) => ({ id: String(r.id ?? ''), name: r.name ?? null })),
      channels: collectionToArray<any>(m.mentions?.channels).map((ch) => ({ id: String(ch.id ?? ''), name: ch.name ?? null })),
    },
    threadId: m.channel?.isThread?.() ? String(m.channelId ?? m.channel?.id) : null,
    messageType: m.type ?? null,
    url: m.url ?? null,
    createdAt: typeof m.createdTimestamp === 'number' ? m.createdTimestamp : Date.now(),
    editedAt: typeof m.editedTimestamp === 'number' ? m.editedTimestamp : null,
  };
}

async function postEvent(url: string, payload: EventPayload, errorReporter: ErrorReporter): Promise<void> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Communication Hub ingest ${response.status}: ${text.slice(0, 500)}`);
    }
  } catch (error) {
    await errorReporter.report(error, {
      source: 'communication-hub-forwarder',
      eventType: payload.eventType,
      ...(payload.channelId != null ? { channelId: String(payload.channelId) } : {}),
      ...(payload.messageId != null ? { messageId: String(payload.messageId) } : {}),
    });
  }
}

export function registerCommunicationHubForwarder(
  client: Pick<Client, 'on'>,
  config: Config['communicationHub'],
  errorReporter: ErrorReporter,
): void {
  if (!config.ingestEnabled) {
    console.log('[communication-hub] realtime ingest disabled');
    return;
  }
  const send = (payload: EventPayload) => { void postEvent(config.ingestUrl, payload, errorReporter); };

  client.on('messageCreate', (message: Message) => send({ eventType: 'messageCreate', ...messageSnapshot(message), raw: messageSnapshot(message) }));
  client.on('messageUpdate', (_oldMessage: Message | PartialMessage, newMessage: Message | PartialMessage) => send({ eventType: 'messageUpdate', ...messageSnapshot(newMessage), raw: messageSnapshot(newMessage) }));
  client.on('messageDelete', (message: Message | PartialMessage) => send({ eventType: 'messageDelete', ...messageSnapshot(message), deletedAt: Date.now(), raw: messageSnapshot(message) }));

  client.on('channelCreate', (channel: Channel) => send({ eventType: 'channelCreate', ...channelSnapshot(channel), raw: channelSnapshot(channel) }));
  client.on('channelUpdate', (_oldChannel: Channel, newChannel: Channel) => send({ eventType: 'channelUpdate', ...channelSnapshot(newChannel), raw: channelSnapshot(newChannel) }));
  client.on('channelDelete', (channel: Channel) => send({ eventType: 'channelDelete', ...channelSnapshot(channel), raw: channelSnapshot(channel) }));

  client.on('guildCreate', (guild: Guild) => send({ eventType: 'guildCreate', guildId: guild.id, guildName: guild.name, raw: { id: guild.id, name: guild.name } }));
  client.on('guildUpdate', (_oldGuild: Guild, newGuild: Guild) => send({ eventType: 'guildUpdate', guildId: newGuild.id, guildName: newGuild.name, raw: { id: newGuild.id, name: newGuild.name } }));
  client.on('guildDelete', (guild: Guild) => send({ eventType: 'guildDelete', guildId: guild.id, guildName: guild.name, raw: { id: guild.id, name: guild.name } }));

  console.log(`[communication-hub] realtime ingest enabled → ${config.ingestUrl}`);
}
