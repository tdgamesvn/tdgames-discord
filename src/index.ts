import * as fs from 'fs';
import * as path from 'path';
import { Client, GatewayIntentBits } from 'discord.js';
import { getConfig } from './config';
import { initDb, cleanupExpiredSessions } from './db/schema';
import { SessionStore } from './services/sessionStore';
import { ChannelPromptStore } from './services/channelPromptStore';
import { QueueManager } from './services/queueManager';
import { ImageClient } from './services/imageClient';
import { ErrorReporter } from './services/errorReporter';
import { createMessageHandler } from './bot';

// ─── Bootstrap ───────────────────────────────────────────────────────────────

const config = getConfig();
const db = initDb('data/bot.db');

const sessionStore = new SessionStore(
  db,
  config.session.historyLimit,
  config.session.expireMinutes
);
const channelPromptStore = new ChannelPromptStore(db);
const queueManager = new QueueManager(config.queue.maxPending);
const imageClient = new ImageClient(
  config.cliproxy.apiUrl,
  config.cliproxy.apiKey,
  config.openai.apiKey ?? undefined,
  config.openai.apiUrl,
);


// ─── Discord client ───────────────────────────────────────────────────────────

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // Required to read message content
  ],
});

// ─── Error reporter ───────────────────────────────────────────────────────────
// Created after client so we can pass the real instance.
// No-op when ERROR_CHANNEL_ID is not configured.

const errorReporter = new ErrorReporter(client, config.discord.errorChannelId);

// ─── Event routing ───────────────────────────────────────────────────────────

client.on(
  'messageCreate',
  createMessageHandler({
    allowedChannelIds: config.discord.allowedChannelIds,
    queueManager,
    sessionStore,
    channelPromptStore,
    imageClient,
    imageModel: config.image.model,
    imageSize: config.image.size,
    errorReporter,
  })
);

client.once('ready', (c) => {
  console.log(`✅ Logged in as ${c.user.tag}`);

  const dataDir = path.join(process.cwd(), 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'bot.pid'), String(process.pid));
  console.log(`📝 PID ${process.pid} written to data/bot.pid`);

  // Periodic cleanup of expired sessions (every hour)
  setInterval(() => {
    const deleted = cleanupExpiredSessions(db, config.session.expireMinutes);
    if (deleted > 0) {
      console.log(`🧹 Cleaned up ${deleted} expired session(s)`);
    }
  }, 60 * 60 * 1000);
});

client.on('error', (err) => {
  console.error('Discord client error:', err);
  void errorReporter.report(err, { source: 'discord-client' });
});

// ─── Global error hooks ───────────────────────────────────────────────────────

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  void errorReporter.report(err, { source: 'uncaughtException' });
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
  void errorReporter.report(reason, { source: 'unhandledRejection' });
});

// ─── Graceful shutdown ───────────────────────────────────────────────────────

function shutdown(signal: string) {
  console.log(`\n${signal} received — shutting down...`);
  client.destroy();
  db.close();
  try { fs.unlinkSync(path.join(process.cwd(), 'data', 'bot.pid')); } catch {}
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// ─── Login ───────────────────────────────────────────────────────────────────

client.login(config.discord.token).catch((err) => {
  console.error('Failed to login to Discord:', err);
  process.exit(1);
});
