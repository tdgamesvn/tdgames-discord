import { describe, it, expect, vi } from 'vitest';

function makeClient() {
  const handlers = new Map<string, (...args: any[]) => void>();
  return {
    on: vi.fn((event: string, handler: (...args: any[]) => void) => {
      handlers.set(event, handler);
      return undefined;
    }),
    emitStored: async (event: string, ...args: any[]) => handlers.get(event)?.(...args),
  };
}

describe('registerChatStorageEvents', () => {
  it('registers create/update/delete listeners when chat storage is enabled', async () => {
    const { registerChatStorageEvents } = await import('../src/features/chat-storage');
    const client = makeClient();
    const store = {
      saveMessageCreate: vi.fn(),
      saveMessageUpdate: vi.fn(),
      saveMessageDelete: vi.fn(),
      saveChannelSnapshot: vi.fn(),
      markChannelInactive: vi.fn(),
      saveGuildSnapshot: vi.fn(),
      markGuildInactive: vi.fn(),
    };
    const errorReporter = { report: vi.fn().mockResolvedValue(undefined) };

    registerChatStorageEvents(client as never, store as never, { enabled: true }, errorReporter as never);

    expect(client.on).toHaveBeenCalledWith('messageCreate', expect.any(Function));
    expect(client.on).toHaveBeenCalledWith('messageUpdate', expect.any(Function));
    expect(client.on).toHaveBeenCalledWith('messageDelete', expect.any(Function));
    expect(client.on).toHaveBeenCalledWith('channelCreate', expect.any(Function));
    expect(client.on).toHaveBeenCalledWith('channelUpdate', expect.any(Function));
    expect(client.on).toHaveBeenCalledWith('channelDelete', expect.any(Function));
    expect(client.on).toHaveBeenCalledWith('guildCreate', expect.any(Function));
    expect(client.on).toHaveBeenCalledWith('guildUpdate', expect.any(Function));
    expect(client.on).toHaveBeenCalledWith('guildDelete', expect.any(Function));
  });

  it('does not register listeners when chat storage is disabled', async () => {
    const { registerChatStorageEvents } = await import('../src/features/chat-storage');
    const client = makeClient();

    registerChatStorageEvents(client as never, {} as never, { enabled: false }, {} as never);

    expect(client.on).not.toHaveBeenCalled();
  });

  it('stores non-bot messageCreate events immediately outside router channels', async () => {
    const { registerChatStorageEvents } = await import('../src/features/chat-storage');
    const client = makeClient();
    const store = {
      saveMessageCreate: vi.fn(),
      saveMessageUpdate: vi.fn(),
      saveMessageDelete: vi.fn(),
    };

    registerChatStorageEvents(client as never, store as never, { enabled: true, includeBotMessages: false }, {} as never);
    await client.emitStored('messageCreate', { id: 'msg-1', author: { bot: false }, channelId: 'unregistered-channel' });

    expect(store.saveMessageCreate).toHaveBeenCalledWith(expect.objectContaining({ id: 'msg-1' }));
  });

  it('skips bot messages by default but can include them via config', async () => {
    const { registerChatStorageEvents } = await import('../src/features/chat-storage');
    const client = makeClient();
    const store = {
      saveMessageCreate: vi.fn(),
      saveMessageUpdate: vi.fn(),
      saveMessageDelete: vi.fn(),
    };

    registerChatStorageEvents(client as never, store as never, { enabled: true, includeBotMessages: false }, {} as never);
    await client.emitStored('messageCreate', { id: 'bot-msg', author: { bot: true } });
    expect(store.saveMessageCreate).not.toHaveBeenCalled();

    const client2 = makeClient();
    registerChatStorageEvents(client2 as never, store as never, { enabled: true, includeBotMessages: true }, {} as never);
    await client2.emitStored('messageCreate', { id: 'bot-msg', author: { bot: true } });
    expect(store.saveMessageCreate).toHaveBeenCalledWith(expect.objectContaining({ id: 'bot-msg' }));
  });

  it('updates channel snapshots and auto-syncs agent access when Discord channel metadata changes', async () => {
    const { registerChatStorageEvents } = await import('../src/features/chat-storage');
    const client = makeClient();
    const store = {
      saveMessageCreate: vi.fn(),
      saveMessageUpdate: vi.fn(),
      saveMessageDelete: vi.fn(),
      saveChannelSnapshot: vi.fn(),
      markChannelInactive: vi.fn(),
      syncAgentAccessFromPolicies: vi.fn(),
    };

    registerChatStorageEvents(client as never, store as never, { enabled: true }, {} as never);
    const oldChannel = { id: 'channel-1', name: 'old-name' };
    const newChannel = { id: 'channel-1', name: 'new-name' };

    await client.emitStored('channelCreate', newChannel);
    await client.emitStored('channelUpdate', oldChannel, newChannel);
    await client.emitStored('channelDelete', newChannel);

    expect(store.saveChannelSnapshot).toHaveBeenCalledWith(newChannel);
    expect(store.saveChannelSnapshot).toHaveBeenCalledTimes(2);
    expect(store.markChannelInactive).toHaveBeenCalledWith('channel-1');
    expect(store.syncAgentAccessFromPolicies).toHaveBeenCalledTimes(3);
  });

  it('updates guild snapshots and marks removed guilds inactive', async () => {
    const { registerChatStorageEvents } = await import('../src/features/chat-storage');
    const client = makeClient();
    const store = {
      saveMessageCreate: vi.fn(),
      saveMessageUpdate: vi.fn(),
      saveMessageDelete: vi.fn(),
      saveGuildSnapshot: vi.fn(),
      markGuildInactive: vi.fn(),
      syncAgentAccessFromPolicies: vi.fn(),
    };

    registerChatStorageEvents(client as never, store as never, { enabled: true }, {} as never);
    const oldGuild = { id: 'guild-1', name: 'Old Server' };
    const newGuild = { id: 'guild-1', name: 'New Server' };

    await client.emitStored('guildCreate', newGuild);
    await client.emitStored('guildUpdate', oldGuild, newGuild);
    await client.emitStored('guildDelete', newGuild);

    expect(store.saveGuildSnapshot).toHaveBeenCalledWith(newGuild);
    expect(store.saveGuildSnapshot).toHaveBeenCalledTimes(2);
    expect(store.markGuildInactive).toHaveBeenCalledWith('guild-1');
  });

  it('reports storage errors without throwing into Discord event loop', async () => {
    const { registerChatStorageEvents } = await import('../src/features/chat-storage');
    const client = makeClient();
    const err = new Error('sqlite busy');
    const store = {
      saveMessageCreate: vi.fn(() => { throw err; }),
      saveMessageUpdate: vi.fn(),
      saveMessageDelete: vi.fn(),
      saveChannelSnapshot: vi.fn(() => { throw err; }),
      markChannelInactive: vi.fn(),
    };
    const errorReporter = { report: vi.fn().mockResolvedValue(undefined) };

    registerChatStorageEvents(client as never, store as never, { enabled: true }, errorReporter as never);
    await expect(client.emitStored('messageCreate', { id: 'msg-1', author: { bot: false } })).resolves.toBeUndefined();
    await expect(client.emitStored('channelCreate', { id: 'channel-1', guildId: 'guild-1' })).resolves.toBeUndefined();

    expect(errorReporter.report).toHaveBeenCalledWith(err, expect.objectContaining({ source: 'chat-storage:messageCreate' }));
    expect(errorReporter.report).toHaveBeenCalledWith(err, expect.objectContaining({ source: 'chat-storage:channelCreate' }));
  });
});
