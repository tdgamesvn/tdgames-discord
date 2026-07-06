import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { Client, GatewayIntentBits } from 'discord.js';
import { getConfig } from './config';
import { initDb, cleanupExpiredSessions, cleanupProcessedMessages } from './db/schema';
import { SessionStore } from './shared/sessionStore';
import { ChannelPromptStore } from './shared/channelPromptStore';
import { ErrorReporter } from './shared/errorReporter';
import { StatsStore } from './shared/statsStore';
import { QueueManager } from './core/queue';
import { FeatureRouter } from './core/router';
import { createImageGenFeature } from './features/image-gen';
import { createTextChatFeature } from './features/text-chat';
import { createUpscalerFeature } from './features/upscaler';
import { createUpscalerVideoFeature } from './features/upscaler-video';
import { createCompressorFeature } from './features/compressor';
import { ChatStorageStore, registerChatStorageEvents } from './features/chat-storage/index';
import { registerCommunicationHubForwarder } from './features/communication-hub/forwarder';
import { createMessageHandler } from './bot';

// ─── Single-instance guard ───────────────────────────────────────────────────
// Ensures only ONE bot process is connected to Discord at any time.
// Two-phase approach:
//   1. PID file — kill the known previous instance
//   2. pgrep scan — kill ANY other process running index.ts (orphaned tsx watch,
//      manually-started sessions, etc.) that the PID file doesn't know about
// After all old processes are confirmed dead, we wait an extra 3 s for Discord
// to fully deregister their gateway sessions before connecting.

async function enforceSingleInstance(): Promise<void> {
  const dataDir = path.join(process.cwd(), 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const pidFile = path.join(dataDir, 'bot.pid');

  const myPid = process.pid;
  // tsx spawns: parent (tsx CLI) → child (node --require ... index.ts)
  // process.ppid is the tsx parent — we must NOT kill it.
  const myPpid = process.ppid;
  const pidsToKill: number[] = [];

  // Phase 1: PID file
  if (fs.existsSync(pidFile)) {
    const oldPid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);
    if (!isNaN(oldPid) && oldPid !== myPid && oldPid !== myPpid) {
      pidsToKill.push(oldPid);
    }
  }

  // Phase 2: pgrep — find ALL processes whose command line contains "index.ts"
  // within our project directory, excluding ourselves, our parent, and config-ui
  try {
    const projectDir = process.cwd();
    const raw = execSync('pgrep -f "index\\.ts"', { encoding: 'utf-8' }).trim();
    for (const line of raw.split('\n')) {
      const pid = parseInt(line.trim(), 10);
      if (isNaN(pid) || pid === myPid || pid === myPpid) continue;

      // Verify this PID is actually running OUR index.ts (not some other project)
      try {
        const cmdline = execSync(`ps -p ${pid} -o args=`, { encoding: 'utf-8' }).trim();
        if (cmdline.includes(projectDir) && cmdline.includes('index.ts') && !cmdline.includes('config-ui')) {
          if (!pidsToKill.includes(pid)) pidsToKill.push(pid);
        }
      } catch {
        // Process gone between pgrep and ps — fine
      }
    }
  } catch {
    // pgrep returns exit 1 when no matches — ignore
  }

  // Kill all found processes and wait for them to die
  if (pidsToKill.length > 0) {
    console.log(`🛑 Killing ${pidsToKill.length} old instance(s): ${pidsToKill.join(', ')}`);
    for (const pid of pidsToKill) {
      try { process.kill(pid, 'SIGTERM'); } catch { /* already dead */ }
    }

    // Poll until ALL are gone (max 8 s)
    const MAX_WAIT_MS = 8_000;
    const POLL_MS = 100;
    let waited = 0;
    while (waited < MAX_WAIT_MS) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      waited += POLL_MS;
      const alive = pidsToKill.filter((pid) => {
        try { process.kill(pid, 0); return true; } catch { return false; }
      });
      if (alive.length === 0) {
        console.log(`✅ All old instances exited after ${waited}ms`);
        break;
      }
    }

    // Force-kill any stubborn survivors
    const stillAlive = pidsToKill.filter((pid) => {
      try { process.kill(pid, 0); return true; } catch { return false; }
    });
    for (const pid of stillAlive) {
      console.warn(`⚠️  Force-killing PID ${pid} (did not exit gracefully)`);
      try { process.kill(pid, 'SIGKILL'); } catch { /* ignore */ }
    }

    // Wait for Discord to deregister old gateway sessions
    console.log('⏳ Waiting 3s for Discord to deregister old gateway session(s)...');
    await new Promise((r) => setTimeout(r, 3_000));
    console.log('✅ Proceeding with login.');
  }

  // Write our own PID so the next start can find us
  fs.writeFileSync(pidFile, String(process.pid));
  console.log(`📝 PID ${process.pid} written to data/bot.pid`);
}

// ─── Bootstrap (runs after single-instance guard) ────────────────────────────

async function main(): Promise<void> {
  await enforceSingleInstance();

  const config = getConfig();
  const db = initDb('data/bot.db');

  // ─── Shared infrastructure ──────────────────────────────────────────────────
  const sessionStore = new SessionStore(
    db,
    config.session.historyLimit,
    config.session.expireMinutes,
  );
  const channelPromptStore = new ChannelPromptStore(db);
  const queueManager = new QueueManager(config.queue.maxPending);

  // ─── Discord client ──────────────────────────────────────────────────────────
  // Created before errorReporter because ErrorReporter needs a Client reference.

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent, // Required to read message content
    ],
  });

  const errorReporter = new ErrorReporter(client, config.discord.errorChannelId);
  const statsStore = new StatsStore(db);
  const chatStorageStore = new ChatStorageStore(db);
  registerChatStorageEvents(client, chatStorageStore, config.chatStorage, errorReporter);
  registerCommunicationHubForwarder(client, config.communicationHub, errorReporter);

  // ─── FeatureContext ──────────────────────────────────────────────────────────
  const ctx = {
    db,
    config,
    errorReporter,
    statsStore,
    sessionStore,
    channelPromptStore,
  };

  // ─── Feature registry ────────────────────────────────────────────────────────
  // Each feature self-describes which channelIds it handles.
  // To add a new feature: create src/features/<name>/index.ts → register here.

  const router = new FeatureRouter();
  router.register(createImageGenFeature(config, db));
  router.register(createTextChatFeature(config, db));
  router.register(createUpscalerFeature(config, db));
  router.register(createUpscalerVideoFeature(config, db));
  router.register(createCompressorFeature(config, db));

  console.log(`🚀 Router: ${router.registeredChannelIds.size} channel(s) registered`);

  if (!config.openai.apiKey) {
    console.warn('⚠️  OPENAI_API_KEY not set — no fallback if CLIProxy is rate-limited or down.');
  }

  // ─── Event routing ────────────────────────────────────────────────────────────

  client.on('messageCreate', createMessageHandler(router, queueManager, ctx));

  client.once('ready', (c) => {
    console.log(`✅ Logged in as ${c.user.tag}`);

    // Periodic cleanup of expired sessions + processed_messages (every hour)
    setInterval(() => {
      const deletedSessions = cleanupExpiredSessions(db, config.session.expireMinutes);
      if (deletedSessions > 0) {
        console.log(`🧹 Cleaned up ${deletedSessions} expired session(s)`);
      }
      const deletedMsgs = cleanupProcessedMessages(db);
      if (deletedMsgs > 0) {
        console.log(`🧹 Cleaned up ${deletedMsgs} old processed_messages record(s)`);
      }
    }, 60 * 60 * 1000);
  });

  client.on('error', (err) => {
    console.error('Discord client error:', err);
    void errorReporter.report(err, { source: 'discord-client' });
  });

  // ─── Global error hooks ──────────────────────────────────────────────────────

  process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
    void errorReporter.report(err, { source: 'uncaughtException' });
  });

  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled rejection:', reason);
    void errorReporter.report(reason, { source: 'unhandledRejection' });
  });

  // ─── Graceful shutdown ────────────────────────────────────────────────────────
  // IMPORTANT: client.destroy() sends a WebSocket close frame, but process.exit()
  // immediately after may kill the process before Discord acknowledges the close.
  // Discord then keeps the old WS session alive for ~1-2 s, causing the new
  // instance to overlap → duplicate event delivery → duplicate replies.
  // The 1 s sleep gives the close frame time to reach Discord before we exit.

  async function shutdown(signal: string): Promise<void> {
    console.log(`\n${signal} received — shutting down...`);
    client.destroy();
    await new Promise((r) => setTimeout(r, 1_000)); // Let WS close handshake complete
    db.close();
    try { fs.unlinkSync(path.join(process.cwd(), 'data', 'bot.pid')); } catch {}
    process.exit(0);
  }

  process.on('SIGINT', () => { void shutdown('SIGINT'); });
  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });

  // ─── Login ───────────────────────────────────────────────────────────────────
  // Only reached after old instance has fully exited (enforceSingleInstance).

  await client.login(config.discord.token);
}

main().catch((err) => {
  console.error('Failed to start bot:', err);
  process.exit(1);
});
