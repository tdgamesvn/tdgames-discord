import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initDb, cleanupExpiredSessions } from '../src/db/schema';
import path from 'path';
import fs from 'fs';

describe('Database Schema', () => {
  const testDbPath = path.join(process.cwd(), 'data', 'test.db');

  beforeEach(() => {
    // Clean up any existing test database
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  afterEach(() => {
    // Clean up test database after tests
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  it('should initialize database and create sessions table', () => {
    const db = initDb(testDbPath);
    expect(db).toBeDefined();
    expect(db.name).toBe(testDbPath);
    db.close();
  });

  it('should clean up expired sessions', () => {
    const db = initDb(testDbPath);
    
    // Insert a test session with an old timestamp
    const oldTimestamp = Date.now() - 35 * 60 * 1000; // 35 minutes ago
    db.prepare('INSERT INTO sessions (user_id, channel_id, updated_at) VALUES (?, ?, ?)')
      .run('user123', 'channel456', oldTimestamp);
    
    // Verify session was inserted
    const before = db.prepare('SELECT COUNT(*) as count FROM sessions').get() as { count: number };
    expect(before.count).toBe(1);
    
    // Clean up with 30 minute expiration
    const deleted = cleanupExpiredSessions(db, 30);
    expect(deleted).toBe(1);
    
    // Verify session was deleted
    const after = db.prepare('SELECT COUNT(*) as count FROM sessions').get() as { count: number };
    expect(after.count).toBe(0);
    
    db.close();
  });

  it('should not delete recent sessions', () => {
    const db = initDb(testDbPath);
    
    // Insert a recent session
    const recentTimestamp = Date.now() - 5 * 60 * 1000; // 5 minutes ago
    db.prepare('INSERT INTO sessions (user_id, channel_id, updated_at) VALUES (?, ?, ?)')
      .run('user123', 'channel456', recentTimestamp);
    
    // Clean up with 30 minute expiration
    const deleted = cleanupExpiredSessions(db, 30);
    expect(deleted).toBe(0);
    
    // Verify session still exists
    const count = db.prepare('SELECT COUNT(*) as count FROM sessions').get() as { count: number };
    expect(count.count).toBe(1);
    
    db.close();
  });
});
