import type { Message } from 'discord.js';
import type Database from 'better-sqlite3';
import type { Config } from '../config';
import type { ErrorReporter } from '../shared/errorReporter';
import type { StatsStore } from '../shared/statsStore';
import type { SessionStore } from '../shared/sessionStore';
import type { ChannelPromptStore } from '../shared/channelPromptStore';

export interface FeatureContext {
  db: Database.Database;
  config: Config;
  errorReporter: ErrorReporter;
  statsStore: StatsStore;
  sessionStore: SessionStore;
  channelPromptStore: ChannelPromptStore;
}

export interface Feature {
  id: string;
  channelIds: Set<string>;
  handler: (message: Message, ctx: FeatureContext) => Promise<void>;
}
