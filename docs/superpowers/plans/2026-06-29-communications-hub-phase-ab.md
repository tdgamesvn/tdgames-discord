# TD GAMES Communications Hub — Phase A-B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create `/Users/tdgames_mac01/Work/apps/tdgames-communications` — a standalone TypeScript/Express/SQLite app with ClickUp hierarchy cache, unified DB schema, and a minimal project-first UI shell.

**Architecture:** New app runs independently on port 3460 (configurable via `COMMUNICATIONS_PORT`). SQLite DB at `data/communications.db`. ClickUp tree imported via JSON (no token in Phase 1). Express serves both API and UI on the same port.

**Tech Stack:** Node.js/TypeScript 5.3, Express 4, better-sqlite3, Vitest, SQLite FTS5.

## Global Constraints

- App root: `/Users/tdgames_mac01/Work/apps/tdgames-communications` (capital W)
- Default port: `3460`, configurable via `COMMUNICATIONS_PORT` env var
- Do NOT modify tdgames-discord runtime code
- No ClickUp API token in Phase 1 — import-tree via JSON only
- ClickUp hierarchy: Space = client/customer, Folder = project, List = service
- All tables use `IF NOT EXISTS`; schema is idempotent
- FTS5 virtual table must be created alongside main schema
- TypeScript strict mode; `npm run build` must pass clean
- All tests via Vitest; `npm test` must pass

---

## File Map

| File | Responsibility |
|---|---|
| `package.json` | deps, scripts: dev/build/test/start |
| `tsconfig.json` | TypeScript strict, ESNext, outDir dist |
| `.env.example` | COMMUNICATIONS_PORT doc |
| `AGENTS.md` | agent operating rules for this app |
| `src/config.ts` | read env vars, export typed config |
| `src/index.ts` | Express app entry point, mount all routers |
| `src/db/db.ts` | open/return better-sqlite3 instance |
| `src/db/schema.ts` | `applySchema(db)` — all CREATE TABLE + FTS |
| `src/clickup/cache-store.ts` | read/write clickup_spaces/folders/lists |
| `src/clickup/import-tree.ts` | parse + upsert ClickUp tree JSON |
| `src/clickup/routes.ts` | GET /api/clickup/tree, POST /api/clickup/import-tree |
| `src/projects/routes.ts` | GET /api/projects (stub) |
| `src/ui/html.ts` | server-side HTML helpers (nav shell) |
| `src/ui/server.ts` | Express router for UI pages |
| `tests/schema.test.ts` | schema idempotence, FK, FTS |
| `tests/clickup-cache.test.ts` | import-tree round-trip |

---

### Task 1: App skeleton

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.env.example`
- Create: `AGENTS.md`
- Create: `src/config.ts`
- Create: `src/index.ts`

**Interfaces:**
- Produces: `config.PORT: number`, Express app listening on `config.PORT`

- [ ] **Step 1: Write smoke test**

```typescript
// tests/smoke.test.ts
import { describe, it, expect } from 'vitest'

describe('smoke', () => {
  it('true is true', () => {
    expect(true).toBe(true)
  })
})
```

- [ ] **Step 2: Create package.json**

```json
{
  "name": "tdgames-communications",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc --noEmit",
    "start": "tsx src/index.ts",
    "test": "vitest run"
  },
  "dependencies": {
    "better-sqlite3": "^9.4.3",
    "express": "^4.18.3"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.8",
    "@types/express": "^4.17.21",
    "@types/node": "^20.11.5",
    "tsx": "^4.7.0",
    "typescript": "^5.3.3",
    "vitest": "^1.2.2"
  }
}
```

- [ ] **Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 4: Create src/config.ts**

```typescript
export const config = {
  PORT: parseInt(process.env.COMMUNICATIONS_PORT ?? '3460', 10),
  DB_PATH: process.env.COMMUNICATIONS_DB_PATH ?? 'data/communications.db',
}
```

- [ ] **Step 5: Create src/index.ts**

```typescript
import express from 'express'
import { config } from './config.js'

export const app = express()
app.use(express.json())

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', app: 'tdgames-communications', port: config.PORT })
})

if (process.env.NODE_ENV !== 'test') {
  app.listen(config.PORT, () => {
    console.log(`TD GAMES Communication Hub running on http://localhost:${config.PORT}`)
  })
}
```

- [ ] **Step 6: Create .env.example**

```
COMMUNICATIONS_PORT=3460
COMMUNICATIONS_DB_PATH=data/communications.db
```

- [ ] **Step 7: Create AGENTS.md**

```markdown
# AGENTS.md — tdgames-communications

TD GAMES Communication Hub. Standalone app separate from tdgames-discord.

## Rules
- Never modify tdgames-discord runtime features
- No ClickUp API token in Phase 1; use import-tree JSON workflow
- ClickUp hierarchy: Space = client, Folder = project, List = service
- DB at data/communications.db (gitignored)
- Port 3460 default, COMMUNICATIONS_PORT env to override
```

- [ ] **Step 8: Run npm install**

```bash
cd /Users/tdgames_mac01/Work/apps/tdgames-communications
npm install
```

Expected: installs without errors.

- [ ] **Step 9: Run build + test**

```bash
npm run build && npm test
```

Expected: build passes, smoke test passes.

- [ ] **Step 10: Commit**

```bash
git init
git add .
git commit -m "feat: bootstrap tdgames-communications app skeleton"
```

---

### Task 2: DB schema

**Files:**
- Create: `src/db/db.ts`
- Create: `src/db/schema.ts`
- Create: `tests/schema.test.ts`

**Interfaces:**
- Produces: `openDb(path: string): Database`, `applySchema(db: Database): void`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/schema.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { applySchema } from '../src/db/schema.js'

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
})

afterEach(() => {
  db.close()
})

const EXPECTED_TABLES = [
  'clickup_spaces',
  'clickup_folders',
  'clickup_lists',
  'communication_projects',
  'communication_sources',
  'communication_channels',
  'project_channel_mappings',
  'agent_project_access',
  'communication_messages',
]

describe('applySchema', () => {
  it('creates all required tables', () => {
    applySchema(db)
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table'`)
      .all()
      .map((r: any) => r.name)
    for (const t of EXPECTED_TABLES) {
      expect(tables).toContain(t)
    }
  })

  it('is idempotent — safe to call twice', () => {
    applySchema(db)
    expect(() => applySchema(db)).not.toThrow()
  })

  it('enforces foreign keys', () => {
    applySchema(db)
    const fk = db.pragma('foreign_keys') as Array<{ foreign_keys: number }>
    expect(fk[0].foreign_keys).toBe(1)
  })

  it('creates FTS virtual table', () => {
    applySchema(db)
    const fts = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='communication_message_fts'`)
      .get()
    expect(fts).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify failure**

```bash
npm test -- tests/schema.test.ts
```

Expected: FAIL — `applySchema` not found.

- [ ] **Step 3: Create src/db/db.ts**

```typescript
import Database from 'better-sqlite3'
import { mkdirSync } from 'fs'
import { dirname } from 'path'

export function openDb(path: string): Database.Database {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true })
  }
  const db = new Database(path)
  db.pragma('foreign_keys = ON')
  db.pragma('journal_mode = WAL')
  return db
}
```

- [ ] **Step 4: Create src/db/schema.ts**

```typescript
import type Database from 'better-sqlite3'

export function applySchema(db: Database.Database): void {
  db.pragma('foreign_keys = ON')

  db.exec(`
    CREATE TABLE IF NOT EXISTS clickup_spaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      raw_json TEXT NOT NULL DEFAULT '{}',
      synced_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS clickup_folders (
      id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL,
      name TEXT NOT NULL,
      raw_json TEXT NOT NULL DEFAULT '{}',
      synced_at INTEGER NOT NULL,
      FOREIGN KEY(space_id) REFERENCES clickup_spaces(id)
    );

    CREATE TABLE IF NOT EXISTS clickup_lists (
      id TEXT PRIMARY KEY,
      folder_id TEXT,
      space_id TEXT NOT NULL,
      name TEXT NOT NULL,
      raw_json TEXT NOT NULL DEFAULT '{}',
      synced_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS communication_projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      clickup_workspace_id TEXT NOT NULL,
      clickup_space_id TEXT NOT NULL,
      clickup_folder_id TEXT,
      clickup_list_ids_json TEXT NOT NULL DEFAULT '[]',
      project_name TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(clickup_workspace_id, clickup_folder_id)
    );

    CREATE TABLE IF NOT EXISTS communication_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform TEXT NOT NULL CHECK(platform IN ('discord','slack')),
      external_id TEXT NOT NULL,
      name TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      last_synced_at INTEGER,
      raw_json TEXT NOT NULL DEFAULT '{}',
      UNIQUE(platform, external_id)
    );

    CREATE TABLE IF NOT EXISTS communication_channels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform TEXT NOT NULL CHECK(platform IN ('discord','slack')),
      source_id INTEGER NOT NULL,
      external_channel_id TEXT NOT NULL,
      name TEXT NOT NULL,
      parent_external_id TEXT,
      category_name TEXT,
      is_private INTEGER NOT NULL DEFAULT 0,
      is_external INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      message_count INTEGER NOT NULL DEFAULT 0,
      last_message_at INTEGER,
      raw_json TEXT NOT NULL DEFAULT '{}',
      UNIQUE(platform, external_channel_id),
      FOREIGN KEY(source_id) REFERENCES communication_sources(id)
    );

    CREATE TABLE IF NOT EXISTS project_channel_mappings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      platform TEXT NOT NULL CHECK(platform IN ('discord','slack')),
      scope_type TEXT NOT NULL CHECK(scope_type IN ('source','category','channel','pattern')),
      scope_id TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(project_id, platform, scope_type, scope_id),
      FOREIGN KEY(project_id) REFERENCES communication_projects(id)
    );

    CREATE TABLE IF NOT EXISTS agent_project_access (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_key TEXT NOT NULL CHECK(agent_key IN ('pm','ceo','hr','finance')),
      project_id INTEGER NOT NULL,
      access_level TEXT NOT NULL CHECK(access_level IN ('read','summary','admin')) DEFAULT 'read',
      allowed_data_types_json TEXT NOT NULL DEFAULT '["summary","messages","clickup"]',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(agent_key, project_id),
      FOREIGN KEY(project_id) REFERENCES communication_projects(id)
    );

    CREATE TABLE IF NOT EXISTS communication_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform TEXT NOT NULL CHECK(platform IN ('discord','slack')),
      channel_id INTEGER NOT NULL,
      external_message_id TEXT NOT NULL,
      author_id TEXT,
      author_name TEXT,
      text TEXT NOT NULL DEFAULT '',
      thread_id TEXT,
      attachments_json TEXT NOT NULL DEFAULT '[]',
      raw_json TEXT NOT NULL DEFAULT '{}',
      message_ts INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(platform, external_message_id),
      FOREIGN KEY(channel_id) REFERENCES communication_channels(id)
    );
  `)

  // FTS5 virtual table — CREATE VIRTUAL TABLE does not support IF NOT EXISTS
  const ftsExists = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='communication_message_fts'`)
    .get()
  if (!ftsExists) {
    db.exec(`
      CREATE VIRTUAL TABLE communication_message_fts USING fts5(
        text,
        content='communication_messages',
        content_rowid='id'
      );
    `)
  }
}
```

- [ ] **Step 5: Run tests**

```bash
npm test -- tests/schema.test.ts
```

Expected: all 4 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/db/ tests/schema.test.ts
git commit -m "feat: add unified DB schema (9 tables + FTS5)"
```

---

### Task 5: ClickUp hierarchy cache

**Files:**
- Create: `src/clickup/cache-store.ts`
- Create: `src/clickup/import-tree.ts`
- Create: `src/clickup/routes.ts`
- Create: `tests/clickup-cache.test.ts`

**Interfaces:**
- Consumes: `openDb(path)`, `applySchema(db)` from Tasks 1-2
- Produces:
  - `importTree(db, tree: ClickUpTree): void`
  - `getTree(db): ClickUpTree`
  - Express router mounted at `/api/clickup`

**Types:**

```typescript
type ClickUpList = { id: string; name: string; raw?: object }
type ClickUpFolder = { id: string; name: string; lists: ClickUpList[]; raw?: object }
type ClickUpSpace = { id: string; name: string; folders: ClickUpFolder[]; raw?: object }
type ClickUpTree = { workspaceId: string; spaces: ClickUpSpace[] }
```

- [ ] **Step 1: Write failing tests**

```typescript
// tests/clickup-cache.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { applySchema } from '../src/db/schema.js'
import { importTree, getTree } from '../src/clickup/import-tree.js'
import type { ClickUpTree } from '../src/clickup/cache-store.js'

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  applySchema(db)
})

afterEach(() => {
  db.close()
})

const sampleTree: ClickUpTree = {
  workspaceId: 'ws1',
  spaces: [
    {
      id: 'sp1',
      name: 'ORCA Client',
      folders: [
        {
          id: 'f1',
          name: 'ORCA Project',
          lists: [
            { id: 'l1', name: 'Design' },
            { id: 'l2', name: 'Dev' },
          ],
        },
      ],
    },
  ],
}

describe('importTree', () => {
  it('inserts spaces, folders, and lists', () => {
    importTree(db, sampleTree)
    const spaces = db.prepare('SELECT * FROM clickup_spaces').all()
    const folders = db.prepare('SELECT * FROM clickup_folders').all()
    const lists = db.prepare('SELECT * FROM clickup_lists').all()
    expect(spaces).toHaveLength(1)
    expect(folders).toHaveLength(1)
    expect(lists).toHaveLength(2)
  })

  it('is idempotent — importing twice does not duplicate rows', () => {
    importTree(db, sampleTree)
    importTree(db, sampleTree)
    const spaces = db.prepare('SELECT * FROM clickup_spaces').all()
    expect(spaces).toHaveLength(1)
  })
})

describe('getTree', () => {
  it('returns empty tree when nothing imported', () => {
    const tree = getTree(db)
    expect(tree.spaces).toHaveLength(0)
  })

  it('returns imported tree with nested structure', () => {
    importTree(db, sampleTree)
    const tree = getTree(db)
    expect(tree.spaces).toHaveLength(1)
    expect(tree.spaces[0].name).toBe('ORCA Client')
    expect(tree.spaces[0].folders).toHaveLength(1)
    expect(tree.spaces[0].folders[0].lists).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run test to verify failure**

```bash
npm test -- tests/clickup-cache.test.ts
```

Expected: FAIL — modules not found.

- [ ] **Step 3: Create src/clickup/cache-store.ts**

```typescript
export type ClickUpList = { id: string; name: string; raw?: object }
export type ClickUpFolder = { id: string; name: string; lists: ClickUpList[]; raw?: object }
export type ClickUpSpace = { id: string; name: string; folders: ClickUpFolder[]; raw?: object }
export type ClickUpTree = { workspaceId: string; spaces: ClickUpSpace[] }
```

- [ ] **Step 4: Create src/clickup/import-tree.ts**

```typescript
import type Database from 'better-sqlite3'
import type { ClickUpTree, ClickUpSpace, ClickUpFolder, ClickUpList } from './cache-store.js'

export function importTree(db: Database.Database, tree: ClickUpTree): void {
  const now = Date.now()

  const upsertSpace = db.prepare(`
    INSERT INTO clickup_spaces (id, name, raw_json, synced_at)
    VALUES (@id, @name, @raw_json, @synced_at)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, raw_json=excluded.raw_json, synced_at=excluded.synced_at
  `)

  const upsertFolder = db.prepare(`
    INSERT INTO clickup_folders (id, space_id, name, raw_json, synced_at)
    VALUES (@id, @space_id, @name, @raw_json, @synced_at)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, raw_json=excluded.raw_json, synced_at=excluded.synced_at
  `)

  const upsertList = db.prepare(`
    INSERT INTO clickup_lists (id, folder_id, space_id, name, raw_json, synced_at)
    VALUES (@id, @folder_id, @space_id, @name, @raw_json, @synced_at)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, raw_json=excluded.raw_json, synced_at=excluded.synced_at
  `)

  const run = db.transaction((spaces: ClickUpSpace[]) => {
    for (const space of spaces) {
      upsertSpace.run({
        id: space.id,
        name: space.name,
        raw_json: JSON.stringify(space.raw ?? {}),
        synced_at: now,
      })

      for (const folder of space.folders) {
        upsertFolder.run({
          id: folder.id,
          space_id: space.id,
          name: folder.name,
          raw_json: JSON.stringify(folder.raw ?? {}),
          synced_at: now,
        })

        for (const list of folder.lists) {
          upsertList.run({
            id: list.id,
            folder_id: folder.id,
            space_id: space.id,
            name: list.name,
            raw_json: JSON.stringify(list.raw ?? {}),
            synced_at: now,
          })
        }
      }
    }
  })

  run(tree.spaces)
}

export function getTree(db: Database.Database): { workspaceId: string; spaces: any[] } {
  const spaces = db.prepare('SELECT * FROM clickup_spaces ORDER BY name').all() as any[]
  const folders = db.prepare('SELECT * FROM clickup_folders ORDER BY name').all() as any[]
  const lists = db.prepare('SELECT * FROM clickup_lists ORDER BY name').all() as any[]

  return {
    workspaceId: '',
    spaces: spaces.map((s) => ({
      id: s.id,
      name: s.name,
      synced_at: s.synced_at,
      folders: folders
        .filter((f) => f.space_id === s.id)
        .map((f) => ({
          id: f.id,
          name: f.name,
          synced_at: f.synced_at,
          lists: lists
            .filter((l) => l.folder_id === f.id)
            .map((l) => ({ id: l.id, name: l.name, synced_at: l.synced_at })),
        })),
    })),
  }
}
```

- [ ] **Step 5: Create src/clickup/routes.ts**

```typescript
import { Router } from 'express'
import type Database from 'better-sqlite3'
import { importTree, getTree } from './import-tree.js'
import type { ClickUpTree } from './cache-store.js'

export function makeClickUpRouter(db: Database.Database): Router {
  const router = Router()

  router.get('/tree', (_req, res) => {
    res.json(getTree(db))
  })

  router.post('/import-tree', (req, res) => {
    const body = req.body as ClickUpTree
    if (!body?.spaces || !Array.isArray(body.spaces)) {
      res.status(400).json({ error: 'body must have { spaces: [...] }' })
      return
    }
    importTree(db, body)
    res.json({ ok: true, spaces: body.spaces.length })
  })

  return router
}
```

- [ ] **Step 6: Run tests**

```bash
npm test -- tests/clickup-cache.test.ts
```

Expected: all 4 tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/clickup/ tests/clickup-cache.test.ts
git commit -m "feat: add ClickUp hierarchy cache + import-tree"
```

---

### Task UI: Minimal UI shell + wire everything

**Files:**
- Create: `src/ui/html.ts`
- Create: `src/ui/server.ts`
- Create: `src/projects/routes.ts`
- Modify: `src/index.ts`

**Interfaces:**
- Produces: `/` → Dashboard HTML; `/projects` → Projects HTML with ClickUp tree; `/api/dashboard` → JSON metrics
- All APIs: GET /api/health (exists), GET /api/clickup/tree, POST /api/clickup/import-tree, GET /api/projects, GET /api/dashboard

- [ ] **Step 1: Create src/ui/html.ts**

```typescript
export function page(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — TD GAMES Communication Hub</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; background: #0f0f0f; color: #e0e0e0; display: flex; min-height: 100vh; }
    nav { width: 200px; background: #1a1a1a; border-right: 1px solid #2a2a2a; padding: 1.5rem 0; flex-shrink: 0; }
    nav h1 { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.1em; color: #666; padding: 0 1rem 1rem; }
    nav a { display: block; padding: 0.6rem 1rem; color: #aaa; text-decoration: none; font-size: 0.9rem; }
    nav a:hover, nav a.active { background: #242424; color: #fff; }
    main { flex: 1; padding: 2rem; overflow-y: auto; }
    h2 { font-size: 1.25rem; margin-bottom: 1rem; color: #fff; }
    .card { background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 8px; padding: 1.25rem; margin-bottom: 1rem; }
    .tree ul { list-style: none; padding-left: 1.25rem; }
    .tree > ul { padding-left: 0; }
    .tree li { padding: 0.25rem 0; font-size: 0.9rem; }
    .tag { font-size: 0.7rem; background: #2a2a2a; color: #888; border-radius: 4px; padding: 1px 6px; margin-left: 0.5rem; }
    .metrics { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 1rem; }
    .metric { background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 8px; padding: 1rem; }
    .metric .value { font-size: 2rem; font-weight: 700; color: #fff; }
    .metric .label { font-size: 0.75rem; color: #666; margin-top: 0.25rem; }
    pre { background: #111; padding: 1rem; border-radius: 6px; overflow-x: auto; font-size: 0.8rem; color: #aaa; }
    .empty { color: #555; font-style: italic; }
    form { display: flex; gap: 0.5rem; align-items: flex-start; flex-wrap: wrap; }
    textarea { background: #111; color: #e0e0e0; border: 1px solid #333; border-radius: 6px; padding: 0.5rem; font-size: 0.8rem; width: 100%; height: 120px; font-family: monospace; }
    button { background: #2563eb; color: #fff; border: none; border-radius: 6px; padding: 0.5rem 1.25rem; cursor: pointer; font-size: 0.85rem; }
    button:hover { background: #1d4ed8; }
  </style>
</head>
<body>
  <nav>
    <h1>Communication Hub</h1>
    <a href="/">Dashboard</a>
    <a href="/projects">Projects</a>
    <a href="/sources">Sources</a>
    <a href="/agents">Agents</a>
    <a href="/search">Search</a>
    <a href="/backfill">Backfill</a>
    <a href="/settings">Settings</a>
  </nav>
  <main>${body}</main>
</body>
</html>`
}
```

- [ ] **Step 2: Create src/projects/routes.ts**

```typescript
import { Router } from 'express'
import type Database from 'better-sqlite3'

export function makeProjectsRouter(db: Database.Database): Router {
  const router = Router()

  router.get('/', (_req, res) => {
    const projects = db
      .prepare('SELECT * FROM communication_projects WHERE is_active=1 ORDER BY project_name')
      .all()
    res.json(projects)
  })

  return router
}
```

- [ ] **Step 3: Create src/ui/server.ts**

```typescript
import { Router } from 'express'
import type Database from 'better-sqlite3'
import { page } from './html.js'
import { getTree } from '../clickup/import-tree.js'

function renderTree(tree: ReturnType<typeof getTree>): string {
  if (!tree.spaces.length) {
    return '<p class="empty">No ClickUp data imported yet. Use the import form above.</p>'
  }
  const items = tree.spaces
    .map(
      (s) => `
    <li>📁 <strong>${s.name}</strong> <span class="tag">space</span>
      <ul>${s.folders
        .map(
          (f) => `
        <li>📂 ${f.name} <span class="tag">folder/project</span>
          <ul>${f.lists.map((l) => `<li>📋 ${l.name} <span class="tag">list</span></li>`).join('')}</ul>
        </li>`,
        )
        .join('')}</ul>
    </li>`,
    )
    .join('')
  return `<ul>${items}</ul>`
}

export function makeUiRouter(db: Database.Database): Router {
  const router = Router()

  router.get('/', (_req, res) => {
    const metrics = {
      spaces: (db.prepare('SELECT COUNT(*) as c FROM clickup_spaces').get() as any).c,
      folders: (db.prepare('SELECT COUNT(*) as c FROM clickup_folders').get() as any).c,
      lists: (db.prepare('SELECT COUNT(*) as c FROM clickup_lists').get() as any).c,
      projects: (db.prepare('SELECT COUNT(*) as c FROM communication_projects').get() as any).c,
      sources: (db.prepare('SELECT COUNT(*) as c FROM communication_sources').get() as any).c,
      channels: (db.prepare('SELECT COUNT(*) as c FROM communication_channels').get() as any).c,
    }
    const body = `
      <h2>Dashboard</h2>
      <div class="metrics">
        <div class="metric"><div class="value">${metrics.spaces}</div><div class="label">ClickUp Spaces</div></div>
        <div class="metric"><div class="value">${metrics.folders}</div><div class="label">ClickUp Folders (Projects)</div></div>
        <div class="metric"><div class="value">${metrics.lists}</div><div class="label">ClickUp Lists</div></div>
        <div class="metric"><div class="value">${metrics.projects}</div><div class="label">Comm Projects</div></div>
        <div class="metric"><div class="value">${metrics.sources}</div><div class="label">Sources (Discord/Slack)</div></div>
        <div class="metric"><div class="value">${metrics.channels}</div><div class="label">Channels Indexed</div></div>
      </div>`
    res.send(page('Dashboard', body))
  })

  router.get('/projects', (_req, res) => {
    const tree = getTree(db)
    const body = `
      <h2>Projects</h2>
      <div class="card">
        <h3 style="margin-bottom:0.75rem;font-size:1rem;">Import ClickUp Tree</h3>
        <p style="font-size:0.8rem;color:#666;margin-bottom:0.75rem;">Paste JSON from Hermes ClickUp MCP export and click Import.</p>
        <form id="importForm">
          <textarea id="treeJson" placeholder='{"workspaceId":"...","spaces":[...]}'></textarea>
          <button type="submit">Import</button>
        </form>
        <div id="importResult" style="margin-top:0.5rem;font-size:0.8rem;"></div>
        <script>
          document.getElementById('importForm').addEventListener('submit', async e => {
            e.preventDefault()
            const el = document.getElementById('importResult')
            try {
              const body = JSON.parse(document.getElementById('treeJson').value)
              const r = await fetch('/api/clickup/import-tree', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
              const data = await r.json()
              el.textContent = r.ok ? '✓ Imported: ' + data.spaces + ' space(s)' : '✗ ' + (data.error ?? 'error')
              if (r.ok) location.reload()
            } catch(err) {
              el.textContent = '✗ Invalid JSON'
            }
          })
        </script>
      </div>
      <div class="card tree">
        <h3 style="margin-bottom:0.75rem;font-size:1rem;">ClickUp Hierarchy</h3>
        ${renderTree(tree)}
      </div>`
    res.send(page('Projects', body))
  })

  const stub = (name: string) => (_req: any, res: any) => {
    res.send(page(name, `<h2>${name}</h2><div class="card"><p class="empty">Coming soon in a later phase.</p></div>`))
  }

  router.get('/sources', stub('Sources'))
  router.get('/agents', stub('Agents'))
  router.get('/search', stub('Search'))
  router.get('/backfill', stub('Backfill'))
  router.get('/settings', stub('Settings'))

  return router
}
```

- [ ] **Step 4: Wire everything in src/index.ts**

```typescript
import express from 'express'
import { config } from './config.js'
import { openDb } from './db/db.js'
import { applySchema } from './db/schema.js'
import { makeClickUpRouter } from './clickup/routes.js'
import { makeProjectsRouter } from './projects/routes.js'
import { makeUiRouter } from './ui/server.js'

export const app = express()
app.use(express.json())

const db = openDb(config.DB_PATH)
applySchema(db)

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', app: 'tdgames-communications', port: config.PORT })
})

app.get('/api/dashboard', (_req, res) => {
  res.json({
    clickup: {
      spaces: (db.prepare('SELECT COUNT(*) as c FROM clickup_spaces').get() as any).c,
      folders: (db.prepare('SELECT COUNT(*) as c FROM clickup_folders').get() as any).c,
      lists: (db.prepare('SELECT COUNT(*) as c FROM clickup_lists').get() as any).c,
    },
    sources: (db.prepare('SELECT COUNT(*) as c FROM communication_sources').get() as any).c,
    channels: (db.prepare('SELECT COUNT(*) as c FROM communication_channels').get() as any).c,
    projects: (db.prepare('SELECT COUNT(*) as c FROM communication_projects').get() as any).c,
  })
})

app.use('/api/clickup', makeClickUpRouter(db))
app.use('/api/projects', makeProjectsRouter(db))
app.use('/', makeUiRouter(db))

if (process.env.NODE_ENV !== 'test') {
  app.listen(config.PORT, () => {
    console.log(`TD GAMES Communication Hub running on http://localhost:${config.PORT}`)
  })
}
```

- [ ] **Step 5: Run full build + test**

```bash
npm run build && npm test
```

Expected: build passes, all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/ tests/
git commit -m "feat: add UI shell, API routes, wire Express app"
```

---

## Self-Review

**Spec coverage:**
- [x] Task 1: app skeleton, TypeScript + Express + better-sqlite3 + Vitest
- [x] Task 2: full schema — all 9 tables + FTS5
- [x] Task 5: ClickUp cache, import-tree, GET /api/clickup/tree, POST /api/clickup/import-tree
- [x] UI: nav (Dashboard, Projects, Sources, Agents, Search, Backfill, Settings)
- [x] Projects page: ClickUp tree from cache + import form
- [x] APIs: GET /api/health, GET /api/clickup/tree, POST /api/clickup/import-tree, GET /api/projects, GET /api/dashboard
- [x] Port 3460 default, COMMUNICATIONS_PORT configurable
- [x] No tdgames-discord runtime changes
- [x] No ClickUp token
- [x] ClickUp hierarchy: Space=client, Folder=project, List=service (reflected in UI labels)

**Gaps:** Tasks 3, 4, 6, 8, 9, 10, 11 are explicitly out of scope for this run.
