import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { SessionStore, HistoryEntry } from '../src/shared/sessionStore';

let db: Database.Database;
let store: SessionStore;

beforeEach(() => {
  // Use in-memory DB for tests
  db = new Database(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      user_id     TEXT NOT NULL,
      channel_id  TEXT NOT NULL,
      history     TEXT NOT NULL DEFAULT '[]',
      updated_at  INTEGER NOT NULL,
      PRIMARY KEY (user_id, channel_id)
    );
  `);
  store = new SessionStore(db, 10, 30);
});

describe('SessionStore', () => {
  it('returns null for non-existent session', () => {
    expect(store.get('user1', 'ch1')).toBeNull();
  });

  it('upserts and retrieves a session', () => {
    const history: HistoryEntry[] = [{ role: 'user', prompt: 'hello' }];
    store.upsert('user1', 'ch1', history);
    const session = store.get('user1', 'ch1');
    expect(session).not.toBeNull();
    expect(session!.history).toEqual(history);
  });

  it('trims history to historyLimit', () => {
    // historyLimit = 10, insert 12 entries
    const history: HistoryEntry[] = Array.from({ length: 12 }, (_, i) => ({
      role: 'user' as const,
      prompt: `prompt ${i}`,
    }));
    store.upsert('user1', 'ch1', history);
    const session = store.get('user1', 'ch1');
    expect(session!.history).toHaveLength(10);
    // Should keep the LAST 10 (newest)
    expect(session!.history[0]).toEqual({ role: 'user', prompt: 'prompt 2' });
  });

  it('deletes a session', () => {
    store.upsert('user1', 'ch1', [{ role: 'user', prompt: 'hi' }]);
    store.delete('user1', 'ch1');
    expect(store.get('user1', 'ch1')).toBeNull();
  });

  it('returns null for expired session', () => {
    // Insert a session with very old updated_at
    const oldTimestamp = Date.now() - 31 * 60 * 1000; // 31 minutes ago
    db.prepare(
      'INSERT INTO sessions (user_id, channel_id, history, updated_at) VALUES (?, ?, ?, ?)'
    ).run('user1', 'ch1', '[]', oldTimestamp);

    expect(store.get('user1', 'ch1')).toBeNull();
  });

  it('getLastImageUrl returns null when no bot entry', () => {
    store.upsert('user1', 'ch1', [{ role: 'user', prompt: 'hi' }]);
    expect(store.getLastImageUrl('user1', 'ch1')).toBeNull();
  });

  it('getLastImageUrl returns URL from last bot entry', () => {
    const history: HistoryEntry[] = [
      { role: 'user', prompt: 'hello' },
      { role: 'bot', prompt: 'hello', imageUrl: 'https://cdn.discord.com/img1.png' },
      { role: 'user', prompt: 'refine' },
      { role: 'bot', prompt: 'refine', imageUrl: 'https://cdn.discord.com/img2.png' },
    ];
    store.upsert('user1', 'ch1', history);
    expect(store.getLastImageUrl('user1', 'ch1')).toBe('https://cdn.discord.com/img2.png');
  });
});
