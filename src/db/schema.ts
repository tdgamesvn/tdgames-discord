import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DEFAULT_DB_PATH = path.join(process.cwd(), 'data', 'sessions.db');

export function initDb(dbPath: string = DEFAULT_DB_PATH): Database.Database {
  // Ensure data directory exists
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(dbPath);

  // Enable WAL mode for better concurrent read performance
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      user_id     TEXT NOT NULL,
      channel_id  TEXT NOT NULL,
      history     TEXT NOT NULL DEFAULT '[]',
      updated_at  INTEGER NOT NULL,
      PRIMARY KEY (user_id, channel_id)
    );

    CREATE TABLE IF NOT EXISTS channel_prompts (
      channel_id    TEXT PRIMARY KEY,
      system_prompt TEXT NOT NULL DEFAULT '',
      updated_at    INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS image_stats (
      date      TEXT PRIMARY KEY,   -- YYYY-MM-DD local time
      generates INTEGER NOT NULL DEFAULT 0,
      edits     INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS discord_servers (
      guild_id   TEXT PRIMARY KEY,
      name       TEXT,
      group_name TEXT,
      is_active  INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS discord_channels (
      channel_id    TEXT PRIMARY KEY,
      guild_id      TEXT,
      name          TEXT,
      type          TEXT,
      parent_id     TEXT,
      category_name TEXT,
      group_name    TEXT,
      sensitivity   TEXT NOT NULL DEFAULT 'internal',
      is_thread     INTEGER NOT NULL DEFAULT 0,
      is_active     INTEGER NOT NULL DEFAULT 1,
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL,
      FOREIGN KEY (guild_id) REFERENCES discord_servers(guild_id)
    );

    CREATE TABLE IF NOT EXISTS discord_messages (
      message_id          TEXT PRIMARY KEY,
      guild_id            TEXT,
      channel_id          TEXT NOT NULL,
      author_id           TEXT,
      author_name         TEXT,
      author_global_name  TEXT,
      author_is_bot       INTEGER NOT NULL DEFAULT 0,
      content             TEXT,
      clean_content       TEXT,
      attachments         TEXT NOT NULL DEFAULT '[]',
      embeds              TEXT NOT NULL DEFAULT '[]',
      mentions            TEXT NOT NULL DEFAULT '{}',
      reply_to_message_id TEXT,
      thread_id           TEXT,
      message_type        TEXT,
      url                 TEXT,
      created_at          INTEGER NOT NULL,
      edited_at           INTEGER,
      deleted_at          INTEGER,
      ingested_at         INTEGER NOT NULL,
      raw                 TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY (guild_id) REFERENCES discord_servers(guild_id),
      FOREIGN KEY (channel_id) REFERENCES discord_channels(channel_id)
    );

    CREATE TABLE IF NOT EXISTS discord_message_events (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      message_id TEXT NOT NULL,
      guild_id   TEXT,
      channel_id TEXT,
      event_at   INTEGER NOT NULL,
      raw        TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS discord_agents (
      agent_key   TEXT PRIMARY KEY,
      profile_name TEXT,
      display_name TEXT,
      is_active   INTEGER NOT NULL DEFAULT 1,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS discord_agent_channel_access (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_key    TEXT NOT NULL,
      guild_id     TEXT,
      channel_id   TEXT NOT NULL,
      access_level TEXT NOT NULL DEFAULT 'read',
      purpose      TEXT,
      is_active    INTEGER NOT NULL DEFAULT 1,
      created_at   INTEGER NOT NULL,
      updated_at   INTEGER NOT NULL,
      UNIQUE(agent_key, channel_id),
      FOREIGN KEY (agent_key) REFERENCES discord_agents(agent_key),
      FOREIGN KEY (channel_id) REFERENCES discord_channels(channel_id)
    );

    CREATE TABLE IF NOT EXISTS discord_channel_groups (
      group_key    TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      description  TEXT,
      agent_key    TEXT,
      created_at   INTEGER NOT NULL,
      updated_at   INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS discord_channel_group_members (
      group_key  TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (group_key, channel_id),
      FOREIGN KEY (group_key) REFERENCES discord_channel_groups(group_key),
      FOREIGN KEY (channel_id) REFERENCES discord_channels(channel_id)
    );

    CREATE TABLE IF NOT EXISTS discord_channel_group_policies (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      group_key     TEXT NOT NULL,
      scope_type    TEXT NOT NULL CHECK(scope_type IN ('guild', 'category', 'channel')),
      guild_id      TEXT,
      parent_id     TEXT,
      category_name TEXT,
      channel_id    TEXT,
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL,
      FOREIGN KEY (group_key) REFERENCES discord_channel_groups(group_key)
    );

    CREATE TABLE IF NOT EXISTS discord_agent_read_cursors (
      agent_key               TEXT NOT NULL,
      channel_id              TEXT NOT NULL,
      last_message_id         TEXT,
      last_message_created_at INTEGER,
      updated_at              INTEGER NOT NULL,
      PRIMARY KEY (agent_key, channel_id)
    );

    CREATE TABLE IF NOT EXISTS discord_channel_summaries (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_key    TEXT,
      guild_id     TEXT,
      channel_id   TEXT,
      period_start INTEGER NOT NULL,
      period_end   INTEGER NOT NULL,
      summary      TEXT NOT NULL,
      signals      TEXT NOT NULL DEFAULT '[]',
      risks        TEXT NOT NULL DEFAULT '[]',
      decisions    TEXT NOT NULL DEFAULT '[]',
      created_at   INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS discord_agent_query_logs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_key   TEXT NOT NULL,
      query_type  TEXT NOT NULL,
      channel_ids TEXT NOT NULL DEFAULT '[]',
      since_at    INTEGER,
      until_at    INTEGER,
      requested_by TEXT,
      created_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS discord_backfill_cursors (
      channel_id       TEXT PRIMARY KEY,
      guild_id         TEXT,
      before_message_id TEXT,
      oldest_message_created_at INTEGER,
      reached_cutoff   INTEGER NOT NULL DEFAULT 0,
      scanned_messages INTEGER NOT NULL DEFAULT 0,
      saved_messages   INTEGER NOT NULL DEFAULT 0,
      last_error       TEXT,
      updated_at       INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS processed_messages (
      message_id   TEXT PRIMARY KEY,
      processed_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS discord_clickup_mappings (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      scope_key            TEXT NOT NULL,
      scope_type           TEXT NOT NULL CHECK(scope_type IN ('guild', 'category', 'channel')),
      guild_id             TEXT,
      parent_id            TEXT,
      category_name        TEXT,
      channel_id           TEXT,
      clickup_project_id   TEXT NOT NULL,
      clickup_project_name TEXT NOT NULL,
      folder_id            TEXT,
      list_id              TEXT,
      agent_key            TEXT NOT NULL,
      is_active            INTEGER NOT NULL DEFAULT 1,
      created_at           INTEGER NOT NULL,
      updated_at           INTEGER NOT NULL,
      UNIQUE(scope_key, agent_key)
    );

    CREATE INDEX IF NOT EXISTS idx_discord_messages_channel_created
      ON discord_messages(channel_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_discord_messages_guild_created
      ON discord_messages(guild_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_discord_events_message
      ON discord_message_events(message_id, event_at);
    CREATE INDEX IF NOT EXISTS idx_discord_access_agent
      ON discord_agent_channel_access(agent_key, is_active);
  `);

  // Migration: add provider-split columns (safe to re-run)
  const addCol = (table: string, col: string) => {
    try {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} INTEGER NOT NULL DEFAULT 0`);
    } catch {
      // Column already exists — ignore
    }
  };
  addCol('image_stats', 'image_openai');
  addCol('image_stats', 'text_cliproxy');
  addCol('image_stats', 'text_openai');

  return db;
}

export function cleanupExpiredSessions(
  db: Database.Database,
  expireMinutes: number
): number {
  const cutoff = Date.now() - expireMinutes * 60 * 1000;
  const result = db
    .prepare('DELETE FROM sessions WHERE updated_at < ?')
    .run(cutoff);
  return result.changes;
}

/**
 * Delete processed_messages records older than `olderThanMs` milliseconds.
 * Called periodically to prevent unbounded table growth.
 * Records only need to live long enough to prevent cross-instance duplicates
 * during bot restarts (a few minutes is sufficient; default: 24 h).
 */
export function cleanupProcessedMessages(
  db: Database.Database,
  olderThanMs: number = 24 * 60 * 60 * 1000,
): number {
  const cutoff = Date.now() - olderThanMs;
  const result = db
    .prepare('DELETE FROM processed_messages WHERE processed_at < ?')
    .run(cutoff);
  return result.changes;
}
