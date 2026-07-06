import { Client, GatewayIntentBits, ChannelType } from 'discord.js';
import { getConfig } from './config';
import { initDb } from './db/schema';
import { indexChannelsForBackfill, monthsAgoTimestamp, runBackfillOnce } from './features/chat-storage/backfill';

function parseIntEnv(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (!raw) return defaultValue;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : defaultValue;
}

function loadDotEnv(): void {
  // getConfig() already loads .env, but this script reads optional envs before/after safely.
  try { getConfig(); } catch { /* getConfig called again below for real validation */ }
}

async function main(): Promise<void> {
  loadDotEnv();
  const config = getConfig();
  const db = initDb('data/bot.db');

  const months = parseIntEnv('DISCORD_BACKFILL_MONTHS', 6);
  const maxMessagesPerRun = parseIntEnv('DISCORD_BACKFILL_MAX_MESSAGES_PER_RUN', 1000);
  const batchSize = Math.min(parseIntEnv('DISCORD_BACKFILL_BATCH_SIZE', 100), 100);
  const delayMs = parseIntEnv('DISCORD_BACKFILL_DELAY_MS', 1500);
  const cutoffTimestamp = monthsAgoTimestamp(months);

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  try {
    await client.login(config.discord.token);
    await new Promise<void>((resolve) => client.once('ready', () => resolve()));
    console.log(`[backfill] logged in as ${client.user?.tag}`);

    const channels = client.channels.cache.filter((channel: any) => {
      if (!channel?.isTextBased?.()) return false;
      if (!('messages' in channel)) return false;
      return [
        ChannelType.GuildText,
        ChannelType.PublicThread,
        ChannelType.PrivateThread,
        ChannelType.AnnouncementThread,
        ChannelType.GuildAnnouncement,
        ChannelType.GuildForum,
      ].includes(channel.type);
    });

    const channelList = [...channels.values()] as never;
    const indexResult = indexChannelsForBackfill(db, channelList);
    console.log(
      `[backfill] channels=${channels.size}, indexedChannels=${indexResult.indexedChannels}, months=${months}, maxMessagesPerRun=${maxMessagesPerRun}, batchSize=${batchSize}, delayMs=${delayMs}`,
    );

    const result = await runBackfillOnce({
      db,
      channels: channelList,
      cutoffTimestamp,
      maxMessagesPerRun,
      batchSize,
      delayMs,
      includeBotMessages: config.chatStorage.includeBotMessages,
      logger: console,
      skipChannelIndex: true,
    });

    console.log(`[backfill] done ${JSON.stringify(result)}`);
  } finally {
    client.destroy();
    db.close();
  }
}

main().catch((error) => {
  console.error('[backfill] failed:', error);
  process.exit(1);
});
