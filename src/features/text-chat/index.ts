import type Database from 'better-sqlite3';
import type { Config } from '../../config';
import type { Feature } from '../../core/types';
import { ChatClient } from './client';
import { createTextChatHandler } from './handler';

export function createTextChatFeature(config: Config, db: Database.Database): Feature {
  const client = new ChatClient(
    config.cliproxy.apiUrl,
    config.cliproxy.apiKey,
    config.openai.apiKey ?? undefined,
    config.openai.apiUrl,
    config.textChat.fallbackModel,
    config.cliproxy.maxConcurrent,
  );
  return {
    id: 'text-chat',
    channelIds: config.textChat.channelIds,
    handler: createTextChatHandler(client),
  };
}
