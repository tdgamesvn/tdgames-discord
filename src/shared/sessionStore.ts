import Database from 'better-sqlite3';

export type HistoryEntry =
  | { role: 'user'; prompt: string }
  | { role: 'bot'; prompt: string; imageUrl: string }
  | { role: 'assistant'; content: string };

export interface Session {
  userId: string;
  channelId: string;
  history: HistoryEntry[];
  updatedAt: number;
}

interface DbRow {
  user_id: string;
  channel_id: string;
  history: string;
  updated_at: number;
}

export class SessionStore {
  private db: Database.Database;
  private historyLimit: number;
  private expireMs: number;

  constructor(db: Database.Database, historyLimit: number, expireMinutes: number) {
    this.db = db;
    this.historyLimit = historyLimit;
    this.expireMs = expireMinutes * 60 * 1000;
  }

  get(userId: string, channelId: string): Session | null {
    const row = this.db
      .prepare<[string, string], DbRow>(
        'SELECT * FROM sessions WHERE user_id = ? AND channel_id = ?'
      )
      .get(userId, channelId);

    if (!row) return null;

    // Check expiry
    if (Date.now() - row.updated_at > this.expireMs) return null;

    return {
      userId: row.user_id,
      channelId: row.channel_id,
      history: JSON.parse(row.history) as HistoryEntry[],
      updatedAt: row.updated_at,
    };
  }

  upsert(userId: string, channelId: string, history: HistoryEntry[]): void {
    // Trim to limit — keep the LAST N entries
    const trimmed = history.slice(-this.historyLimit);

    this.db
      .prepare(
        `INSERT INTO sessions (user_id, channel_id, history, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, channel_id) DO UPDATE SET
           history = excluded.history,
           updated_at = excluded.updated_at`
      )
      .run(userId, channelId, JSON.stringify(trimmed), Date.now());
  }

  delete(userId: string, channelId: string): void {
    this.db
      .prepare('DELETE FROM sessions WHERE user_id = ? AND channel_id = ?')
      .run(userId, channelId);
  }

  getLastImageUrl(userId: string, channelId: string): string | null {
    const session = this.get(userId, channelId);
    if (!session) return null;

    // Find the last bot entry with an imageUrl (scan from end)
    for (let i = session.history.length - 1; i >= 0; i--) {
      const entry = session.history[i];
      if (entry.role === 'bot') return entry.imageUrl;
    }
    return null;
  }
}
