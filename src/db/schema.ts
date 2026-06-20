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
  `);

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
