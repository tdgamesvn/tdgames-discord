# TD GAMES Communication Hub Split Plan

> **For Hermes:** Use subagent-driven-development or Claude Code to implement this plan task-by-task. Do not mix Chat Storage/Agent Intelligence work into the production Discord bot once the split begins.

**Goal:** Tách toàn bộ Chat Storage Discord + Slack + ClickUp mapping + Agent retrieval ra một app riêng `tdgames-communications`, để `tdgames-discord` chỉ còn là Discord bot tools cho Image Gen, Text Chat, Upscaler và các tool Discord runtime.

**Architecture:** `tdgames-discord` remains the operational Discord bot. `tdgames-communications` becomes the project-first Communication Intelligence Hub for Hermes agents, ingesting Discord/Slack messages, syncing ClickUp hierarchy, mapping channels to ClickUp projects, enforcing agent access, and exposing context/search APIs.

**Tech Stack:** Node.js/TypeScript, Express, better-sqlite3, Vitest, SQLite FTS5 first; optional embeddings/vector DB in later phase.

---

## Current Context

### Existing apps

| App | Current role | Target role |
|---|---|---|
| `/Users/tdgames_mac01/work/apps/tdgames-discord` | Discord bot + Config UI + recently added chat storage + temporary Slack UI integration | Keep Discord bot tools only: Image Gen, Text Chat, Upscaler, operational bot config |
| `/Users/tdgames_mac01/work/apps/tdgames-slack` | Slack user-token storage/backfill + small UI | Become source module or be absorbed into `tdgames-communications` |
| New: `/Users/tdgames_mac01/work/apps/tdgames-communications` | Does not exist yet | Unified Communication Hub for Hermes agents |

### Important user requirement

Sếp wants:

```text
ClickUp project first
→ map only relevant Discord/Slack channels
→ assign allowed agents
→ retrieve summaries/search context efficiently
→ avoid agents reading all Discord/Slack and wasting tokens
```

### Current risk

Recent work added Slack and Communication Hub concepts into:

```text
/Users/tdgames_mac01/work/apps/tdgames-discord/tools/config-ui/server.ts
```

This should be moved out to avoid polluting `tdgames-discord` and accidentally affecting Discord bot tool UX.

---

## Target Architecture

```text
Hermes Agents (@pm/@ceo/@hr/@finance)
        │
        ▼
/tdgames-communications
        ├── ClickUp hierarchy cache
        ├── Unified Discord + Slack channel catalog
        ├── Project ↔ channel mappings
        ├── Agent project/channel access policy
        ├── Raw messages
        ├── Summary cache
        ├── FTS/vector retrieval
        └── Agent Context API

/tdgames-discord
        ├── Discord bot runtime
        ├── Image Gen
        ├── Text Chat
        ├── Upscaler
        └── Discord tool Config UI only
```

---

## Target UI/UX for `tdgames-communications`

App name:

```text
TD GAMES Communication Hub
```

Recommended port:

```text
http://localhost:3460
```

Navigation:

```text
Dashboard
Projects
Sources
Agents
Search
Backfill
Settings
```

### Dashboard

Show system health:

| Metric | Meaning |
|---|---|
| ClickUp projects synced | Number of folders/lists cached |
| Discord channels indexed | Total active Discord channels |
| Slack channels indexed | Total active Slack channels |
| Mapped channels | Channels assigned to projects |
| Unmapped channels | Channels needing assignment |
| Agent coverage | Which agents can read which projects |
| Backfill status | Discord/Slack ingestion health |

### Projects — primary screen

Project-first workflow:

```text
[Sync ClickUp]

ClickUp Tree
└── Space
    └── Folder / Project
        └── Lists

Selected Project: ORCA
├── ClickUp lists
├── Discord mappings
├── Slack mappings
├── Agent access
└── Retrieval settings
```

No manual ID-first input. IDs can be visible as secondary technical metadata.

### Sources

Manage platform ingestion:

```text
Discord
├── servers
├── categories
├── channels
└── backfill state

Slack
├── workspaces
├── public/private channels
├── Slack Connect channels
└── backfill state
```

### Agents

Matrix view:

| Agent | Projects | Access | Notes |
|---|---|---|---|
| PM | ORCA, Ninetails | full project context | ClickUp + mapped comms |
| CEO | all mapped projects | summary only | no raw spam by default |
| Finance | payment/billing scopes | restricted | no art/dev chatter by default |
| HR | HR/people scopes | restricted | sensitive data handling |

### Search

Project-scoped search:

```text
Project: ORCA
Sources: Discord + Slack + ClickUp
Range: last 30 days
Mode: Summary / Full-text / Vector
Query: client feedback animation
```

---

## Data Model — Phase 1

Create one SQLite DB in the new app:

```text
/Users/tdgames_mac01/work/apps/tdgames-communications/data/communications.db
```

### `clickup_spaces`

```sql
CREATE TABLE IF NOT EXISTS clickup_spaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  raw_json TEXT NOT NULL DEFAULT '{}',
  synced_at INTEGER NOT NULL
);
```

### `clickup_folders`

```sql
CREATE TABLE IF NOT EXISTS clickup_folders (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL,
  name TEXT NOT NULL,
  raw_json TEXT NOT NULL DEFAULT '{}',
  synced_at INTEGER NOT NULL,
  FOREIGN KEY(space_id) REFERENCES clickup_spaces(id)
);
```

### `clickup_lists`

```sql
CREATE TABLE IF NOT EXISTS clickup_lists (
  id TEXT PRIMARY KEY,
  folder_id TEXT,
  space_id TEXT NOT NULL,
  name TEXT NOT NULL,
  raw_json TEXT NOT NULL DEFAULT '{}',
  synced_at INTEGER NOT NULL
);
```

### `communication_projects`

Usually one ClickUp Folder = one project.

```sql
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
```

### `communication_sources`

```sql
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
```

### `communication_channels`

```sql
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
```

### `project_channel_mappings`

```sql
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
```

### `agent_project_access`

```sql
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
```

### Raw messages

```sql
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
```

---

## Retrieval Plan

Do not start with heavy vector infrastructure. Use staged retrieval:

### Stage 1 — scoped SQL + summaries

Agent request must first resolve:

```text
agent_key + project_id → allowed channel IDs
```

Then query only mapped channels.

### Stage 2 — SQLite FTS5

Add:

```sql
CREATE VIRTUAL TABLE communication_message_fts USING fts5(
  text,
  content='communication_messages',
  content_rowid='id'
);
```

Use for project-scoped full-text search.

### Stage 3 — chunk summaries

Create:

```text
conversation_chunks
project_daily_summaries
channel_daily_summaries
```

Summaries reduce token load for normal reports.

### Stage 4 — vector database

Only after Stage 1-3 are stable.

Options:

| Option | Use when |
|---|---|
| SQLite + local embedding table | Small local deployment |
| LanceDB | Local vector file DB |
| Supabase pgvector | Centralized company data |
| Qdrant | Dedicated scalable vector search |

Recommended long-term if TD GAMES moves this central: **Supabase pgvector**.

---

## API Design

### ClickUp sync/cache

```text
GET  /api/clickup/tree
POST /api/clickup/import-tree
POST /api/clickup/sync
```

Phase 1 can support `import-tree` from Hermes-generated JSON. Later add direct ClickUp REST token sync.

### Sources

```text
GET /api/sources
GET /api/channels?platform=discord|slack
GET /api/channels/unmapped
```

### Projects

```text
GET  /api/projects
POST /api/projects/from-clickup-folder
GET  /api/projects/:id
PUT  /api/projects/:id
```

### Mappings

```text
GET    /api/projects/:id/channel-mappings
POST   /api/projects/:id/channel-mappings
DELETE /api/projects/:id/channel-mappings/:mappingId
```

### Agent access

```text
GET /api/projects/:id/agent-access
PUT /api/projects/:id/agent-access
```

### Agent context

```text
GET /api/agent-context?agent=pm&project=ORCA&period=7d
```

Response shape:

```json
{
  "project": {},
  "clickup": {},
  "access": {},
  "summaries": [],
  "relevantChunks": [],
  "recentMessages": []
}
```

---

## Migration Strategy

### Principle

Do not delete old DBs initially. Import/copy into `tdgames-communications`, verify counts, then optionally disable old chat storage features.

### From `tdgames-discord`

Source DB:

```text
/Users/tdgames_mac01/work/apps/tdgames-discord/data/bot.db
```

Likely source tables:

```text
discord_servers
discord_channels
discord_messages
discord_message_events
discord_backfill_runs
discord_clickup_mappings
discord_channel_groups
discord_agent_channel_access
```

Import to unified tables:

```text
discord_servers → communication_sources
discord_channels → communication_channels
discord_messages → communication_messages
discord_clickup_mappings → project_channel_mappings after project resolution
```

### From `tdgames-slack`

Source DB:

```text
/Users/tdgames_mac01/work/apps/tdgames-slack/data/slack.db
```

Source tables:

```text
slack_workspaces
slack_channels
slack_messages
clickup_project_mappings
```

Import to unified tables:

```text
slack_workspaces → communication_sources
slack_channels → communication_channels
slack_messages → communication_messages
clickup_project_mappings → project_channel_mappings after project resolution
```

---

## Rollback / Cleanup in `tdgames-discord`

After `tdgames-communications` is functional:

1. Remove temporary Slack tab and `/api/slack/*` from:

```text
/Users/tdgames_mac01/work/apps/tdgames-discord/tools/config-ui/server.ts
```

2. Decide whether to keep or remove Discord chat-storage module in `tdgames-discord`:

Recommended:

- Keep **minimal bridge/event forwarder** only if needed.
- Move storage/backfill/admin UI to `tdgames-communications`.

3. Ensure existing Discord bot features still pass tests:

```bash
cd /Users/tdgames_mac01/work/apps/tdgames-discord
npm run build
npm test
```

4. Verify current bot UI still has:

```text
Overview
Image Gen
Text Chat
Upscaler
Settings
Logs
```

No Slack/ClickUp Intelligence Hub in this app.

---

## Implementation Tasks

### Task 1: Create new app skeleton

**Objective:** Create `/Users/tdgames_mac01/work/apps/tdgames-communications` with TypeScript, Express, SQLite, Vitest.

**Files:**

- Create: `/Users/tdgames_mac01/work/apps/tdgames-communications/package.json`
- Create: `/Users/tdgames_mac01/work/apps/tdgames-communications/tsconfig.json`
- Create: `/Users/tdgames_mac01/work/apps/tdgames-communications/src/index.ts`
- Create: `/Users/tdgames_mac01/work/apps/tdgames-communications/src/config.ts`
- Create: `/Users/tdgames_mac01/work/apps/tdgames-communications/AGENTS.md`
- Create: `/Users/tdgames_mac01/work/apps/tdgames-communications/.env.example`

**Verification:**

```bash
cd /Users/tdgames_mac01/work/apps/tdgames-communications
npm install
npm run build
npm test
```

Expected:

```text
build passes
test suite starts with at least one smoke test
```

---

### Task 2: Add unified database schema

**Objective:** Add core schema for ClickUp cache, sources, channels, project mappings, access, messages.

**Files:**

- Create: `src/db/db.ts`
- Create: `src/db/schema.ts`
- Create: `tests/schema.test.ts`

**Test cases:**

- `applySchema` creates all tables.
- `applySchema` is idempotent.
- Foreign keys are enabled.
- FTS table can be created if Stage 1 includes it.

**Verification:**

```bash
npm test -- tests/schema.test.ts
npm run build
```

---

### Task 3: Import Slack storage logic

**Objective:** Move/adapt Slack DB read/import logic from `tdgames-slack` into new unified app.

**Files:**

- Create: `src/import/slack-importer.ts`
- Create: `tests/slack-importer.test.ts`
- Read source: `/Users/tdgames_mac01/work/apps/tdgames-slack/src/db/admin-store.ts`
- Read source: `/Users/tdgames_mac01/work/apps/tdgames-slack/src/db/schema.ts`

**Behavior:**

- Read Slack workspaces/channels/messages from old Slack DB.
- Upsert them into unified `communication_sources`, `communication_channels`, `communication_messages`.
- Preserve external/private channel flags.
- Preserve raw JSON.

---

### Task 4: Import Discord chat storage logic

**Objective:** Move/adapt Discord chat storage/admin concepts into new unified app.

**Files:**

- Create: `src/import/discord-importer.ts`
- Create: `tests/discord-importer.test.ts`
- Read source: `/Users/tdgames_mac01/work/apps/tdgames-discord/src/features/chat-storage/`

**Behavior:**

- Import Discord servers/channels/messages from `bot.db`.
- Convert to unified source/channel/message schema.
- Preserve categories and active/inactive state.

---

### Task 5: Add ClickUp hierarchy cache

**Objective:** Eliminate manual ClickUp ID-first UX.

**Files:**

- Create: `src/clickup/cache-store.ts`
- Create: `src/clickup/import-tree.ts`
- Create: `tests/clickup-cache.test.ts`

**Initial input method:** Hermes exports ClickUp tree JSON using ClickUp MCP and posts/imports it.

**API:**

```text
GET  /api/clickup/tree
POST /api/clickup/import-tree
```

**Future option:** Direct ClickUp REST sync with `CLICKUP_API_TOKEN` if Sếp approves storing token.

---

### Task 6: Project-first mapping store

**Objective:** Create services to map ClickUp project/folder to Discord/Slack scopes and agent access.

**Files:**

- Create: `src/projects/project-store.ts`
- Create: `src/projects/mapping-store.ts`
- Create: `src/agents/access-store.ts`
- Create: `tests/project-mapping.test.ts`

**Behavior:**

- Create project from ClickUp folder/list.
- Add channel mappings by platform/scope.
- Add/update agent project access.
- Resolve allowed channel IDs for `agent + project`.

---

### Task 7: Build Communication Hub UI

**Objective:** Create Project-first UI, not platform-first UI.

**Files:**

- Create: `src/ui/server.ts`
- Create: `src/ui/routes.ts`
- Create: `src/ui/html.ts` or a simple frontend bundle if preferred
- Create: `tests/ui.test.ts`

**Screens:**

```text
Dashboard
Projects
Sources
Agents
Search
Backfill
Settings
```

**Must-have UX:**

- ClickUp tree picker.
- Select project → show Discord/Slack channel panels.
- Search/filter channels.
- Agent access checklist.
- Save mapping without manually typing ClickUp IDs.

---

### Task 8: Agent context API

**Objective:** Provide Hermes agents a clean project-scoped context endpoint.

**Files:**

- Create: `src/agent-context/context-service.ts`
- Create: `src/agent-context/routes.ts`
- Create: `tests/agent-context.test.ts`

**Endpoint:**

```text
GET /api/agent-context?agent=pm&project=ORCA&period=7d
```

**Rules:**

- Enforce `agent_project_access`.
- Use only mapped Discord/Slack channels for the project.
- Default to summaries + recent messages.
- Never return all workspace messages.

---

### Task 9: Add FTS search

**Objective:** Add SQLite FTS5 project-scoped search.

**Files:**

- Modify: `src/db/schema.ts`
- Create: `src/search/search-service.ts`
- Create: `tests/search-service.test.ts`

**Endpoint:**

```text
GET /api/search?projectId=...&agent=pm&q=...&platform=discord,slack
```

**Rules:**

- Search only channels allowed by project mapping and agent access.
- Return small snippets and message IDs, not huge raw dumps.

---

### Task 10: Add summary cache scaffold

**Objective:** Prepare token-efficient summaries.

**Files:**

- Create: `src/summaries/summary-store.ts`
- Create: `src/summaries/summary-runner.ts`
- Create: `tests/summary-store.test.ts`

**Tables:**

```text
channel_daily_summaries
project_daily_summaries
conversation_chunks
```

**Phase 1 behavior:** store manual or placeholder summaries. Actual LLM summarizer can be wired later.

---

### Task 11: Cleanup `tdgames-discord`

**Objective:** Remove temporary Communication Hub/Slack UI code from Discord bot project once replacement is ready.

**Files:**

- Modify: `/Users/tdgames_mac01/work/apps/tdgames-discord/tools/config-ui/server.ts`
- Possibly remove or deprecate: `/Users/tdgames_mac01/work/apps/tdgames-discord/src/features/chat-storage/`
- Keep: Image Gen, Text Chat, Upscaler code and Config UI tabs.

**Verification:**

```bash
cd /Users/tdgames_mac01/work/apps/tdgames-discord
npm run build
npm test
```

Expected:

```text
Image Gen / Text Chat / Upscaler tests continue passing.
Config UI no longer includes Slack Communication Hub.
```

---

### Task 12: Optional deprecate `tdgames-slack`

**Objective:** Decide if `tdgames-slack` becomes a library/source module or is fully absorbed.

Options:

| Option | Description | Recommendation |
|---|---|---|
| Keep `tdgames-slack` | Slack ingestion app stays separate, communications imports DB | Good short-term |
| Absorb into `tdgames-communications` | Move Slack client/backfill directly | Best long-term |
| Shared package | Extract Slack/Discord ingestion libs to `Work/libs` | Best if multiple apps need same code |

Recommended path:

```text
Short-term: keep old app, import DB.
Long-term: absorb Slack ingestion into tdgames-communications.
```

---

## Claude Code Usage Plan

Use Claude Code after this plan is approved.

### Recommended prompt

```text
You are implementing TD GAMES Communication Hub split.

Do not modify tdgames-discord runtime features except cleanup tasks explicitly requested.
Create /Users/tdgames_mac01/work/apps/tdgames-communications as a separate TypeScript/Express/SQLite app.
Follow .hermes/plans/2026-06-29_134537-split-communication-hub.md.
Start with Tasks 1-3 only.
Run npm build/test.
Return changed files and verification output.
```

### Recommended Claude command

```bash
cd /Users/tdgames_mac01/work/apps/tdgames-discord
claude -p "<prompt above>" --allowedTools "Read,Write,Edit,Bash,Glob,Grep" --max-turns 15
```

Use staged execution, not one giant prompt for all phases.

---

## Validation Checklist

Before declaring the split complete:

- [ ] `tdgames-communications` runs on its own port, recommended `3460`.
- [ ] ClickUp tree is selectable without typing IDs manually.
- [ ] Discord channels can be imported and mapped to projects.
- [ ] Slack channels can be imported and mapped to projects.
- [ ] Agent access is project-scoped.
- [ ] `GET /api/agent-context` returns scoped context only.
- [ ] Search is project-scoped.
- [ ] `tdgames-discord` build/test still passes.
- [ ] Image Gen still works.
- [ ] Text Chat still works.
- [ ] Upscaler still works.
- [ ] Slack/ClickUp Communication Hub code is no longer embedded in Discord bot Config UI.

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Breaking Discord bot tools | High | Keep new app separate; only cleanup after new app is verified |
| Data duplication across DBs | Medium | Import/copy first; do not delete old DBs until counts match |
| ClickUp API token security | Medium | Start with Hermes MCP/export cache; add token later only if approved |
| Vector DB over-engineering | Medium | Start with SQLite FTS5 + summaries |
| UI becomes too complex | Medium | Project-first workflow; Sources screen only for ingestion health |
| Agent retrieves too much context | High | Enforce agent + project + channel mapping before any search |

---

## Open Questions for Sếp

1. `tdgames-communications` port dùng `3460` được không?
2. ClickUp project chuẩn là **Folder = Project** đúng không? Hay có case **List = Project**?
3. Có cho phép lưu ClickUp API token trong `.env` để UI tự sync không, hay giai đoạn đầu dùng Hermes MCP sync/cache?
4. Agent CEO có được đọc raw messages không, hay chỉ summary mặc định?
5. Finance/HR có cần rules riêng để tự phát hiện payment/people channels không, hay gán thủ công trước?

---

## Recommended Decision

Proceed with this split:

```text
Phase A: create tdgames-communications + schema + importers
Phase B: build Project-first UI + ClickUp tree cache
Phase C: add agent context API + FTS search
Phase D: cleanup tdgames-discord Communication Hub code
Phase E: add summaries/vector retrieval
```

This is the cleanest long-term architecture and protects existing Discord bot tools from Communication Hub complexity.
