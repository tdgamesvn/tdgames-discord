import type { Channel, Client, Guild, Message, PartialMessage } from 'discord.js';
import type { ErrorReporter } from '../../shared/errorReporter';
import { ChatStorageStore } from './store';

export interface ChatStorageConfig {
  enabled: boolean;
  includeBotMessages?: boolean;
}

type StorableMessage = Message | PartialMessage | Record<string, any>;
type StorableResource = StorableMessage | Channel | Guild | Record<string, any>;

function shouldStore(message: StorableMessage, config: ChatStorageConfig): boolean {
  if (!config.enabled) return false;
  if (!config.includeBotMessages && message.author?.bot) return false;
  return true;
}

function reportStorageError(
  errorReporter: ErrorReporter,
  error: unknown,
  source: string,
  resource: StorableResource,
): void {
  const value = resource as Record<string, any>;
  void errorReporter.report(error, {
    source,
    messageId: value.channelId ? value.id : undefined,
    channelId: value.channelId ?? value.channel?.id ?? value.id,
    guildId: value.guildId ?? value.guild?.id ?? (value.channels ? value.id : undefined),
  });
}

export function registerChatStorageEvents(
  client: Pick<Client, 'on'>,
  store: ChatStorageStore,
  config: ChatStorageConfig,
  errorReporter: ErrorReporter,
): void {
  if (!config.enabled) {
    console.log('[chat-storage] disabled');
    return;
  }

  client.on('messageCreate', (message: Message) => {
    if (!shouldStore(message, config)) return;
    try {
      store.saveMessageCreate(message);
    } catch (error) {
      reportStorageError(errorReporter, error, 'chat-storage:messageCreate', message);
    }
  });

  client.on('messageUpdate', (_oldMessage: Message | PartialMessage, newMessage: Message | PartialMessage) => {
    if (!shouldStore(newMessage, config)) return;
    try {
      store.saveMessageUpdate(newMessage);
    } catch (error) {
      reportStorageError(errorReporter, error, 'chat-storage:messageUpdate', newMessage);
    }
  });

  client.on('messageDelete', (message: Message | PartialMessage) => {
    if (!shouldStore(message, config)) return;
    try {
      store.saveMessageDelete(message);
    } catch (error) {
      reportStorageError(errorReporter, error, 'chat-storage:messageDelete', message);
    }
  });

  client.on('channelCreate', (channel: Channel) => {
    try {
      store.saveChannelSnapshot(channel as never);
      store.syncAgentAccessFromPolicies();
    } catch (error) {
      reportStorageError(errorReporter, error, 'chat-storage:channelCreate', channel as never);
    }
  });

  client.on('channelUpdate', (_oldChannel: Channel, newChannel: Channel) => {
    try {
      store.saveChannelSnapshot(newChannel as never);
      store.syncAgentAccessFromPolicies();
    } catch (error) {
      reportStorageError(errorReporter, error, 'chat-storage:channelUpdate', newChannel as never);
    }
  });

  client.on('channelDelete', (channel: Channel) => {
    try {
      store.markChannelInactive(channel.id);
      store.syncAgentAccessFromPolicies();
    } catch (error) {
      reportStorageError(errorReporter, error, 'chat-storage:channelDelete', channel as never);
    }
  });

  client.on('guildCreate', (guild: Guild) => {
    try {
      store.saveGuildSnapshot(guild as never);
      store.syncAgentAccessFromPolicies();
    } catch (error) {
      reportStorageError(errorReporter, error, 'chat-storage:guildCreate', guild as never);
    }
  });

  client.on('guildUpdate', (_oldGuild: Guild, newGuild: Guild) => {
    try {
      store.saveGuildSnapshot(newGuild as never);
      store.syncAgentAccessFromPolicies();
    } catch (error) {
      reportStorageError(errorReporter, error, 'chat-storage:guildUpdate', newGuild as never);
    }
  });

  client.on('guildDelete', (guild: Guild) => {
    try {
      store.markGuildInactive(guild.id);
      store.syncAgentAccessFromPolicies();
    } catch (error) {
      reportStorageError(errorReporter, error, 'chat-storage:guildDelete', guild as never);
    }
  });

  console.log(
    `[chat-storage] enabled (includeBotMessages=${Boolean(config.includeBotMessages)})`,
  );
}

export { ChatStorageStore };
