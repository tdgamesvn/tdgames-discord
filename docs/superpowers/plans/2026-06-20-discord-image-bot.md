# Discord Image Bot — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Discord bot that generates/edits AI images via CliproxyAPI when users @mention it.

**Architecture:** discord.js v14 bot listens for mention events, routes requests through a per-channel p-queue (sequential, max 5 pending), calls CliproxyAPI (OpenAI-compatible) for image generation/editing, stores conversation history in SQLite so users can refine images across multiple turns.

**Tech Stack:** Node.js 20, TypeScript, discord.js v14, better-sqlite3, p-queue v6 (CJS-compatible), vitest (tests), tsx (runner)

## Global Constraints

- Node.js 20 LTS
- TypeScript strict mode (`"strict": true`)
- CommonJS modules (`"module": "commonjs"` in tsconfig)
- p-queue **v6** — not v7+ (v7+ is ESM-only, incompatible with CJS setup)
- All `src/` files use `.ts` extension; run via `tsx`
- No slash commands — mention-only (`@BotName <prompt>`)
- SQLite DB file at `data/sessions.db` (gitignored)
- Secrets in `.env` (gitignored), template in `.env.example`
- Log format: `[YYYY-MM-DD HH:mm:ss] #channel | user#tag | mode: generate|edit | prompt: "..." | status: OK|ERROR | Xs`
- All user-facing messages in Vietnamese (per spec Section 8)
- Max prompt length: 4000 characters
- Session history limit: 10 entries per (userId, channelId)
- Session expire: 30 minutes (checked on read; cleanup on bot start)

---

## File Map

| File | Trách nhiệm |
|------|------------|
| `src/index.ts` | Entry point: load config, init DB, start bot |
| `src/bot.ts` | Discord Client setup, register event handlers |
| `src/config.ts` | Load & validate `.env`, export typed `Config` object |
| `src/db/schema.ts` | Init SQLite DB, create `sessions` table |
| `src/services/sessionStore.ts` | CRUD cho user sessions (get/upsert/delete/cleanup) |
| `src/services/queueManager.ts` | Per-channel PQueue instances, pending count check |
| `src/services/imageService.ts` | `generate(prompt, history)` + `edit(imageBuffer, prompt)` |
| `src/handlers/messageCreate.ts` | Parse mention → validate → enqueue → reply |
| `tests/config.test.ts` | Unit tests cho config validation |
| `tests/sessionStore.test.ts` | Unit tests cho session CRUD |
| `tests/queueManager.test.ts` | Unit tests cho queue logic |

---

### Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.env.example`
- Create: `.gitignore`
- Create: `data/.gitkeep`
- Create: `src/.gitkeep` (placeholder để git track thư mục)

**Interfaces:**
- Produces: npm scripts `dev`, `build`, `start`, `test`; TypeScript compiler config; all dependencies installed

- [ ] **Step 1: Tạo `package.json`**

```json
{
  "name": "tdgames-discord",
  "version": "1.0.0",
  "description": "Discord Image Bot cho TDGames Studio",
  "main": "dist/index.js",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "better-sqlite3": "^9.4.3",
    "discord.js": "^14.14.1",
    "form-data": "^4.0.0",
    "p-queue": "^6.6.2"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.8",
    "@types/node": "^20.11.0",
    "tsx": "^4.7.0",
    "typescript": "^5.3.3",
    "vitest": "^1.2.0"
  }
}
```

- [ ] **Step 2: Tạo `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "moduleResolution": "node",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 3: Tạo `.env.example`**

```env
# Discord
DISCORD_TOKEN=your_bot_token_here
DISCORD_CLIENT_ID=your_client_id_here

# Channel whitelist (comma-separated channel IDs, no spaces)
ALLOWED_CHANNEL_IDS=123456789012345678,987654321098765432

# CliproxyAPI (OpenAI-compatible)
CLIPROXY_API_URL=http://localhost:8317
CLIPROXY_API_KEY=your_api_key_here

# Image settings
IMAGE_MODEL=gpt-image-1
IMAGE_SIZE=1024x1024

# Session
SESSION_HISTORY_LIMIT=10
SESSION_EXPIRE_MINUTES=30

# Queue
CHANNEL_QUEUE_MAX_PENDING=5
```

- [ ] **Step 4: Tạo `.gitignore`**

```
node_modules/
dist/
.env
data/*.db
data/*.db-journal
data/*.db-wal
data/*.db-shm
*.log
```

- [ ] **Step 5: Tạo thư mục cần thiết**

```bash
mkdir -p data src/handlers src/services src/db tests
touch data/.gitkeep
```

- [ ] **Step 6: Cài dependencies**

```bash
npm install
```

Expected output: `added NNN packages` — không có error. Kiểm tra `node_modules/discord.js`, `node_modules/better-sqlite3`, `node_modules/p-queue` tồn tại.

- [ ] **Step 7: Verify TypeScript compiler hoạt động**

Tạo file tạm `src/index.ts` với nội dung:
```typescript
console.log('scaffold ok');
```

Chạy:
```bash
npx tsx src/index.ts
```
Expected output: `scaffold ok`

- [ ] **Step 8: Commit**

```bash
git add package.json tsconfig.json .env.example .gitignore data/.gitkeep
git commit -m "chore: scaffold project — dependencies, tsconfig, gitignore"
```

---

### Task 2: Config Module

**Files:**
- Create: `src/config.ts`
- Create: `tests/config.test.ts`

**Interfaces:**
- Produces:
  ```typescript
  interface Config {
    discord: { token: string; clientId: string; allowedChannelIds: Set<string> };
    cliproxy: { apiUrl: string; apiKey: string };
    image: { model: string; size: string };
    session: { historyLimit: number; expireMinutes: number };
    queue: { maxPending: number };
  }
  export function loadConfig(): Config
  export const config: Config  // singleton, loaded once at import time
  ```

- [ ] **Step 1: Viết failing test**

Tạo `tests/config.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';

describe('loadConfig', () => {
  beforeEach(() => {
    // Reset modules between tests to re-evaluate config
    process.env.DISCORD_TOKEN = 'test-token';
    process.env.DISCORD_CLIENT_ID = '111';
    process.env.ALLOWED_CHANNEL_IDS = '123,456';
    process.env.CLIPROXY_API_URL = 'http://localhost:8317';
    process.env.CLIPROXY_API_KEY = 'test-key';
    process.env.IMAGE_MODEL = 'gpt-image-1';
    process.env.IMAGE_SIZE = '1024x1024';
    process.env.SESSION_HISTORY_LIMIT = '10';
    process.env.SESSION_EXPIRE_MINUTES = '30';
    process.env.CHANNEL_QUEUE_MAX_PENDING = '5';
  });

  it('parses ALLOWED_CHANNEL_IDS into a Set', () => {
    const { loadConfig } = require('../src/config');
    const cfg = loadConfig();
    expect(cfg.discord.allowedChannelIds).toBeInstanceOf(Set);
    expect(cfg.discord.allowedChannelIds.has('123')).toBe(true);
    expect(cfg.discord.allowedChannelIds.has('456')).toBe(true);
  });

  it('parses numeric env vars as numbers', () => {
    const { loadConfig } = require('../src/config');
    const cfg = loadConfig();
    expect(cfg.session.historyLimit).toBe(10);
    expect(cfg.session.expireMinutes).toBe(30);
    expect(cfg.queue.maxPending).toBe(5);
  });

  it('throws if DISCORD_TOKEN is missing', () => {
    delete process.env.DISCORD_TOKEN;
    const { loadConfig } = require('../src/config');
    expect(() => loadConfig()).toThrow('DISCORD_TOKEN');
  });

  it('throws if ALLOWED_CHANNEL_IDS is missing', () => {
    delete process.env.ALLOWED_CHANNEL_IDS;
    const { loadConfig } = require('../src/config');
    expect(() => loadConfig()).toThrow('ALLOWED_CHANNEL_IDS');
  });
});
```

- [ ] **Step 2: Chạy test — verify FAIL**

```bash
npx vitest run tests/config.test.ts
```
Expected: FAIL với `Cannot find module '../src/config'`

- [ ] **Step 3: Implement `src/config.ts`**

```typescript
import * as dotenv from 'fs';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function requireEnvInt(name: string): number {
  const raw = requireEnv(name);
  const n = parseInt(raw, 10);
  if (isNaN(n)) throw new Error(`Env var ${name} must be an integer, got: ${raw}`);
  return n;
}

export interface Config {
  discord: {
    token: string;
    clientId: string;
    allowedChannelIds: Set<string>;
  };
  cliproxy: {
    apiUrl: string;
    apiKey: string;
  };
  image: {
    model: string;
    size: string;
  };
  session: {
    historyLimit: number;
    expireMinutes: number;
  };
  queue: {
    maxPending: number;
  };
}

export function loadConfig(): Config {
  // Load .env file if it exists (dev mode)
  try {
    const envContent = require('fs').readFileSync('.env', 'utf8');
    for (const line of envContent.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (!(key in process.env)) process.env[key] = val;
    }
  } catch {
    // .env not found — rely on actual env vars (production)
  }

  const rawChannels = requireEnv('ALLOWED_CHANNEL_IDS');
  const allowedChannelIds = new Set(
    rawChannels.split(',').map((id) => id.trim()).filter(Boolean)
  );

  return {
    discord: {
      token: requireEnv('DISCORD_TOKEN'),
      clientId: requireEnv('DISCORD_CLIENT_ID'),
      allowedChannelIds,
    },
    cliproxy: {
      apiUrl: requireEnv('CLIPROXY_API_URL'),
      apiKey: requireEnv('CLIPROXY_API_KEY'),
    },
    image: {
      model: process.env.IMAGE_MODEL ?? 'gpt-image-1',
      size: process.env.IMAGE_SIZE ?? '1024x1024',
    },
    session: {
      historyLimit: requireEnvInt('SESSION_HISTORY_LIMIT'),
      expireMinutes: requireEnvInt('SESSION_EXPIRE_MINUTES'),
    },
    queue: {
      maxPending: requireEnvInt('CHANNEL_QUEUE_MAX_PENDING'),
    },
  };
}

// Singleton — loaded once on first import
export const config: Config = loadConfig();
```

- [ ] **Step 4: Chạy test — verify PASS**

```bash
npx vitest run tests/config.test.ts
```
Expected: `4 tests passed`

- [ ] **Step 5: Commit**

```bash
git add src/config.ts tests/config.test.ts
git commit -m "feat: add config module with env validation"
```

---

### Task 3: DB Schema

**Files:**
- Create: `src/db/schema.ts`

**Interfaces:**
- Consumes: `config.ts` (không cần, DB path hardcoded)
- Produces:
  ```typescript
  export function initDb(dbPath?: string): Database.Database
  // Tạo bảng sessions nếu chưa có, chạy cleanup expired rows
  ```

- [ ] **Step 1: Tạo `src/db/schema.ts`**

```typescript
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
```

- [ ] **Step 2: Verify thủ công**

Tạm thời thêm vào `src/index.ts` (ghi đè file placeholder từ Task 1):
```typescript
import { initDb, cleanupExpiredSessions } from './db/schema';

const db = initDb('data/test.db');
console.log('DB initialized:', db.name);

const deleted = cleanupExpiredSessions(db, 30);
console.log('Cleaned up expired sessions:', deleted);

db.close();
```

Chạy:
```bash
npx tsx src/index.ts
```
Expected:
```
DB initialized: /path/to/data/test.db
Cleaned up expired sessions: 0
```

Xóa file test: `rm data/test.db`

- [ ] **Step 3: Commit**

```bash
git add src/db/schema.ts src/index.ts
git commit -m "feat: add SQLite schema init and cleanup"
```

---

### Task 4: Session Store

**Files:**
- Create: `src/services/sessionStore.ts`
- Create: `tests/sessionStore.test.ts`

**Interfaces:**
- Consumes:
  ```typescript
  // from src/db/schema.ts:
  import Database from 'better-sqlite3';
  // from spec:
  type HistoryEntry =
    | { role: 'user'; prompt: string }
    | { role: 'bot'; prompt: string; imageUrl: string };
  ```
- Produces:
  ```typescript
  export type HistoryEntry =
    | { role: 'user'; prompt: string }
    | { role: 'bot'; prompt: string; imageUrl: string };

  export interface Session {
    userId: string;
    channelId: string;
    history: HistoryEntry[];
    updatedAt: number;
  }

  export class SessionStore {
    constructor(db: Database.Database, historyLimit: number, expireMinutes: number)
    get(userId: string, channelId: string): Session | null   // null nếu expired
    upsert(userId: string, channelId: string, history: HistoryEntry[]): void
    delete(userId: string, channelId: string): void
    getLastImageUrl(userId: string, channelId: string): string | null
  }
  ```

- [ ] **Step 1: Viết failing tests**

Tạo `tests/sessionStore.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { initDb } from '../src/db/schema';
import { SessionStore, HistoryEntry } from '../src/services/sessionStore';

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
```

- [ ] **Step 2: Chạy test — verify FAIL**

```bash
npx vitest run tests/sessionStore.test.ts
```
Expected: FAIL với `Cannot find module '../src/services/sessionStore'`

- [ ] **Step 3: Implement `src/services/sessionStore.ts`**

```typescript
import Database from 'better-sqlite3';

export type HistoryEntry =
  | { role: 'user'; prompt: string }
  | { role: 'bot'; prompt: string; imageUrl: string };

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

    // Find the last bot entry with an imageUrl
    for (let i = session.history.length - 1; i >= 0; i--) {
      const entry = session.history[i];
      if (entry.role === 'bot') return entry.imageUrl;
    }
    return null;
  }
}
```

- [ ] **Step 4: Chạy test — verify PASS**

```bash
npx vitest run tests/sessionStore.test.ts
```
Expected: `7 tests passed`

- [ ] **Step 5: Commit**

```bash
git add src/services/sessionStore.ts tests/sessionStore.test.ts
git commit -m "feat: add SessionStore with SQLite CRUD and expiry logic"
```

---

### Task 5: Queue Manager

**Files:**
- Create: `src/services/queueManager.ts`
- Create: `tests/queueManager.test.ts`

**Interfaces:**
- Consumes: `p-queue` v6
- Produces:
  ```typescript
  export class QueueManager {
    constructor(maxPending: number)
    // Returns false if queue is full (>= maxPending)
    enqueue(channelId: string, task: () => Promise<void>): boolean
    getPendingCount(channelId: string): number
  }
  ```

- [ ] **Step 1: Viết failing tests**

Tạo `tests/queueManager.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { QueueManager } from '../src/services/queueManager';

describe('QueueManager', () => {
  it('accepts a task when queue is empty', () => {
    const qm = new QueueManager(5);
    let ran = false;
    const accepted = qm.enqueue('ch1', async () => { ran = true; });
    expect(accepted).toBe(true);
  });

  it('rejects a task when pending >= maxPending', async () => {
    const qm = new QueueManager(2);

    // Fill queue: 1 running + 2 pending = full
    // Since concurrency=1, first task runs immediately (pending=0),
    // 2nd queues (size=1), 3rd queues (size=2) → 4th should be rejected
    const noop = () => new Promise<void>((resolve) => setTimeout(resolve, 100));
    qm.enqueue('ch1', noop); // runs immediately
    qm.enqueue('ch1', noop); // size=1
    qm.enqueue('ch1', noop); // size=2 (= maxPending)
    const accepted = qm.enqueue('ch1', noop); // size would be 3 > maxPending → reject
    expect(accepted).toBe(false);
  });

  it('different channels have independent queues', () => {
    const qm = new QueueManager(1);
    const noop = () => new Promise<void>((resolve) => setTimeout(resolve, 100));
    qm.enqueue('ch1', noop); // ch1 running
    qm.enqueue('ch1', noop); // ch1 size=1 (full)
    const ch1Rejected = qm.enqueue('ch1', noop); // ch1 full → reject

    // ch2 is independent — should accept
    const ch2Accepted = qm.enqueue('ch2', noop);

    expect(ch1Rejected).toBe(false);
    expect(ch2Accepted).toBe(true);
  });

  it('getPendingCount returns 0 for unknown channel', () => {
    const qm = new QueueManager(5);
    expect(qm.getPendingCount('unknown')).toBe(0);
  });
});
```

- [ ] **Step 2: Chạy test — verify FAIL**

```bash
npx vitest run tests/queueManager.test.ts
```
Expected: FAIL với `Cannot find module '../src/services/queueManager'`

- [ ] **Step 3: Implement `src/services/queueManager.ts`**

```typescript
import PQueue from 'p-queue';

export class QueueManager {
  private queues: Map<string, PQueue> = new Map();
  private maxPending: number;

  constructor(maxPending: number) {
    this.maxPending = maxPending;
  }

  private getQueue(channelId: string): PQueue {
    if (!this.queues.has(channelId)) {
      this.queues.set(channelId, new PQueue({ concurrency: 1, timeout: 90_000 }));
    }
    return this.queues.get(channelId)!;
  }

  /**
   * Enqueue a task for a channel.
   * Returns false if the channel's pending queue is full (>= maxPending).
   * `size` = tasks waiting to run (does NOT include the currently running task).
   */
  enqueue(channelId: string, task: () => Promise<void>): boolean {
    const queue = this.getQueue(channelId);

    // queue.size = waiting (not yet started); queue.pending = currently running (0 or 1)
    if (queue.size >= this.maxPending) return false;

    queue.add(task).catch(() => {
      // Errors are handled inside the task itself; swallow here to prevent
      // unhandled rejection from leaking out of p-queue
    });

    return true;
  }

  getPendingCount(channelId: string): number {
    const queue = this.queues.get(channelId);
    if (!queue) return 0;
    return queue.size; // waiting tasks (excludes currently running)
  }
}
```

- [ ] **Step 4: Chạy test — verify PASS**

```bash
npx vitest run tests/queueManager.test.ts
```
Expected: `4 tests passed`

- [ ] **Step 5: Commit**

```bash
git add src/services/queueManager.ts tests/queueManager.test.ts
git commit -m "feat: add QueueManager with per-channel p-queue and pending limit"
```

---

### Task 6: Image Service

**Files:**
- Create: `src/services/imageService.ts`

**Interfaces:**
- Consumes:
  ```typescript
  // from Task 4:
  type HistoryEntry = { role: 'user'; prompt: string } | { role: 'bot'; prompt: string; imageUrl: string }
  // from config:
  config.cliproxy.apiUrl, config.cliproxy.apiKey
  config.image.model, config.image.size
  ```
- Produces:
  ```typescript
  export class ImageService {
    constructor(apiUrl: string, apiKey: string, model: string, size: string)
    // Gọi /v1/images/generations — text-to-image
    generate(prompt: string): Promise<Buffer>
    // Gọi /v1/images/edits — image-to-image
    edit(imageBuffer: Buffer, prompt: string, filename?: string): Promise<Buffer>
  }
  ```
  Cả hai đều throw `Error` với message mô tả lỗi nếu API fail.

- [ ] **Step 1: Implement `src/services/imageService.ts`**

> Không viết test riêng cho service này (cần real API / mock phức tạp). Thay vào đó verify thủ công ở Task 8 khi bot chạy thật.

```typescript
import FormData from 'form-data';

export class ImageService {
  private apiUrl: string;
  private apiKey: string;
  private model: string;
  private size: string;

  constructor(apiUrl: string, apiKey: string, model: string, size: string) {
    this.apiUrl = apiUrl.replace(/\/$/, ''); // remove trailing slash
    this.apiKey = apiKey;
    this.model = model;
    this.size = size;
  }

  private get headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };
  }

  async generate(prompt: string): Promise<Buffer> {
    const response = await fetch(`${this.apiUrl}/v1/images/generations`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        model: this.model,
        prompt,
        n: 1,
        size: this.size,
        response_format: 'b64_json',
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => response.statusText);
      throw new Error(`CliproxyAPI ${response.status}: ${text}`);
    }

    const json = (await response.json()) as {
      data: Array<{ b64_json?: string; url?: string }>;
    };
    const b64 = json.data[0]?.b64_json;
    if (!b64) throw new Error('CliproxyAPI: no b64_json in response');

    return Buffer.from(b64, 'base64');
  }

  async edit(imageBuffer: Buffer, prompt: string, filename = 'image.png'): Promise<Buffer> {
    const form = new FormData();
    form.append('image', imageBuffer, {
      filename,
      contentType: 'image/png',
    });
    form.append('prompt', prompt);
    form.append('model', this.model);
    form.append('size', this.size);
    form.append('response_format', 'b64_json');

    const response = await fetch(`${this.apiUrl}/v1/images/edits`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        ...form.getHeaders(),
      },
      body: form.getBuffer(),
      signal: AbortSignal.timeout(60_000),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => response.statusText);
      throw new Error(`CliproxyAPI ${response.status}: ${text}`);
    }

    const json = (await response.json()) as {
      data: Array<{ b64_json?: string }>;
    };
    const b64 = json.data[0]?.b64_json;
    if (!b64) throw new Error('CliproxyAPI: no b64_json in response');

    return Buffer.from(b64, 'base64');
  }
}
```

- [ ] **Step 2: Verify TypeScript compile**

```bash
npx tsc --noEmit
```
Expected: no errors (hoặc chỉ lỗi liên quan tới files chưa tạo — kiểm tra lỗi liên quan tới `imageService.ts` không có)

- [ ] **Step 3: Commit**

```bash
git add src/services/imageService.ts
git commit -m "feat: add ImageService wrapping CliproxyAPI (generate + edit)"
```

---

### Task 7: Message Handler

**Files:**
- Create: `src/handlers/messageCreate.ts`

**Interfaces:**
- Consumes:
  ```typescript
  // discord.js v14:
  import { Message, AttachmentBuilder } from 'discord.js';
  // from Task 4:
  import { SessionStore, HistoryEntry } from '../services/sessionStore';
  // from Task 5:
  import { QueueManager } from '../services/queueManager';
  // from Task 6:
  import { ImageService } from '../services/imageService';
  // from Task 2:
  import { Config } from '../config';
  ```
- Produces:
  ```typescript
  export function createMessageHandler(
    sessionStore: SessionStore,
    queueManager: QueueManager,
    imageService: ImageService,
    config: Config
  ): (message: Message) => Promise<void>
  ```

- [ ] **Step 1: Tạo `src/handlers/messageCreate.ts`**

```typescript
import { Message, AttachmentBuilder } from 'discord.js';
import { SessionStore, HistoryEntry } from '../services/sessionStore';
import { QueueManager } from '../services/queueManager';
import { ImageService } from '../services/imageService';
import { Config } from '../config';

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

function formatLog(params: {
  channelName: string;
  userTag: string;
  mode: 'generate' | 'edit';
  prompt: string;
  status: 'OK' | 'ERROR';
  detail?: string;
  elapsedMs: number;
}): string {
  const now = new Date();
  const ts = now.toISOString().replace('T', ' ').slice(0, 19);
  const elapsed = (params.elapsedMs / 1000).toFixed(1);
  const statusStr =
    params.status === 'OK' ? 'OK' : `ERROR | ${params.detail ?? ''}`;
  return `[${ts}] #${params.channelName} | ${params.userTag} | mode: ${params.mode} | prompt: "${params.prompt.slice(0, 80)}" | status: ${statusStr} | ${elapsed}s`;
}

export function createMessageHandler(
  sessionStore: SessionStore,
  queueManager: QueueManager,
  imageService: ImageService,
  config: Config
) {
  return async function handleMessage(message: Message): Promise<void> {
    // 1. Ignore bots
    if (message.author.bot) return;

    // 2. Only handle mentions of the bot client
    const clientId = message.client.user?.id;
    if (!clientId || !message.mentions.has(clientId)) return;

    // 3. Channel whitelist check
    if (!config.discord.allowedChannelIds.has(message.channelId)) return;

    // 4. Parse prompt: strip the mention prefix
    const raw = message.content
      .replace(new RegExp(`<@!?${clientId}>`, 'g'), '')
      .trim();

    // 5. Empty prompt
    if (!raw) {
      await message.reply(
        '💡 Nhập mô tả ảnh sau @mention. VD: @TDBot vẽ con rồng bay trên Hà Nội'
      );
      return;
    }

    // 6. Reset command
    if (raw.toLowerCase() === 'reset') {
      sessionStore.delete(message.author.id, message.channelId);
      await message.reply('🗑️ Đã xóa lịch sử ảnh của bạn.');
      return;
    }

    // 7. Prompt too long
    if (raw.length > 4000) {
      await message.reply('⚠️ Prompt quá dài, vui lòng rút ngắn lại.');
      return;
    }

    // 8. Check channel queue capacity
    if (queueManager.getPendingCount(message.channelId) >= config.queue.maxPending) {
      await message.reply('⏳ Channel đang bận, vui lòng thử lại sau ít phút.');
      return;
    }

    // 9. Reply acknowledgement immediately
    const pendingPos = queueManager.getPendingCount(message.channelId) + 1;
    const ackMsg = await message.reply(`⏳ Đang tạo ảnh... (vị trí #${pendingPos})`);

    // 10. Enqueue the actual generation task
    const channelName =
      'name' in message.channel ? (message.channel as { name: string }).name : message.channelId;

    const accepted = queueManager.enqueue(message.channelId, async () => {
      const startMs = Date.now();
      const prompt = raw;
      const userId = message.author.id;
      const channelId = message.channelId;
      const userTag = `${message.author.username}#${message.author.discriminator}`;

      let mode: 'generate' | 'edit' = 'generate';
      let imageBuffer: Buffer | null = null;

      try {
        // Determine mode
        const attachment = message.attachments.first();

        if (attachment) {
          // User uploaded an image
          const contentType = attachment.contentType ?? '';
          if (!ALLOWED_IMAGE_TYPES.some((t) => contentType.startsWith(t.split('/')[1]))) {
            await message.reply('⚠️ Chỉ hỗ trợ file ảnh (jpg, png, webp).');
            return;
          }
          const resp = await fetch(attachment.url);
          imageBuffer = Buffer.from(await resp.arrayBuffer());
          mode = 'edit';
        } else {
          // Check session for last image
          const lastImageUrl = sessionStore.getLastImageUrl(userId, channelId);
          if (lastImageUrl) {
            const resp = await fetch(lastImageUrl);
            imageBuffer = Buffer.from(await resp.arrayBuffer());
            mode = 'edit';
          }
        }

        // Call API
        let resultBuffer: Buffer;
        if (mode === 'edit' && imageBuffer) {
          resultBuffer = await imageService.edit(imageBuffer, prompt);
        } else {
          resultBuffer = await imageService.generate(prompt);
        }

        // Send result
        const file = new AttachmentBuilder(resultBuffer, { name: 'image.png' });
        const sentMsg = await message.channel.send({ files: [file] });

        // Get Discord CDN URL of the sent image
        const imageUrl = sentMsg.attachments.first()?.url ?? '';

        // Update session
        const session = sessionStore.get(userId, channelId);
        const history: HistoryEntry[] = session?.history ?? [];
        history.push({ role: 'user', prompt });
        history.push({ role: 'bot', prompt, imageUrl });
        sessionStore.upsert(userId, channelId, history);

        // Delete ack message
        await ackMsg.delete().catch(() => {});

        const elapsed = Date.now() - startMs;
        console.log(formatLog({ channelName, userTag, mode, prompt, status: 'OK', elapsedMs: elapsed }));
      } catch (err: unknown) {
        const elapsed = Date.now() - startMs;
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(formatLog({ channelName, userTag, mode, prompt, status: 'ERROR', detail: errMsg, elapsedMs: elapsed }));

        if (errMsg.includes('timeout') || errMsg.toLowerCase().includes('aborted')) {
          await message.reply('⏱️ API quá tải, thử lại sau ít phút.').catch(() => {});
        } else {
          await message.reply(`❌ Không tạo được ảnh: ${errMsg}`).catch(() => {});
        }
        await ackMsg.delete().catch(() => {});
      }
    });

    if (!accepted) {
      await ackMsg.edit('⏳ Channel đang bận, vui lòng thử lại sau ít phút.');
    }
  };
}
```

- [ ] **Step 2: Verify TypeScript compile**

```bash
npx tsc --noEmit
```
Expected: no errors for messageCreate.ts (các lỗi còn lại có thể từ src/index.ts placeholder)

- [ ] **Step 3: Commit**

```bash
git add src/handlers/messageCreate.ts
git commit -m "feat: add messageCreate handler with routing, queue integration, session update"
```

---

### Task 8: Bot + Entry Point + Integration

**Files:**
- Modify: `src/index.ts` (replace placeholder)
- Create: `src/bot.ts`
- Modify: `CLAUDE.md` (cập nhật tech stack và cấu trúc)

**Interfaces:**
- Consumes: tất cả modules từ Task 2–7

- [ ] **Step 1: Tạo `src/bot.ts`**

```typescript
import { Client, GatewayIntentBits, Events } from 'discord.js';
import { Config } from './config';
import { SessionStore } from './services/sessionStore';
import { QueueManager } from './services/queueManager';
import { ImageService } from './services/imageService';
import { createMessageHandler } from './handlers/messageCreate';

export function createBot(
  config: Config,
  sessionStore: SessionStore,
  queueManager: QueueManager,
  imageService: ImageService
): Client {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  const handleMessage = createMessageHandler(
    sessionStore,
    queueManager,
    imageService,
    config
  );

  client.on(Events.MessageCreate, (message) => {
    handleMessage(message).catch((err) => {
      console.error('[Bot] Unhandled error in messageCreate:', err);
    });
  });

  client.once(Events.ClientReady, (c) => {
    console.log(`[Bot] Logged in as ${c.user.tag}`);
    console.log(`[Bot] Watching channels: ${[...config.discord.allowedChannelIds].join(', ')}`);
  });

  return client;
}
```

- [ ] **Step 2: Viết `src/index.ts` (entry point thực sự)**

```typescript
import { config } from './config';
import { initDb, cleanupExpiredSessions } from './db/schema';
import { SessionStore } from './services/sessionStore';
import { QueueManager } from './services/queueManager';
import { ImageService } from './services/imageService';
import { createBot } from './bot';

async function main() {
  console.log('[Startup] Initializing...');

  // Init SQLite
  const db = initDb();
  const cleaned = cleanupExpiredSessions(db, config.session.expireMinutes);
  if (cleaned > 0) {
    console.log(`[Startup] Cleaned up ${cleaned} expired sessions`);
  }

  // Init services
  const sessionStore = new SessionStore(
    db,
    config.session.historyLimit,
    config.session.expireMinutes
  );
  const queueManager = new QueueManager(config.queue.maxPending);
  const imageService = new ImageService(
    config.cliproxy.apiUrl,
    config.cliproxy.apiKey,
    config.image.model,
    config.image.size
  );

  // Create and start bot
  const bot = createBot(config, sessionStore, queueManager, imageService);

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('[Shutdown] Received SIGINT, closing...');
    bot.destroy();
    db.close();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('[Shutdown] Received SIGTERM, closing...');
    bot.destroy();
    db.close();
    process.exit(0);
  });

  await bot.login(config.discord.token);
}

main().catch((err) => {
  console.error('[Startup] Fatal error:', err);
  process.exit(1);
});
```

- [ ] **Step 3: Verify full TypeScript compile**

```bash
npx tsc --noEmit
```
Expected: **zero errors**. Fix bất kỳ lỗi type nào trước khi tiếp tục.

- [ ] **Step 4: Chạy tất cả tests**

```bash
npx vitest run
```
Expected: tất cả tests từ Task 2, 4, 5 pass.

- [ ] **Step 5: Cập nhật `CLAUDE.md`**

Cập nhật section Tech Stack và Cấu trúc project trong `CLAUDE.md` ở root:

```markdown
## Tech Stack

- Runtime: Node.js 20 (LTS)
- Framework: discord.js v14
- Language: TypeScript (strict)
- Database: SQLite (better-sqlite3)
- Queue: p-queue v6 (per-channel, sequential)
- Runner: tsx (dev), tsc + node (prod)

## Cấu trúc project

src/
  index.ts          — Entry point
  bot.ts            — Discord Client setup
  config.ts         — Env config + validation
  db/schema.ts      — SQLite init + cleanup
  handlers/
    messageCreate.ts — Mention handler
  services/
    imageService.ts  — CliproxyAPI wrapper
    sessionStore.ts  — Session CRUD
    queueManager.ts  — Per-channel queue

tests/              — vitest unit tests
data/               — SQLite DB (gitignored)

## Lệnh thường dùng

# Dev (hot reload)
npm run dev

# Run all tests
npm test

# Build
npm run build

# Production
npm start

## Conventions

- Tất cả logic trong services/, handlers/ nhận dependencies qua constructor (DI)
- Không dùng global state ngoài config singleton
- Log format: [YYYY-MM-DD HH:mm:ss] #channel | user#tag | mode | prompt | status | Xs
- User-facing messages: tiếng Việt
```

- [ ] **Step 6: Cập nhật `.agent/meta/PROJECT.md`**

Cập nhật Tech Stack trong PROJECT.md:
```markdown
| Layer | Công nghệ |
|-------|-----------|
| Runtime | Node.js 20 LTS |
| Framework | discord.js v14 |
| Language | TypeScript (strict) |
| Database | SQLite (better-sqlite3) |
| Queue | p-queue v6 |
```

Cập nhật Trạng thái:
```markdown
- [x] Tech stack đã chọn
- [x] Project scaffold
- [ ] Bot đăng ký Discord Developer Portal
- [ ] Môi trường dev chạy được (cần .env thật)
- [ ] Deploy production
```

- [ ] **Step 7: Cập nhật `.agent/meta/TASKS.md` và `.agent/meta/LOG.md`**

Trong `TASKS.md`, chuyển tất cả task implementation về Done. Thêm task mới:
```markdown
## To Do
- [ ] Tạo bot trên Discord Developer Portal + lấy token
- [ ] Điền .env thật và test dev
- [ ] Deploy lên VPS

## Done
- [x] Design spec (2026-06-19)
- [x] Implementation plan (2026-06-20)
- [x] Task 1: Project scaffold
- [x] Task 2: Config module
- [x] Task 3: DB Schema
- [x] Task 4: Session Store
- [x] Task 5: Queue Manager
- [x] Task 6: Image Service
- [x] Task 7: Message Handler
- [x] Task 8: Bot + Entry Point
```

Trong `LOG.md`, append:
```markdown
## 2026-06-20 — Implementation

**Agent:** Claude Code
**Task:** Implement Discord Image Bot — Tasks 1–8
**Files tạo mới:**
- package.json, tsconfig.json, .env.example, .gitignore
- src/index.ts, src/bot.ts, src/config.ts
- src/db/schema.ts
- src/services/sessionStore.ts, queueManager.ts, imageService.ts
- src/handlers/messageCreate.ts
- tests/config.test.ts, sessionStore.test.ts, queueManager.test.ts

**Ghi chú:** Bot đã implement xong. Cần điền .env thật để test.
Next: Tạo bot trên Discord Developer Portal.
```

- [ ] **Step 8: Final commit**

```bash
git add src/bot.ts src/index.ts CLAUDE.md .agent/meta/PROJECT.md .agent/meta/TASKS.md .agent/meta/LOG.md
git commit -m "feat: wire up bot entry point and update project docs"
```

---

## Self-Review

### Spec Coverage Check

| Spec section | Task |
|-------------|------|
| Tech Stack (Node 20, TS, discord.js v14, SQLite, p-queue) | Task 1 |
| `.env` config vars | Task 2 |
| SQLite schema | Task 3 |
| Session CRUD, history limit 10, expire 30min, reset | Task 4 |
| Per-channel queue, max 5 pending, 90s timeout | Task 5 |
| Text-to-image via `/v1/images/generations` | Task 6 |
| Image-to-image via `/v1/images/edits` | Task 6 |
| Mention parsing | Task 7 |
| Empty prompt reply | Task 7 |
| Prompt > 4000 chars reply | Task 7 |
| Queue full reply | Task 7 |
| Channel whitelist check | Task 7 |
| Attachment detect (user upload) | Task 7 |
| lastImageUrl from history (refine) | Task 4 + 7 |
| Error messages (timeout, 4xx/5xx, wrong file type) | Task 7 |
| Log format | Task 7 |
| Bot permissions / intents | Task 8 |
| Graceful shutdown | Task 8 |
| YAGNI: no slash commands, no web dashboard, no rate limit | ✅ not built |

### Type Consistency Check

- `HistoryEntry` defined in Task 4 (`sessionStore.ts`), imported in Task 7 ✅
- `Config` defined in Task 2, used in Task 7 + 8 ✅
- `SessionStore` constructor `(db, historyLimit, expireMinutes)` — Task 4 defines, Task 8 calls ✅
- `QueueManager` constructor `(maxPending)` — Task 5 defines, Task 8 calls ✅
- `ImageService` constructor `(apiUrl, apiKey, model, size)` — Task 6 defines, Task 8 calls ✅
- `createMessageHandler(sessionStore, queueManager, imageService, config)` — Task 7 defines, Task 8 calls ✅

### Placeholder Scan ✅

No TBD/TODO/placeholder found in code blocks.
