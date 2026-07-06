import express, { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import Database from 'better-sqlite3';
import { ChatStorageAdminStore } from '../../src/features/chat-storage/admin';
import type { ClickUpMappingInput } from '../../src/features/chat-storage/admin';

// ── Paths ────────────────────────────────────────────────────────────────────

const projectRoot = path.resolve(__dirname, '../../');
const envPath = path.join(projectRoot, '.env');
const envExamplePath = path.join(projectRoot, '.env.example');
const pidPath = path.join(projectRoot, 'data', 'bot.pid');
const dbPath = path.join(projectRoot, 'data', 'bot.db');
const slackProjectRoot = path.resolve(projectRoot, '../tdgames-slack');
const slackDbPath = path.join(slackProjectRoot, 'data', 'slack.db');

function getDb(): Database.Database {
  const db = new Database(dbPath);
  // Ensure tables used by Config UI exist (idempotent)
  db.exec(`
    CREATE TABLE IF NOT EXISTS channel_prompts (
      channel_id    TEXT PRIMARY KEY,
      system_prompt TEXT NOT NULL DEFAULT '',
      updated_at    INTEGER NOT NULL
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
      updated_at    INTEGER NOT NULL
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
      PRIMARY KEY (group_key, channel_id)
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
      UNIQUE(agent_key, channel_id)
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
  `);
  return db;
}

function getSlackDb(): Database.Database | null {
  if (!fs.existsSync(slackDbPath)) return null;
  const db = new Database(slackDbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS clickup_project_mappings (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      scope_type            TEXT NOT NULL CHECK(scope_type IN ('workspace','channel')),
      scope_id              TEXT NOT NULL,
      clickup_project_id    TEXT NOT NULL,
      clickup_project_name  TEXT NOT NULL,
      clickup_folder_id     TEXT,
      clickup_list_id       TEXT,
      agent_key             TEXT NOT NULL CHECK(agent_key IN ('PM','CEO','HR','Finance')),
      is_active             INTEGER NOT NULL DEFAULT 1,
      created_at            INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at            INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(scope_type, scope_id)
    )
  `);
  return db;
}

function getSlackSummary() {
  const db = getSlackDb();
  if (!db) return { workspaces: 0, channels: 0, messages: 0, mappings: 0, dbPath: slackDbPath, available: false };
  try {
    const row = db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM slack_workspaces) AS workspaces,
        (SELECT COUNT(*) FROM slack_channels) AS channels,
        (SELECT COUNT(*) FROM slack_messages) AS messages,
        (SELECT COUNT(*) FROM clickup_project_mappings) AS mappings
    `).get() as { workspaces: number; channels: number; messages: number; mappings: number };
    return { ...row, dbPath: slackDbPath, available: true };
  } finally {
    db.close();
  }
}

function listSlackWorkspaces() {
  const db = getSlackDb();
  if (!db) return [];
  try {
    return db.prepare(`
      SELECT
        w.id, w.name, w.domain,
        (SELECT COUNT(*) FROM slack_channels c WHERE c.workspace_id = w.id) AS channel_count,
        (SELECT COUNT(*) FROM slack_messages m WHERE m.workspace_id = w.id) AS message_count
      FROM slack_workspaces w
      ORDER BY w.name
    `).all();
  } finally {
    db.close();
  }
}

function listSlackChannels(workspaceId?: string) {
  const db = getSlackDb();
  if (!db) return [];
  try {
    const sql = `
      SELECT
        c.id, c.workspace_id,
        COALESCE(w.name, c.workspace_id) AS workspace_name,
        c.name, c.is_private, c.is_mpim, c.is_im,
        COUNT(m.id) AS message_count,
        pm.id AS mapping_id,
        pm.agent_key AS mapping_agent_key,
        pm.clickup_project_name AS mapping_project_name
      FROM slack_channels c
      LEFT JOIN slack_workspaces w ON w.id = c.workspace_id
      LEFT JOIN slack_messages m ON m.channel_id = c.id
      LEFT JOIN clickup_project_mappings pm ON pm.scope_id = c.id AND pm.scope_type = 'channel'
      ${workspaceId ? 'WHERE c.workspace_id = ?' : ''}
      GROUP BY c.id
      ORDER BY workspace_name, c.name
    `;
    return workspaceId ? db.prepare(sql).all(workspaceId) : db.prepare(sql).all();
  } finally {
    db.close();
  }
}

function listSlackMappings(activeOnly = false) {
  const db = getSlackDb();
  if (!db) return [];
  try {
    return db.prepare(`
      SELECT * FROM clickup_project_mappings
      ${activeOnly ? 'WHERE is_active = 1' : ''}
      ORDER BY scope_type, scope_id
    `).all();
  } finally {
    db.close();
  }
}

function upsertSlackMapping(input: Record<string, unknown>) {
  const db = getSlackDb();
  if (!db) throw new Error(`Slack DB not found: ${slackDbPath}`);
  try {
    const scopeType = String(input['scope_type'] ?? '');
    const scopeId = String(input['scope_id'] ?? '').trim();
    const projectId = String(input['clickup_project_id'] ?? '').trim();
    const projectName = String(input['clickup_project_name'] ?? '').trim();
    const agentKey = String(input['agent_key'] ?? 'PM');
    if (!['workspace', 'channel'].includes(scopeType)) throw new Error('scope_type must be workspace or channel');
    if (!scopeId || !projectId || !projectName) throw new Error('scope_id, clickup_project_id, clickup_project_name required');
    if (!['PM', 'CEO', 'HR', 'Finance'].includes(agentKey)) throw new Error('agent_key must be PM, CEO, HR, or Finance');
    db.prepare(`
      INSERT INTO clickup_project_mappings
        (scope_type, scope_id, clickup_project_id, clickup_project_name, clickup_folder_id, clickup_list_id, agent_key)
      VALUES (@scope_type, @scope_id, @clickup_project_id, @clickup_project_name, @clickup_folder_id, @clickup_list_id, @agent_key)
      ON CONFLICT(scope_type, scope_id) DO UPDATE SET
        clickup_project_id = excluded.clickup_project_id,
        clickup_project_name = excluded.clickup_project_name,
        clickup_folder_id = excluded.clickup_folder_id,
        clickup_list_id = excluded.clickup_list_id,
        agent_key = excluded.agent_key,
        is_active = 1,
        updated_at = unixepoch()
    `).run({
      scope_type: scopeType,
      scope_id: scopeId,
      clickup_project_id: projectId,
      clickup_project_name: projectName,
      clickup_folder_id: String(input['clickup_folder_id'] ?? '').trim() || null,
      clickup_list_id: String(input['clickup_list_id'] ?? '').trim() || null,
      agent_key: agentKey,
    });
    return db.prepare('SELECT * FROM clickup_project_mappings WHERE scope_type = ? AND scope_id = ?').get(scopeType, scopeId);
  } finally {
    db.close();
  }
}

const PORT = parseInt(process.env['CONFIG_UI_PORT'] ?? '3456', 10);

// ── Types ────────────────────────────────────────────────────────────────────

type EnvMap = Record<string, string>;

// ── .env Read/Write ──────────────────────────────────────────────────────────

function readEnv(): EnvMap {
  if (!fs.existsSync(envPath)) return {};
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  const result: EnvMap = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    result[key] = value;
  }
  return result;
}

function writeEnv(data: EnvMap): void {
  const tmpPath = `${envPath}.tmp`;

  if (fs.existsSync(envExamplePath)) {
    // Use .env.example as template, preserve section comments
    const exampleLines = fs.readFileSync(envExamplePath, 'utf-8').split('\n');
    const handledKeys = new Set<string>();
    const outputLines: string[] = [];

    for (const line of exampleLines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        outputLines.push(line);
        continue;
      }
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) {
        outputLines.push(line);
        continue;
      }
      const key = trimmed.slice(0, eqIdx).trim();
      handledKeys.add(key);
      if (key in data) {
        outputLines.push(`${key}=${data[key]}`);
      } else {
        outputLines.push(line);
      }
    }

    // Append keys present in form but not in .env.example
    const extraKeys = Object.keys(data).filter((k) => !handledKeys.has(k));
    if (extraKeys.length > 0) {
      outputLines.push('');
      outputLines.push('# ── EXTRA ───────────────────────────────────────────────────────────────────');
      for (const key of extraKeys) {
        outputLines.push(`${key}=${data[key]}`);
      }
    }

    fs.writeFileSync(tmpPath, outputLines.join('\n'), 'utf-8');
  } else {
    // No template — write key=value pairs directly
    const lines = Object.entries(data).map(([k, v]) => `${k}=${v}`);
    fs.writeFileSync(tmpPath, lines.join('\n') + '\n', 'utf-8');
  }

  fs.renameSync(tmpPath, envPath);
}

// ── Restart Logic ────────────────────────────────────────────────────────────

function restartBot(): void {
  // Kill existing process
  if (fs.existsSync(pidPath)) {
    try {
      const pid = parseInt(fs.readFileSync(pidPath, 'utf-8').trim(), 10);
      if (!isNaN(pid)) {
        process.kill(pid, 'SIGTERM');
      }
    } catch {
      // Ignore: process may already be dead
    }
  }

  // Spawn new bot process
  const child = spawn('npm', ['run', 'dev'], {
    detached: true,
    cwd: projectRoot,
    stdio: 'ignore',
  });
  child.unref();

  // Write new PID
  const dataDir = path.dirname(pidPath);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  fs.writeFileSync(pidPath, String(child.pid), 'utf-8');
}

// ── HTML Render Functions ────────────────────────────────────────────────────

function renderCss(): string {
  return `
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #1a1a2e;
      color: #e0e0e0;
      min-height: 100vh;
      display: flex;
      justify-content: center;
      align-items: flex-start;
      padding: 24px 16px 80px;
    }

    .container { width: 100%; max-width: 800px; }

    .header {
      font-size: 1.4rem;
      font-weight: 700;
      color: #a78bfa;
      margin-bottom: 20px;
      padding-bottom: 12px;
      border-bottom: 1px solid #2d2d4e;
    }

    /* ── Tabs ── */
    .tabs-nav {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      border-bottom: 1px solid #2d2d4e;
      margin-bottom: 28px;
    }
    .tab-btn {
      padding: 8px 14px;
      border: none;
      border-radius: 6px 6px 0 0;
      font-size: 0.82rem;
      font-weight: 600;
      cursor: pointer;
      background: #16213e;
      color: #7c7ca8;
      transition: background 0.15s, color 0.15s;
      white-space: nowrap;
    }
    .tab-btn:hover { background: #2d2d4e; color: #e0e0e0; }
    .tab-btn.active { background: #7c3aed; color: #fff; }
    .tab-panel { display: none; }
    .tab-panel.active { display: block; }

    /* ── Section ── */
    .section { margin-bottom: 28px; }
    .section-title {
      font-size: 0.75rem;
      font-weight: 700;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: #7c7ca8;
      margin-bottom: 14px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .section-title::before {
      content: '';
      display: inline-block;
      width: 3px;
      height: 14px;
      background: #a78bfa;
      border-radius: 2px;
    }

    /* ── Field ── */
    .field { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
    .field label { width: 180px; min-width: 180px; font-size: 0.875rem; color: #b0b0c8; }
    .field-input-wrap { flex: 1; position: relative; display: flex; align-items: center; }
    .field-input-wrap input {
      width: 100%;
      background: #16213e;
      border: 1px solid #2d2d4e;
      border-radius: 6px;
      color: #e0e0e0;
      font-size: 0.875rem;
      padding: 8px 12px;
      outline: none;
      transition: border-color 0.15s;
    }
    .field-input-wrap input:focus { border-color: #a78bfa; }
    .field-input-wrap input[type="password"],
    .field-input-wrap input.has-toggle { padding-right: 36px; }
    .field-hint {
      padding-left: 192px;
      margin-top: -6px;
      margin-bottom: 10px;
      font-size: 0.72rem;
      color: #7c7ca8;
      line-height: 1.4;
    }

    /* ── Select ── */
    .field-input-wrap select {
      width: 100%;
      background: #16213e;
      border: 1px solid #2d2d4e;
      border-radius: 6px;
      color: #e0e0e0;
      font-size: 0.875rem;
      padding: 8px 12px;
      outline: none;
      cursor: pointer;
      transition: border-color 0.15s;
      appearance: none;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%237c7ca8' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E");
      background-repeat: no-repeat;
      background-position: right 10px center;
      padding-right: 30px;
    }
    .field-input-wrap select:focus { border-color: #a78bfa; }

    /* ── Toggle btn ── */
    .toggle-btn {
      position: absolute;
      right: 8px;
      background: none;
      border: none;
      color: #7c7ca8;
      cursor: pointer;
      font-size: 1rem;
      padding: 2px;
      line-height: 1;
      display: flex;
      align-items: center;
    }
    .toggle-btn:hover { color: #a78bfa; }

    /* ── Tooltip ── */
    .tooltip-icon { color: #7c7ca8; cursor: help; font-size: 0.875rem; position: relative; }
    .tooltip-icon:hover::after {
      content: attr(data-tip);
      position: absolute;
      left: 100%;
      top: 50%;
      transform: translateY(-50%);
      margin-left: 8px;
      background: #2d2d4e;
      color: #e0e0e0;
      font-size: 0.75rem;
      padding: 4px 8px;
      border-radius: 4px;
      white-space: nowrap;
      pointer-events: none;
      z-index: 10;
    }

    /* ── Buttons ── */
    .btn {
      padding: 10px 20px;
      border: none;
      border-radius: 6px;
      font-size: 0.875rem;
      font-weight: 600;
      cursor: pointer;
      transition: opacity 0.15s, transform 0.1s;
    }
    .btn:hover { opacity: 0.85; }
    .btn:active { transform: scale(0.97); }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none !important; }
    .btn-save { background: #4f46e5; color: #fff; }
    .btn-restart { background: #059669; color: #fff; }
    .btn-danger { background: #dc2626; color: #fff; }
    .btn-sm { padding: 5px 12px; font-size: 0.8rem; }
    .btn-test {
      padding: 7px 12px;
      font-size: 0.78rem;
      font-weight: 600;
      border: none;
      border-radius: 5px;
      cursor: pointer;
      background: #2d2d4e;
      color: #b0b0c8;
      white-space: nowrap;
      transition: background 0.15s;
    }
    .btn-test:hover { background: #3d3d6e; }
    .btn-test.ok   { background: #064e3b; color: #6ee7b7; }
    .btn-test.fail { background: #7f1d1d; color: #fca5a5; }

    /* ── Actions bar ── */
    .actions { display: flex; gap: 12px; margin-top: 24px; }
    .divider { border: none; border-top: 1px solid #2d2d4e; margin: 24px 0; }

    /* ── Bot status ── */
    #bot-status { display: flex; align-items: center; gap: 7px; }
    #status-label { font-size: 0.8rem; color: #b0b0c8; }
    .status-dot {
      width: 9px;
      height: 9px;
      border-radius: 50%;
      background: #6b7280;
      flex-shrink: 0;
      transition: background 0.3s;
    }
    .status-dot.online     { background: #10b981; box-shadow: 0 0 6px #10b981; }
    .status-dot.offline    { background: #6b7280; }
    .status-dot.restarting { background: #f59e0b; animation: blink 0.8s ease-in-out infinite; }
    @keyframes blink {
      0%, 100% { opacity: 1; }
      50%       { opacity: 0.3; }
    }

    /* ── Toast ── */
    #toast {
      position: fixed;
      bottom: 28px;
      right: 28px;
      padding: 12px 20px;
      border-radius: 8px;
      font-size: 0.875rem;
      font-weight: 600;
      color: #fff;
      opacity: 0;
      transform: translateY(12px);
      transition: opacity 0.2s, transform 0.2s;
      pointer-events: none;
      z-index: 100;
      max-width: 320px;
    }
    #toast.show { opacity: 1; transform: translateY(0); }
    #toast.success { background: #059669; }
    #toast.error   { background: #dc2626; }

    /* ── Channel cards ── */
    .channel-card {
      background: #16213e;
      border: 1px solid #2d2d4e;
      border-radius: 8px;
      padding: 14px;
      margin-bottom: 12px;
    }
    .channel-card .channel-id-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 10px;
    }
    .channel-card .channel-id-row input {
      flex: 1;
      background: #1a1a2e;
      border: 1px solid #2d2d4e;
      border-radius: 5px;
      color: #e0e0e0;
      font-size: 0.875rem;
      padding: 6px 10px;
      outline: none;
    }
    .channel-card .channel-id-row input:focus { border-color: #a78bfa; }
    .channel-card textarea {
      width: 100%;
      background: #1a1a2e;
      border: 1px solid #2d2d4e;
      border-radius: 5px;
      color: #e0e0e0;
      font-size: 0.875rem;
      padding: 8px 10px;
      outline: none;
      resize: vertical;
      min-height: 60px;
      font-family: inherit;
    }
    .channel-card textarea:focus { border-color: #a78bfa; }
    .channel-card .card-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 10px; }
    .channel-name-label { font-size: 0.72rem; color: #a78bfa; margin-top: 4px; min-height: 16px; }
    .channel-name-hint {
      padding-left: 192px;
      margin-top: -4px;
      margin-bottom: 12px;
      font-size: 0.75rem;
      color: #a78bfa;
      min-height: 18px;
    }

    /* ── Log viewer ── */
    #log-content {
      background: #0d1117;
      border: 1px solid #2d2d4e;
      border-radius: 6px;
      padding: 12px;
      font-family: 'SF Mono', 'Fira Code', monospace;
      font-size: 0.72rem;
      line-height: 1.5;
      color: #8b8bae;
      max-height: 380px;
      overflow-y: auto;
      white-space: pre-wrap;
      word-break: break-all;
      margin-top: 10px;
    }
    #log-content:empty::before { content: '(trong)'; color: #4a4a6a; }

    /* ── Stats bar ── */
    .stats-bar {
      display: flex;
      background: #16213e;
      border: 1px solid #2d2d4e;
      border-radius: 8px;
      overflow: hidden;
      margin-bottom: 24px;
    }
    .stat-cell { flex: 1; padding: 12px 16px; border-right: 1px solid #2d2d4e; }
    .stat-cell:last-child { border-right: none; }
    .stat-label { font-size: 0.68rem; color: #7c7ca8; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 4px; }
    .stat-value { font-size: 1rem; font-weight: 700; color: #a78bfa; }
  `;
}

function renderTabNav(): string {
  return `
    <div class="tabs-nav">
      <button class="tab-btn active" data-tab="overview">&#x1F4CA; Overview</button>
      <button class="tab-btn" data-tab="image-gen">&#x1F5BC; Image Gen</button>
      <button class="tab-btn" data-tab="text-chat">&#x1F4AC; Text Chat</button>
      <button class="tab-btn" data-tab="upscaler">&#x2B06;&#xFE0F; Upscaler</button>
      <button class="tab-btn" data-tab="compressor">&#x1F5DC;&#xFE0F; Compressor</button>
      <button class="tab-btn" data-tab="intelligence">&#x1F9E0; Intelligence</button>
      <button class="tab-btn" data-tab="slack">&#x1F4AC; Slack</button>
      <button class="tab-btn" data-tab="settings">&#x2699;&#xFE0F; Settings</button>
      <button class="tab-btn" data-tab="logs">&#x1F4CB; Logs</button>
    </div>
  `;
}

function renderOverviewTab(): string {
  return `
  <div id="tab-overview" class="tab-panel active">

    <div class="stats-bar">
      <div class="stat-cell">
        <div class="stat-label">Hom nay</div>
        <div class="stat-value" id="stats-today">&#x2014;</div>
      </div>
      <div class="stat-cell">
        <div class="stat-label">7 ngay qua</div>
        <div class="stat-value" id="stats-week">&#x2014;</div>
      </div>
    </div>

    <div style="display:flex; align-items:center; gap:16px; background:#16213e; border:1px solid #2d2d4e; border-radius:8px; padding:16px 20px;">
      <div id="bot-status">
        <span class="status-dot" id="status-dot"></span>
        <span id="status-label">Checking...</span>
      </div>
      <button type="button" class="btn btn-restart" id="btn-restart" style="margin-left:auto;">
        &#x1F504; Restart Bot
      </button>
    </div>

  </div>
  `;
}

function renderImageGenTab(): string {
  return `
  <div id="tab-image-gen" class="tab-panel">

    <div class="section">
      <div class="section-title">Image Channels</div>
      <input type="hidden" id="IMAGE_CHANNEL_IDS" name="IMAGE_CHANNEL_IDS" />
      <div id="image-channel-list"></div>
      <button type="button" id="btn-add-image-channel" class="btn btn-save btn-sm" style="margin-top:8px;">+ Add Channel</button>
    </div>

    <hr class="divider" />

    <div class="section">
      <div class="section-title">Model Settings</div>

      <div class="field">
        <label for="IMAGE_MODEL">Model</label>
        <div class="field-input-wrap">
          <input type="text" id="IMAGE_MODEL" name="IMAGE_MODEL" placeholder="gpt-image-1" autocomplete="off" />
        </div>
      </div>
      <p class="field-hint">Model AI de sinh anh. Mac dinh: <strong style="color:#a78bfa">gpt-image-1</strong>.</p>

      <div class="field">
        <label for="IMAGE_SIZE">Size</label>
        <div class="field-input-wrap">
          <select id="IMAGE_SIZE" name="IMAGE_SIZE">
            <option value="auto">Tu dong &#x2014; Bot chon ti le theo noi dung</option>
            <option value="1024x1024">1024 x 1024 &#x2014; Vuong (1:1)</option>
            <option value="1536x1024">1536 x 1024 &#x2014; Ngang (3:2)</option>
            <option value="1024x1536">1024 x 1536 &#x2014; Doc (2:3)</option>
          </select>
        </div>
      </div>
      <p class="field-hint">Kich thuoc anh mac dinh. User override bang flag <code style="color:#a78bfa">--ratio</code>.</p>

      <div class="field">
        <label for="IMAGE_FALLBACK_MODEL">Fallback Model</label>
        <div class="field-input-wrap">
          <input type="text" id="IMAGE_FALLBACK_MODEL" name="IMAGE_FALLBACK_MODEL" placeholder="gpt-image-2" autocomplete="off" />
        </div>
      </div>
      <p class="field-hint">Model dung khi fallback sang OpenAI truc tiep (CLIProxy loi 5xx).</p>
    </div>

    <div class="actions">
      <button type="button" class="btn btn-save" id="btn-save-image-gen">&#x1F4BE; Save Image Gen</button>
    </div>

  </div>
  `;
}

function renderTextChatTab(): string {
  return `
  <div id="tab-text-chat" class="tab-panel">

    <div class="section">
      <div class="section-title">Text Channels</div>
      <input type="hidden" id="CHAT_CHANNEL_IDS" name="CHAT_CHANNEL_IDS" />
      <div id="text-channel-list"></div>
      <button type="button" id="btn-add-text-channel" class="btn btn-sm" style="background:#059669; color:#fff; margin-top:8px;">+ Add Channel</button>
    </div>

    <hr class="divider" />

    <div class="section">
      <div class="section-title">Model Settings</div>

      <div class="field">
        <label for="CHAT_MODEL">Model</label>
        <div class="field-input-wrap">
          <input type="text" id="CHAT_MODEL" name="CHAT_MODEL" placeholder="gpt-4o-mini" autocomplete="off" />
        </div>
      </div>
      <p class="field-hint">Model AI dung cho Text Channel. Mac dinh: <strong style="color:#a78bfa">gpt-4o-mini</strong>.</p>

      <div class="field">
        <label for="CHAT_FALLBACK_MODEL">Fallback Model</label>
        <div class="field-input-wrap">
          <input type="text" id="CHAT_FALLBACK_MODEL" name="CHAT_FALLBACK_MODEL" placeholder="gpt-4o-mini" autocomplete="off" />
        </div>
      </div>
      <p class="field-hint">Model dung khi fallback sang OpenAI truc tiep (CLIProxy loi 5xx).</p>
    </div>

    <div class="actions">
      <button type="button" class="btn btn-save" id="btn-save-text-chat">&#x1F4BE; Save Text Chat</button>
    </div>

  </div>
  `;
}

function renderUpscalerTab(): string {
  return `
  <div id="tab-upscaler" class="tab-panel">

    <div class="section">
      <div class="section-title">Upscaler Channels</div>
      <input type="hidden" id="UPSCALE_CHANNEL_IDS" name="UPSCALE_CHANNEL_IDS" />
      <div id="upscaler-channel-list"></div>
      <button type="button" id="btn-add-upscaler-channel" class="btn btn-sm" style="background:#7c3aed; color:#fff; margin-top:8px;">+ Add Channel</button>
    </div>

    <hr class="divider" />

    <div class="section">
      <div class="section-title">Upscayl Settings</div>

      <div class="field">
        <label for="UPSCAYL_BIN_PATH">Bin Path</label>
        <div class="field-input-wrap">
          <input type="text" id="UPSCAYL_BIN_PATH" name="UPSCAYL_BIN_PATH"
            placeholder="/Applications/Upscayl.app/Contents/Resources/bin/upscayl-bin"
            autocomplete="off" />
        </div>
      </div>
      <p class="field-hint">Duong dan toi binary <code style="color:#a78bfa">upscayl-bin</code>. Cai qua <code>brew install --cask upscayl</code>.</p>

      <div class="field">
        <label for="UPSCAYL_MODELS_PATH">Models Path</label>
        <div class="field-input-wrap">
          <input type="text" id="UPSCAYL_MODELS_PATH" name="UPSCAYL_MODELS_PATH"
            placeholder="/Applications/Upscayl.app/Contents/Resources/models"
            autocomplete="off" />
        </div>
      </div>

      <div class="field">
        <label for="UPSCALE_SCALE">Scale</label>
        <div class="field-input-wrap">
          <select id="UPSCALE_SCALE" name="UPSCALE_SCALE">
            <option value="2">2x &#x2014; Nhanh, file nho</option>
            <option value="4">4x &#x2014; Mac dinh, can bang</option>
            <option value="8">8x &#x2014; Cham, file rat lon</option>
          </select>
        </div>
      </div>

      <div class="field">
        <label for="UPSCALE_MODEL">Model</label>
        <div class="field-input-wrap">
          <select id="UPSCALE_MODEL" name="UPSCALE_MODEL">
            <option value="digital-art-4x">digital-art-4x &#x2014; Anime / Game art (mac dinh)</option>
            <option value="high-fidelity-4x">high-fidelity-4x &#x2014; Giu chi tiet cao</option>
            <option value="remacri-4x">remacri-4x &#x2014; Anh thuc te</option>
            <option value="ultramix-balanced-4x">ultramix-balanced-4x &#x2014; Can bang</option>
            <option value="ultrasharp-4x">ultrasharp-4x &#x2014; Sac net</option>
          </select>
        </div>
      </div>
      <p class="field-hint">Voi game art/anime: <strong style="color:#a78bfa">digital-art-4x</strong>. Voi anh thuc: <strong style="color:#a78bfa">remacri-4x</strong>.</p>
    </div>

    <div class="actions">
      <button type="button" class="btn btn-save" id="btn-save-upscaler">&#x1F4BE; Save Upscaler</button>
    </div>

    <hr class="divider" />

    <div class="section">
      <div class="section-title">Upscaler Video Channels</div>
      <input type="hidden" id="UPSCALER_VIDEO_CHANNEL_IDS" name="UPSCALER_VIDEO_CHANNEL_IDS" />
      <div id="upscaler-video-channel-list"></div>
      <button type="button" id="btn-add-upscaler-video-channel" class="btn btn-sm" style="background:#7c3aed; color:#fff; margin-top:8px;">+ Add Channel</button>
    </div>

    <hr class="divider" />

    <div class="section">
      <div class="section-title">Upscaler Video Settings</div>

      <div class="field">
        <label for="UPSCALE_VIDEO_MAX_DURATION_SEC">Max Duration (sec)</label>
        <div class="field-input-wrap">
          <input type="number" id="UPSCALE_VIDEO_MAX_DURATION_SEC" name="UPSCALE_VIDEO_MAX_DURATION_SEC" placeholder="20" />
        </div>
      </div>
      <p class="field-hint">Video dai hon se bi tu choi &#x2014; upscale video ton tai nguyen GPU hon nhieu so voi anh.</p>

      <div class="field">
        <label for="FFMPEG_PATH">ffmpeg Path</label>
        <div class="field-input-wrap">
          <input type="text" id="FFMPEG_PATH" name="FFMPEG_PATH" placeholder="ffmpeg" autocomplete="off" />
        </div>
      </div>

      <div class="field">
        <label for="FFPROBE_PATH">ffprobe Path</label>
        <div class="field-input-wrap">
          <input type="text" id="FFPROBE_PATH" name="FFPROBE_PATH" placeholder="ffprobe" autocomplete="off" />
        </div>
      </div>
      <p class="field-hint">Can cai ffmpeg: <code style="color:#a78bfa">brew install ffmpeg</code>. Dung lai cung binary/model Real-ESRGAN o tren.</p>
    </div>

    <div class="actions">
      <button type="button" class="btn btn-save" id="btn-save-upscaler-video">&#x1F4BE; Save Upscaler Video</button>
    </div>

  </div>
  `;
}

function renderCompressorTab(): string {
  return `
  <div id="tab-compressor" class="tab-panel">

    <div class="section">
      <div class="section-title">Compressor Channels</div>
      <input type="hidden" id="COMPRESSOR_CHANNEL_IDS" name="COMPRESSOR_CHANNEL_IDS" />
      <div id="compressor-channel-list"></div>
      <button type="button" id="btn-add-compressor-channel" class="btn btn-sm" style="background:#7c3aed; color:#fff; margin-top:8px;">+ Add Channel</button>
    </div>
    <p class="field-hint">Bot tu nhan dien user gui anh hay video de nen tuong ung &#x2014; khong can lenh rieng.</p>

    <hr class="divider" />

    <div class="section">
      <div class="section-title">Compressor Settings</div>

      <div class="field">
        <label for="COMPRESS_IMAGE_QUALITY">Image Quality (WebP)</label>
        <div class="field-input-wrap">
          <input type="number" id="COMPRESS_IMAGE_QUALITY" name="COMPRESS_IMAGE_QUALITY" placeholder="85" min="1" max="100" />
        </div>
      </div>
      <p class="field-hint">Anh duoc convert sang WebP lossy. Cang cao cang net nhung file cang lon (mac dinh 85).</p>

      <div class="field">
        <label for="COMPRESS_VIDEO_CRF">Video CRF</label>
        <div class="field-input-wrap">
          <input type="number" id="COMPRESS_VIDEO_CRF" name="COMPRESS_VIDEO_CRF" placeholder="23" min="0" max="51" />
        </div>
      </div>
      <p class="field-hint">Video duoc recompress H.264. So cang thap chat luong cang cao, file cang lon (mac dinh 23).</p>

      <div class="field">
        <label for="COMPRESS_VIDEO_PRESET">Video Preset</label>
        <div class="field-input-wrap">
          <select id="COMPRESS_VIDEO_PRESET" name="COMPRESS_VIDEO_PRESET">
            <option value="veryfast">veryfast &#x2014; Nhanh, nen kem hon</option>
            <option value="fast">fast</option>
            <option value="medium">medium &#x2014; Mac dinh, can bang</option>
            <option value="slow">slow &#x2014; Cham hon, nen tot hon</option>
          </select>
        </div>
      </div>
      <p class="field-hint">Can ffmpeg (dung chung FFMPEG_PATH voi Upscaler Video).</p>
    </div>

    <div class="actions">
      <button type="button" class="btn btn-save" id="btn-save-compressor">&#x1F4BE; Save Compressor</button>
    </div>

  </div>
  `;
}

function renderIntelligenceTab(): string {
  return `
  <div id="tab-intelligence" class="tab-panel">

    <div class="section">
      <div class="section-title" style="justify-content:space-between;">
        <span>Chat Storage</span>
        <button type="button" id="btn-refresh-intelligence" class="btn btn-sm" style="background:#374151; color:#e5e7eb;">&#x21BB; Refresh</button>
      </div>
      <div id="intelligence-summary" style="display:grid; grid-template-columns:repeat(4,1fr); gap:8px; margin-bottom:14px;"></div>
    </div>

    <div style="display:grid; grid-template-columns:1fr 1fr; gap:20px;">

      <div>
        <div style="font-size:.75rem; color:#7c7ca8; font-weight:700; margin-bottom:10px; text-transform:uppercase; letter-spacing:0.08em;">Agent Groups</div>
        <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:10px;">
          <input id="group-key"  placeholder="group_key (vd: pm_project_updates)" style="background:#16213e; border:1px solid #2d2d4e; color:#e0e0e0; border-radius:6px; padding:7px; width:100%;" />
          <input id="group-name" placeholder="Display name" style="background:#16213e; border:1px solid #2d2d4e; color:#e0e0e0; border-radius:6px; padding:7px; width:100%;" />
          <select id="group-agent" style="background:#16213e; border:1px solid #2d2d4e; color:#e0e0e0; border-radius:6px; padding:7px;">
            <option value="pm">PM</option>
            <option value="ceo">CEO</option>
            <option value="hr">HR</option>
            <option value="finance">Finance</option>
          </select>
          <textarea id="group-desc" rows="2" placeholder="Description" style="width:100%; background:#16213e; border:1px solid #2d2d4e; color:#e0e0e0; border-radius:6px; padding:7px;"></textarea>
        </div>
        <div style="display:flex; gap:8px; margin-bottom:12px; flex-wrap:wrap;">
          <button type="button" id="btn-save-group" class="btn btn-save btn-sm">&#x1F4BE; Save Group</button>
          <button type="button" id="btn-sync-agent-access" class="btn btn-sm" style="background:#7c3aed; color:#fff;">&#x1F501; Sync Agent Access</button>
        </div>
        <div id="intelligence-groups" style="max-height:320px; overflow:auto;"></div>
      </div>

      <div>
        <div style="font-size:.75rem; color:#7c7ca8; font-weight:700; margin-bottom:10px; text-transform:uppercase; letter-spacing:0.08em;">Indexed Channels</div>
        <input id="channel-filter" placeholder="Search channel/server..." style="width:100%; background:#16213e; border:1px solid #2d2d4e; color:#e0e0e0; border-radius:6px; padding:7px; margin-bottom:8px;" />
        <div id="intelligence-channels" style="max-height:440px; overflow:auto;"></div>
      </div>

    </div>

    <p style="font-size:.72rem; color:#7c7ca8; margin-top:14px;">Gan channel vao group theo agent. Agent PM/CEO/HR/Finance se doc Discord data qua group/access mapping nay.</p>

    <hr class="divider" style="margin:20px 0;" />

    <div class="section">
      <div class="section-title">ClickUp Project Mapping</div>
      <p style="font-size:.75rem; color:#7c7ca8; margin-bottom:12px;">Anh xa Discord server/category/channel den ClickUp project theo agent. Khong can API key — nhap ID thu cong tu ClickUp.</p>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:14px;">
        <div style="display:flex; flex-direction:column; gap:8px;">
          <select id="cu-scope-type" style="background:#16213e; border:1px solid #2d2d4e; color:#e0e0e0; border-radius:6px; padding:7px;">
            <option value="channel">Channel</option>
            <option value="category">Category</option>
            <option value="guild">Server (Guild)</option>
          </select>
          <select id="cu-guild-id" style="background:#16213e; border:1px solid #2d2d4e; color:#e0e0e0; border-radius:6px; padding:7px;">
            <option value="">-- Select Server --</option>
          </select>
          <select id="cu-category-key" style="background:#16213e; border:1px solid #2d2d4e; color:#e0e0e0; border-radius:6px; padding:7px; display:none;">
            <option value="">-- Select Category --</option>
          </select>
          <select id="cu-channel-id" style="background:#16213e; border:1px solid #2d2d4e; color:#e0e0e0; border-radius:6px; padding:7px; display:none;">
            <option value="">-- Select Channel --</option>
          </select>
          <select id="cu-agent-key" style="background:#16213e; border:1px solid #2d2d4e; color:#e0e0e0; border-radius:6px; padding:7px;">
            <option value="pm">PM</option>
            <option value="ceo">CEO</option>
            <option value="hr">HR</option>
            <option value="finance">Finance</option>
          </select>
        </div>
        <div style="display:flex; flex-direction:column; gap:8px;">
          <input id="cu-project-id"   placeholder="ClickUp Project ID *" style="background:#16213e; border:1px solid #2d2d4e; color:#e0e0e0; border-radius:6px; padding:7px;" />
          <input id="cu-project-name" placeholder="ClickUp Project Name *" style="background:#16213e; border:1px solid #2d2d4e; color:#e0e0e0; border-radius:6px; padding:7px;" />
          <input id="cu-folder-id"    placeholder="Folder ID (optional)" style="background:#16213e; border:1px solid #2d2d4e; color:#e0e0e0; border-radius:6px; padding:7px;" />
          <input id="cu-list-id"      placeholder="List ID (optional)" style="background:#16213e; border:1px solid #2d2d4e; color:#e0e0e0; border-radius:6px; padding:7px;" />
          <button type="button" id="btn-save-cu-mapping" class="btn btn-save btn-sm" style="align-self:flex-start;">&#x1F4BE; Save Mapping</button>
        </div>
      </div>

      <div id="cu-mappings-list" style="max-height:320px; overflow:auto;"></div>
    </div>

  </div>
  `;
}

function renderSlackTab(): string {
  return `
  <div id="tab-slack" class="tab-panel">
    <div class="section">
      <div class="section-title" style="justify-content:space-between;">
        <span>Slack Chat Storage</span>
        <button type="button" id="btn-refresh-slack" class="btn btn-sm" style="background:#374151; color:#e5e7eb;">&#x21BB; Refresh</button>
      </div>
      <p style="font-size:.75rem; color:#7c7ca8; margin-bottom:12px;">Gop UI cua <code>tdgames-slack</code> vao Config UI nay. Du lieu doc tu <code>${slackDbPath}</code>.</p>
      <div id="slack-summary" style="display:grid; grid-template-columns:repeat(4,1fr); gap:8px; margin-bottom:14px;"></div>
    </div>

    <div style="display:grid; grid-template-columns:1fr 1fr; gap:20px;">
      <div>
        <div style="font-size:.75rem; color:#7c7ca8; font-weight:700; margin-bottom:10px; text-transform:uppercase; letter-spacing:0.08em;">Slack Channels</div>
        <input id="slack-channel-filter" placeholder="Search Slack workspace/channel..." style="width:100%; background:#16213e; border:1px solid #2d2d4e; color:#e0e0e0; border-radius:6px; padding:7px; margin-bottom:8px;" />
        <div id="slack-channels" style="max-height:520px; overflow:auto;"></div>
      </div>
      <div>
        <div style="font-size:.75rem; color:#7c7ca8; font-weight:700; margin-bottom:10px; text-transform:uppercase; letter-spacing:0.08em;">ClickUp Mapping</div>
        <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:12px;">
          <select id="slack-scope-type" style="background:#16213e; border:1px solid #2d2d4e; color:#e0e0e0; border-radius:6px; padding:7px;">
            <option value="channel">Channel</option>
            <option value="workspace">Workspace</option>
          </select>
          <select id="slack-scope-id" style="background:#16213e; border:1px solid #2d2d4e; color:#e0e0e0; border-radius:6px; padding:7px;">
            <option value="">-- Select Slack channel/workspace --</option>
          </select>
          <select id="slack-agent-key" style="background:#16213e; border:1px solid #2d2d4e; color:#e0e0e0; border-radius:6px; padding:7px;">
            <option value="PM">PM</option>
            <option value="CEO">CEO</option>
            <option value="HR">HR</option>
            <option value="Finance">Finance</option>
          </select>
          <input id="slack-project-id" placeholder="ClickUp Project ID *" style="background:#16213e; border:1px solid #2d2d4e; color:#e0e0e0; border-radius:6px; padding:7px;" />
          <input id="slack-project-name" placeholder="ClickUp Project Name *" style="background:#16213e; border:1px solid #2d2d4e; color:#e0e0e0; border-radius:6px; padding:7px;" />
          <input id="slack-folder-id" placeholder="Folder ID (optional)" style="background:#16213e; border:1px solid #2d2d4e; color:#e0e0e0; border-radius:6px; padding:7px;" />
          <input id="slack-list-id" placeholder="List ID (optional)" style="background:#16213e; border:1px solid #2d2d4e; color:#e0e0e0; border-radius:6px; padding:7px;" />
          <button type="button" id="btn-save-slack-mapping" class="btn btn-save btn-sm" style="align-self:flex-start;">&#x1F4BE; Save Slack Mapping</button>
        </div>
        <div id="slack-mappings-list" style="max-height:320px; overflow:auto;"></div>
      </div>
    </div>
  </div>
  `;
}

function renderSettingsTab(): string {
  return `
  <div id="tab-settings" class="tab-panel">

    <div class="section">
      <div class="section-title">Discord</div>

      <div class="field">
        <label for="DISCORD_TOKEN">Bot Token</label>
        <div class="field-input-wrap">
          <input type="password" id="DISCORD_TOKEN" name="DISCORD_TOKEN" class="has-toggle" autocomplete="off" />
          <button type="button" class="toggle-btn" data-target="DISCORD_TOKEN" title="Toggle">&#x1F441;</button>
        </div>
      </div>

      <div class="field">
        <label for="DISCORD_CLIENT_ID">Client ID</label>
        <div class="field-input-wrap">
          <input type="text" id="DISCORD_CLIENT_ID" name="DISCORD_CLIENT_ID" autocomplete="off" />
        </div>
      </div>

      <div class="field">
        <label for="ERROR_CHANNEL_ID">Error Channel</label>
        <div class="field-input-wrap">
          <input type="text" id="ERROR_CHANNEL_ID" name="ERROR_CHANNEL_ID"
                 placeholder="(optional) channel ID for error alerts" autocomplete="off" />
        </div>
        <span class="tooltip-icon" data-tip="Bot gui thong bao loi vao channel nay.">&#x2139;&#xFE0F;</span>
      </div>
      <div class="channel-name-hint" id="error-channel-name"></div>
    </div>

    <hr class="divider" />

    <div class="section">
      <div class="section-title">CLIProxy API</div>

      <div class="field">
        <label for="CLIPROXY_API_URL">API URL</label>
        <div class="field-input-wrap">
          <input type="text" id="CLIPROXY_API_URL" name="CLIPROXY_API_URL"
                 placeholder="http://localhost:8317" autocomplete="off" />
        </div>
        <button type="button" class="btn-test" id="btn-test-cliproxy">Test</button>
      </div>

      <div class="field">
        <label for="CLIPROXY_API_KEY">API Key</label>
        <div class="field-input-wrap">
          <input type="password" id="CLIPROXY_API_KEY" name="CLIPROXY_API_KEY" class="has-toggle" autocomplete="off" />
          <button type="button" class="toggle-btn" data-target="CLIPROXY_API_KEY" title="Toggle">&#x1F441;</button>
        </div>
      </div>
    </div>

    <hr class="divider" />

    <div class="section">
      <div class="section-title">OpenAI Fallback</div>
      <div class="field">
        <label for="OPENAI_API_KEY">API Key</label>
        <div class="field-input-wrap">
          <input type="password" id="OPENAI_API_KEY" name="OPENAI_API_KEY" class="has-toggle"
                 autocomplete="off" placeholder="sk-... (optional)" />
          <button type="button" class="toggle-btn" data-target="OPENAI_API_KEY" title="Toggle">&#x1F441;</button>
        </div>
      </div>
      <p class="field-hint">API key OpenAI du phong khi CLIProxy bi loi. Dung chung cho ca Image Gen va Text Chat. De trong neu khong dung fallback.</p>
    </div>

    <hr class="divider" />

    <div class="section">
      <div class="section-title">Session</div>

      <div class="field">
        <label for="SESSION_HISTORY_LIMIT">History Limit</label>
        <div class="field-input-wrap">
          <input type="number" id="SESSION_HISTORY_LIMIT" name="SESSION_HISTORY_LIMIT" min="1" />
        </div>
      </div>
      <p class="field-hint">So anh bot nho trong 1 session (dung cho edit lien tiep). Khuyen nghi: 3&#x2013;10.</p>

      <div class="field">
        <label for="SESSION_EXPIRE_MINUTES">Expire (minutes)</label>
        <div class="field-input-wrap">
          <input type="number" id="SESSION_EXPIRE_MINUTES" name="SESSION_EXPIRE_MINUTES" min="1" />
        </div>
      </div>
      <p class="field-hint">Thoi gian khong hoat dong truoc khi session tu xoa. Khuyen nghi: 30&#x2013;120.</p>
    </div>

    <hr class="divider" />

    <div class="section">
      <div class="section-title">Queue</div>

      <div class="field">
        <label for="CHANNEL_QUEUE_MAX_PENDING">Max Pending</label>
        <div class="field-input-wrap">
          <input type="number" id="CHANNEL_QUEUE_MAX_PENDING" name="CHANNEL_QUEUE_MAX_PENDING" min="1" />
        </div>
      </div>
      <p class="field-hint">So request cho toi da moi channel. Vuot qua: bot tu choi. Khuyen nghi: 3&#x2013;10.</p>
    </div>

    <div class="actions">
      <button type="button" class="btn btn-save" id="btn-save-settings">&#x1F4BE; Save Settings</button>
    </div>

  </div>
  `;
}

function renderLogsTab(): string {
  return `
  <div id="tab-logs" class="tab-panel">
    <div class="section">
      <div class="section-title" style="justify-content:space-between;">
        <span>Log Viewer</span>
        <div style="display:flex; gap:8px; align-items:center;">
          <select id="log-file-sel" style="background:#16213e; border:1px solid #2d2d4e; color:#e0e0e0; border-radius:4px; padding:5px 8px; font-size:0.78rem; cursor:pointer;">
            <option value="bot">bot.log</option>
            <option value="bot-error">bot.error.log</option>
            <option value="config-ui">config-ui.log</option>
            <option value="config-ui-error">config-ui.error.log</option>
            <option value="discord-backfill">discord-backfill.log</option>
          </select>
          <button id="btn-refresh-logs" style="background:#2d2d4e; color:#b0b0c8; border:none; border-radius:4px; padding:5px 10px; font-size:0.78rem; cursor:pointer; font-weight:600;">&#x21BB; Refresh</button>
        </div>
      </div>
      <pre id="log-content"></pre>
    </div>
  </div>
  `;
}

function renderClientJS(): string {
  return `
  <script>
    // ── Tab switching ──────────────────────────────────────────────────────────
    document.querySelectorAll('.tab-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        document.querySelectorAll('.tab-btn').forEach(function(b) { b.classList.remove('active'); });
        document.querySelectorAll('.tab-panel').forEach(function(p) { p.classList.remove('active'); });
        btn.classList.add('active');
        document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
      });
    });

    // ── Toast ──────────────────────────────────────────────────────────────────
    var toastTimer = null;
    function showToast(msg, type) {
      type = type || 'success';
      var el = document.getElementById('toast');
      el.textContent = msg;
      el.className = 'show ' + type;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(function() { el.className = ''; }, 3000);
    }

    // ── Password toggles ───────────────────────────────────────────────────────
    document.querySelectorAll('.toggle-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var input = document.getElementById(btn.getAttribute('data-target'));
        if (input) input.type = input.type === 'password' ? 'text' : 'password';
      });
    });

    // ── Bot status ─────────────────────────────────────────────────────────────
    function updateStatusUI(status) {
      var dot   = document.getElementById('status-dot');
      var label = document.getElementById('status-label');
      if (!dot || !label) return;
      dot.className = 'status-dot ' + status;
      label.textContent = status === 'online'     ? 'Bot Online'
                        : status === 'restarting' ? 'Restarting...'
                        :                           'Bot Offline';
      label.style.color = status === 'online'     ? '#10b981'
                        : status === 'restarting' ? '#f59e0b'
                        :                           '#6b7280';
    }

    async function checkBotStatus() {
      try {
        var res  = await fetch('/api/bot-status');
        var data = await res.json();
        updateStatusUI(data.status);
        return data.status;
      } catch(e) {
        updateStatusUI('offline');
        return 'offline';
      }
    }

    checkBotStatus();
    setInterval(checkBotStatus, 10000);

    // ── Restart Bot ────────────────────────────────────────────────────────────
    document.getElementById('btn-restart').addEventListener('click', async function() {
      var btn = document.getElementById('btn-restart');
      try {
        btn.disabled = true;
        btn.textContent = 'Restarting...';
        updateStatusUI('restarting');
        var res  = await fetch('/api/restart', { method: 'POST' });
        var json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Restart failed');
        var attempts = 0;
        var poll = async function() {
          attempts++;
          var status = await checkBotStatus();
          if (status === 'online') {
            showToast('Bot restarted!', 'success');
            btn.disabled = false;
            btn.textContent = 'Restart Bot';
          } else if (attempts < 30) {
            setTimeout(poll, 1000);
          } else {
            showToast('Bot dang mat nhieu thoi gian hon binh thuong', 'error');
            btn.disabled = false;
            btn.textContent = 'Restart Bot';
          }
        };
        setTimeout(poll, 1500);
      } catch(err) {
        showToast('Loi: ' + err.message, 'error');
        btn.disabled = false;
        btn.textContent = 'Restart Bot';
        updateStatusUI('offline');
      }
    });

    // ── Stats ──────────────────────────────────────────────────────────────────
    async function loadStats() {
      try {
        var res = await fetch('/api/stats');
        if (!res.ok) return;
        var data = await res.json();
        var today = data.today; var week = data.week;
        function fmt(d) {
          var img  = (d.generates || 0) + (d.edits || 0);
          var imgFb = d.image_openai || 0;
          var chat = (d.text_cliproxy || 0) + (d.text_openai || 0);
          return img + (imgFb ? '+' + imgFb + 'fb' : '') + ' anh - ' + chat + ' chat';
        }
        document.getElementById('stats-today').textContent = fmt(today);
        document.getElementById('stats-week').textContent  = fmt(week);
      } catch(e) { /* silent */ }
    }
    loadStats();
    setInterval(loadStats, 30000);

    // ── Channel name resolution ────────────────────────────────────────────────
    var channelNameCache = {};

    async function resolveChannelNames(ids) {
      if (!ids || ids.length === 0) return;
      var uncached = ids.filter(function(id) { return !channelNameCache[id]; });
      if (uncached.length === 0) return;
      try {
        var res = await fetch('/api/discord/channel-names?ids=' + uncached.join(','));
        if (!res.ok) return;
        Object.assign(channelNameCache, await res.json());
      } catch(e) { /* silent */ }
    }

    function applyNameLabel(card) {
      var idInput = card.querySelector('.channel-id-input');
      var nameEl  = card.querySelector('.channel-name-label');
      if (!idInput || !nameEl) return;
      var id   = idInput.value.trim();
      var name = id && channelNameCache[id];
      nameEl.textContent = name ? '#' + name : (id ? '(bot cannot access this channel)' : '');
      nameEl.style.color = name ? '#a78bfa' : '#f87171';
    }

    function syncHiddenIds(listId, hiddenId) {
      var ids = [];
      document.querySelectorAll('#' + listId + ' .channel-card').forEach(function(card) {
        var id = card.querySelector('.channel-id-input') && card.querySelector('.channel-id-input').value.trim();
        if (id) ids.push(id);
      });
      var el = document.getElementById(hiddenId);
      if (el) el.value = ids.join(',');
    }

    // ── Image Channel Manager ──────────────────────────────────────────────────
    function renderImageChannelCard(data) {
      data = data || { channelId: '', systemPrompt: '' };
      var card = document.createElement('div');
      card.className = 'channel-card';
      card.dataset.originalId = data.channelId;
      card.innerHTML =
        '<div class="channel-id-row">' +
          '<input type="text" placeholder="Channel ID" value="' + (data.channelId || '') + '" class="channel-id-input" />' +
          '<button class="btn btn-sm btn-danger btn-del-ch">&#x1F5D1;</button>' +
        '</div>' +
        '<div class="channel-name-label"></div>' +
        '<textarea class="channel-prompt-input" rows="2" placeholder="System prompt (optional)">' + (data.systemPrompt || '') + '</textarea>' +
        '<div class="card-actions">' +
          '<button class="btn btn-sm btn-save btn-save-ch">&#x1F4BE; Save</button>' +
        '</div>';

      if (data.channelId) {
        resolveChannelNames([data.channelId]).then(function() { applyNameLabel(card); });
      }

      card.querySelector('.btn-save-ch').addEventListener('click', async function() {
        var channelId    = card.querySelector('.channel-id-input').value.trim();
        var systemPrompt = card.querySelector('.channel-prompt-input').value;
        if (!channelId) { showToast('Channel ID is required', 'error'); return; }
        var oldId = card.dataset.originalId;
        try {
          if (oldId && oldId !== channelId) {
            await fetch('/api/channel-prompts/' + oldId, { method: 'DELETE' });
          }
          var r = await fetch('/api/channel-prompts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ channelId: channelId, systemPrompt: systemPrompt }),
          });
          if (!r.ok) throw new Error((await r.json()).error);
          card.dataset.originalId = channelId;
          syncHiddenIds('image-channel-list', 'IMAGE_CHANNEL_IDS');
          await resolveChannelNames([channelId]);
          applyNameLabel(card);
          showToast('Channel saved!', 'success');
        } catch(err) { showToast('Error: ' + err.message, 'error'); }
      });

      card.querySelector('.btn-del-ch').addEventListener('click', async function() {
        var channelId = card.querySelector('.channel-id-input').value.trim();
        if (channelId) {
          try { await fetch('/api/channel-prompts/' + channelId, { method: 'DELETE' }); } catch(e) { /* ignore */ }
        }
        card.remove();
        syncHiddenIds('image-channel-list', 'IMAGE_CHANNEL_IDS');
        showToast('Channel removed', 'success');
      });

      return card;
    }

    async function loadImageChannels() {
      try {
        var results = await Promise.all([
          fetch('/api/channel-prompts').then(function(r) { return r.json(); }),
          fetch('/api/config').then(function(r) { return r.json(); }),
        ]);
        var promptsRes = results[0]; var configRes = results[1];
        var promptMap = {};
        promptsRes.forEach(function(p) { promptMap[p.channelId] = p.systemPrompt; });
        // Chỉ hiện channel nằm trong IMAGE_CHANNEL_IDS — không catch-all từ DB
        var imageIds = (configRes.IMAGE_CHANNEL_IDS || '').split(',').map(function(s) { return s.trim(); }).filter(Boolean);
        var container = document.getElementById('image-channel-list');
        container.innerHTML = '';
        imageIds.forEach(function(id) { container.appendChild(renderImageChannelCard({ channelId: id, systemPrompt: promptMap[id] || '' })); });
        document.getElementById('IMAGE_CHANNEL_IDS').value = imageIds.join(',');
      } catch(err) { showToast('Failed to load image channels: ' + err.message, 'error'); }
    }

    document.getElementById('btn-add-image-channel').addEventListener('click', function() {
      document.getElementById('image-channel-list').appendChild(renderImageChannelCard({ channelId: '', systemPrompt: '' }));
    });

    document.getElementById('btn-save-image-gen').addEventListener('click', async function() {
      syncHiddenIds('image-channel-list', 'IMAGE_CHANNEL_IDS');
      var keys = ['IMAGE_CHANNEL_IDS', 'IMAGE_MODEL', 'IMAGE_SIZE', 'IMAGE_FALLBACK_MODEL'];
      var payload = {};
      keys.forEach(function(k) { var el = document.getElementById(k); if (el) payload[k] = el.value; });
      try {
        var res = await fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (!res.ok) throw new Error((await res.json()).error || 'Save failed');
        showToast('Image Gen saved!', 'success');
      } catch(err) { showToast('Error: ' + err.message, 'error'); }
    });

    // ── Text Channel Manager ───────────────────────────────────────────────────
    function renderTextChannelCard(data) {
      data = data || { channelId: '', systemPrompt: '' };
      var card = document.createElement('div');
      card.className = 'channel-card';
      card.style.borderColor = '#065f46';
      card.dataset.originalId = data.channelId;
      card.innerHTML =
        '<div class="channel-id-row">' +
          '<input type="text" placeholder="Channel ID" value="' + (data.channelId || '') + '" class="channel-id-input" />' +
          '<button class="btn btn-sm btn-danger btn-del-ch">&#x1F5D1;</button>' +
        '</div>' +
        '<div class="channel-name-label"></div>' +
        '<textarea class="channel-prompt-input" rows="2" placeholder="System prompt (optional)">' + (data.systemPrompt || '') + '</textarea>' +
        '<div class="card-actions">' +
          '<button class="btn btn-sm btn-save btn-save-ch" style="background:#059669;">&#x1F4BE; Save</button>' +
        '</div>';

      if (data.channelId) {
        resolveChannelNames([data.channelId]).then(function() { applyNameLabel(card); });
      }

      card.querySelector('.btn-save-ch').addEventListener('click', async function() {
        var channelId    = card.querySelector('.channel-id-input').value.trim();
        var systemPrompt = card.querySelector('.channel-prompt-input').value;
        if (!channelId) { showToast('Channel ID is required', 'error'); return; }
        var oldId = card.dataset.originalId;
        try {
          if (oldId && oldId !== channelId) {
            await fetch('/api/channel-prompts/' + oldId, { method: 'DELETE' });
          }
          var r = await fetch('/api/channel-prompts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ channelId: channelId, systemPrompt: systemPrompt }),
          });
          if (!r.ok) throw new Error((await r.json()).error);
          card.dataset.originalId = channelId;
          syncHiddenIds('text-channel-list', 'CHAT_CHANNEL_IDS');
          await resolveChannelNames([channelId]);
          applyNameLabel(card);
          showToast('Text channel saved!', 'success');
        } catch(err) { showToast('Error: ' + err.message, 'error'); }
      });

      card.querySelector('.btn-del-ch').addEventListener('click', async function() {
        var channelId = card.querySelector('.channel-id-input').value.trim();
        if (channelId) {
          try { await fetch('/api/channel-prompts/' + channelId, { method: 'DELETE' }); } catch(e) { /* ignore */ }
        }
        card.remove();
        syncHiddenIds('text-channel-list', 'CHAT_CHANNEL_IDS');
        showToast('Text channel removed', 'success');
      });

      return card;
    }

    async function loadTextChannels() {
      try {
        var results = await Promise.all([
          fetch('/api/channel-prompts').then(function(r) { return r.json(); }),
          fetch('/api/config').then(function(r) { return r.json(); }),
        ]);
        var promptsRes = results[0]; var configRes = results[1];
        var promptMap = {};
        promptsRes.forEach(function(p) { promptMap[p.channelId] = p.systemPrompt; });
        var textIds = (configRes.CHAT_CHANNEL_IDS || '').split(',').map(function(s) { return s.trim(); }).filter(Boolean);
        var container = document.getElementById('text-channel-list');
        container.innerHTML = '';
        textIds.forEach(function(id) { container.appendChild(renderTextChannelCard({ channelId: id, systemPrompt: promptMap[id] || '' })); });
        document.getElementById('CHAT_CHANNEL_IDS').value = textIds.join(',');
      } catch(err) { showToast('Failed to load text channels: ' + err.message, 'error'); }
    }

    document.getElementById('btn-add-text-channel').addEventListener('click', function() {
      document.getElementById('text-channel-list').appendChild(renderTextChannelCard({ channelId: '', systemPrompt: '' }));
    });

    document.getElementById('btn-save-text-chat').addEventListener('click', async function() {
      syncHiddenIds('text-channel-list', 'CHAT_CHANNEL_IDS');
      var keys = ['CHAT_CHANNEL_IDS', 'CHAT_MODEL', 'CHAT_FALLBACK_MODEL'];
      var payload = {};
      keys.forEach(function(k) { var el = document.getElementById(k); if (el) payload[k] = el.value; });
      try {
        var res = await fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (!res.ok) throw new Error((await res.json()).error || 'Save failed');
        showToast('Text Chat saved!', 'success');
      } catch(err) { showToast('Error: ' + err.message, 'error'); }
    });

    // ── Upscaler Channel Manager ───────────────────────────────────────────────
    function renderUpscalerChannelCard(channelId) {
      channelId = channelId || '';
      var card = document.createElement('div');
      card.className = 'channel-card';
      card.style.borderColor = '#7c3aed';
      card.innerHTML =
        '<div class="channel-id-row">' +
          '<input type="text" placeholder="Channel ID" value="' + channelId + '" class="channel-id-input" />' +
          '<button class="btn btn-sm btn-danger btn-del-ch">&#x1F5D1;</button>' +
        '</div>' +
        '<div class="channel-name-label"></div>' +
        '<div class="card-actions">' +
          '<button class="btn btn-sm btn-save btn-save-ch" style="background:#7c3aed;">&#x1F4BE; Save</button>' +
        '</div>';

      if (channelId) {
        resolveChannelNames([channelId]).then(function() { applyNameLabel(card); });
      }

      card.querySelector('.btn-save-ch').addEventListener('click', async function() {
        var id = card.querySelector('.channel-id-input').value.trim();
        if (!id) { showToast('Channel ID is required', 'error'); return; }
        syncHiddenIds('upscaler-channel-list', 'UPSCALE_CHANNEL_IDS');
        await resolveChannelNames([id]);
        applyNameLabel(card);
        showToast('Upscaler channel saved!', 'success');
      });

      card.querySelector('.btn-del-ch').addEventListener('click', function() {
        card.remove();
        syncHiddenIds('upscaler-channel-list', 'UPSCALE_CHANNEL_IDS');
        showToast('Upscaler channel removed', 'success');
      });

      return card;
    }

    async function loadUpscalerChannels() {
      try {
        var config = await fetch('/api/config').then(function(r) { return r.json(); });
        var ids    = (config.UPSCALE_CHANNEL_IDS || '').split(',').map(function(s) { return s.trim(); }).filter(Boolean);
        var container = document.getElementById('upscaler-channel-list');
        container.innerHTML = '';
        ids.forEach(function(id) { container.appendChild(renderUpscalerChannelCard(id)); });
        document.getElementById('UPSCALE_CHANNEL_IDS').value = ids.join(',');
      } catch(err) { showToast('Failed to load upscaler channels: ' + err.message, 'error'); }
    }

    document.getElementById('btn-add-upscaler-channel').addEventListener('click', function() {
      document.getElementById('upscaler-channel-list').appendChild(renderUpscalerChannelCard(''));
    });

    document.getElementById('btn-save-upscaler').addEventListener('click', async function() {
      syncHiddenIds('upscaler-channel-list', 'UPSCALE_CHANNEL_IDS');
      var keys = ['UPSCALE_CHANNEL_IDS', 'UPSCAYL_BIN_PATH', 'UPSCAYL_MODELS_PATH', 'UPSCALE_SCALE', 'UPSCALE_MODEL'];
      var payload = {};
      keys.forEach(function(k) { var el = document.getElementById(k); if (el) payload[k] = el.value; });
      try {
        var res = await fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (!res.ok) throw new Error((await res.json()).error || 'Save failed');
        showToast('Upscaler saved!', 'success');
      } catch(err) { showToast('Error: ' + err.message, 'error'); }
    });

    // ── Upscaler Video Channel Manager ─────────────────────────────────────────
    function renderUpscalerVideoChannelCard(channelId) {
      channelId = channelId || '';
      var card = document.createElement('div');
      card.className = 'channel-card';
      card.style.borderColor = '#7c3aed';
      card.innerHTML =
        '<div class="channel-id-row">' +
          '<input type="text" placeholder="Channel ID" value="' + channelId + '" class="channel-id-input" />' +
          '<button class="btn btn-sm btn-danger btn-del-ch">&#x1F5D1;</button>' +
        '</div>' +
        '<div class="channel-name-label"></div>' +
        '<div class="card-actions">' +
          '<button class="btn btn-sm btn-save btn-save-ch" style="background:#7c3aed;">&#x1F4BE; Save</button>' +
        '</div>';

      if (channelId) {
        resolveChannelNames([channelId]).then(function() { applyNameLabel(card); });
      }

      card.querySelector('.btn-save-ch').addEventListener('click', async function() {
        var id = card.querySelector('.channel-id-input').value.trim();
        if (!id) { showToast('Channel ID is required', 'error'); return; }
        syncHiddenIds('upscaler-video-channel-list', 'UPSCALER_VIDEO_CHANNEL_IDS');
        await resolveChannelNames([id]);
        applyNameLabel(card);
        showToast('Upscaler video channel saved!', 'success');
      });

      card.querySelector('.btn-del-ch').addEventListener('click', function() {
        card.remove();
        syncHiddenIds('upscaler-video-channel-list', 'UPSCALER_VIDEO_CHANNEL_IDS');
        showToast('Upscaler video channel removed', 'success');
      });

      return card;
    }

    async function loadUpscalerVideoChannels() {
      try {
        var config = await fetch('/api/config').then(function(r) { return r.json(); });
        var ids    = (config.UPSCALER_VIDEO_CHANNEL_IDS || '').split(',').map(function(s) { return s.trim(); }).filter(Boolean);
        var container = document.getElementById('upscaler-video-channel-list');
        container.innerHTML = '';
        ids.forEach(function(id) { container.appendChild(renderUpscalerVideoChannelCard(id)); });
        document.getElementById('UPSCALER_VIDEO_CHANNEL_IDS').value = ids.join(',');
      } catch(err) { showToast('Failed to load upscaler video channels: ' + err.message, 'error'); }
    }

    document.getElementById('btn-add-upscaler-video-channel').addEventListener('click', function() {
      document.getElementById('upscaler-video-channel-list').appendChild(renderUpscalerVideoChannelCard(''));
    });

    document.getElementById('btn-save-upscaler-video').addEventListener('click', async function() {
      syncHiddenIds('upscaler-video-channel-list', 'UPSCALER_VIDEO_CHANNEL_IDS');
      var keys = ['UPSCALER_VIDEO_CHANNEL_IDS', 'UPSCALE_VIDEO_MAX_DURATION_SEC', 'FFMPEG_PATH', 'FFPROBE_PATH'];
      var payload = {};
      keys.forEach(function(k) { var el = document.getElementById(k); if (el) payload[k] = el.value; });
      try {
        var res = await fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (!res.ok) throw new Error((await res.json()).error || 'Save failed');
        showToast('Upscaler Video saved!', 'success');
      } catch(err) { showToast('Error: ' + err.message, 'error'); }
    });

    // ── Compressor Channel Manager ─────────────────────────────────────────────
    function renderCompressorChannelCard(channelId) {
      channelId = channelId || '';
      var card = document.createElement('div');
      card.className = 'channel-card';
      card.style.borderColor = '#7c3aed';
      card.innerHTML =
        '<div class="channel-id-row">' +
          '<input type="text" placeholder="Channel ID" value="' + channelId + '" class="channel-id-input" />' +
          '<button class="btn btn-sm btn-danger btn-del-ch">&#x1F5D1;</button>' +
        '</div>' +
        '<div class="channel-name-label"></div>' +
        '<div class="card-actions">' +
          '<button class="btn btn-sm btn-save btn-save-ch" style="background:#7c3aed;">&#x1F4BE; Save</button>' +
        '</div>';

      if (channelId) {
        resolveChannelNames([channelId]).then(function() { applyNameLabel(card); });
      }

      card.querySelector('.btn-save-ch').addEventListener('click', async function() {
        var id = card.querySelector('.channel-id-input').value.trim();
        if (!id) { showToast('Channel ID is required', 'error'); return; }
        syncHiddenIds('compressor-channel-list', 'COMPRESSOR_CHANNEL_IDS');
        await resolveChannelNames([id]);
        applyNameLabel(card);
        showToast('Compressor channel saved!', 'success');
      });

      card.querySelector('.btn-del-ch').addEventListener('click', function() {
        card.remove();
        syncHiddenIds('compressor-channel-list', 'COMPRESSOR_CHANNEL_IDS');
        showToast('Compressor channel removed', 'success');
      });

      return card;
    }

    async function loadCompressorChannels() {
      try {
        var config = await fetch('/api/config').then(function(r) { return r.json(); });
        var ids    = (config.COMPRESSOR_CHANNEL_IDS || '').split(',').map(function(s) { return s.trim(); }).filter(Boolean);
        var container = document.getElementById('compressor-channel-list');
        container.innerHTML = '';
        ids.forEach(function(id) { container.appendChild(renderCompressorChannelCard(id)); });
        document.getElementById('COMPRESSOR_CHANNEL_IDS').value = ids.join(',');
      } catch(err) { showToast('Failed to load compressor channels: ' + err.message, 'error'); }
    }

    document.getElementById('btn-add-compressor-channel').addEventListener('click', function() {
      document.getElementById('compressor-channel-list').appendChild(renderCompressorChannelCard(''));
    });

    document.getElementById('btn-save-compressor').addEventListener('click', async function() {
      syncHiddenIds('compressor-channel-list', 'COMPRESSOR_CHANNEL_IDS');
      var keys = ['COMPRESSOR_CHANNEL_IDS', 'COMPRESS_IMAGE_QUALITY', 'COMPRESS_VIDEO_CRF', 'COMPRESS_VIDEO_PRESET'];
      var payload = {};
      keys.forEach(function(k) { var el = document.getElementById(k); if (el) payload[k] = el.value; });
      try {
        var res = await fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (!res.ok) throw new Error((await res.json()).error || 'Save failed');
        showToast('Compressor saved!', 'success');
      } catch(err) { showToast('Error: ' + err.message, 'error'); }
    });

    // ── Intelligence / Chat Storage ────────────────────────────────────────────
    var csState = { groups: [], channels: [], channelTree: [], selectedGroupKey: null };

    function fmtNum(n) { return new Intl.NumberFormat().format(n || 0); }

    function renderIntelligenceSummary(summary) {
      var el = document.getElementById('intelligence-summary');
      if (!el) return;
      var cards = [
        ['Messages', fmtNum(summary.totalMessages)],
        ['24h',      fmtNum(summary.messages24h)],
        ['Channels', fmtNum(summary.channelsIndexed)],
        ['Backfill', fmtNum(summary.backfill.savedMessages) + '/' + fmtNum(summary.backfill.scannedMessages)],
      ];
      el.innerHTML = cards.map(function(kv) {
        return '<div style="background:#16213e;border:1px solid #2d2d4e;border-radius:8px;padding:10px;">' +
               '<div style="font-size:.65rem;color:#7c7ca8;text-transform:uppercase;">' + kv[0] + '</div>' +
               '<div style="font-weight:800;color:#a78bfa;">' + kv[1] + '</div></div>';
      }).join('');
    }

    function renderIntelligenceGroups() {
      var el = document.getElementById('intelligence-groups');
      if (!el) return;
      el.innerHTML = csState.groups.map(function(g) {
        return '<div class="channel-card" style="padding:10px;margin-bottom:8px;border-color:' +
               (g.groupKey === csState.selectedGroupKey ? '#a78bfa' : '#2d2d4e') +
               ';cursor:pointer;" data-group-key="' + g.groupKey + '">' +
               '<div style="display:flex;justify-content:space-between;"><strong>' + g.displayName + '</strong>' +
               '<span style="color:#a78bfa;">' + (g.agentKey || '-') + '</span></div>' +
               '<div style="font-size:.72rem;color:#7c7ca8;">' + g.groupKey + ' - ' + (g.channelCount || 0) + ' channels</div>' +
               '<div style="font-size:.72rem;color:#b0b0c8;margin-top:3px;">' + (g.description || '') + '</div>' +
               '</div>';
      }).join('') || '<div style="color:#7c7ca8;font-size:.8rem;">Chua co group.</div>';

      el.querySelectorAll('[data-group-key]').forEach(function(node) {
        node.addEventListener('click', function() {
          var g = csState.groups.find(function(x) { return x.groupKey === node.dataset.groupKey; });
          if (!g) return;
          csState.selectedGroupKey = g.groupKey;
          document.getElementById('group-key').value   = g.groupKey;
          document.getElementById('group-name').value  = g.displayName;
          document.getElementById('group-agent').value = g.agentKey || 'pm';
          document.getElementById('group-desc').value  = g.description || '';
          renderIntelligenceGroups();
          renderIntelligenceChannels();
        });
      });
    }

    function renderIntelligenceChannels() {
      var el = document.getElementById('intelligence-channels');
      if (!el) return;
      var filterEl = document.getElementById('channel-filter');
      var q = filterEl ? filterEl.value.toLowerCase() : '';
      var selected = csState.selectedGroupKey;
      var tree = csState.channelTree || [];

      function channelMatches(ch, guild, cat) {
        if (!q) return true;
        return [ch.name, ch.channelId, guild.guildName, cat.categoryName]
          .filter(Boolean).join(' ').toLowerCase().indexOf(q) !== -1;
      }
      function isSelected(ch) {
        return !!selected && ch.groups.some(function(g) { return g.groupKey === selected; });
      }
      function selectedGroup() {
        return csState.groups.find(function(g) { return g.groupKey === selected; });
      }
      function groupPolicies() {
        var g = selectedGroup();
        return g && Array.isArray(g.policies) ? g.policies : [];
      }
      function hasPolicy(match) {
        return groupPolicies().some(match);
      }

      function buildPoliciesFromTree() {
        var policies = [];
        document.querySelectorAll('.tree-guild-cb:checked').forEach(function(cb) {
          policies.push({ scopeType: 'guild', guildId: cb.dataset.guildId });
        });
        document.querySelectorAll('.tree-category-cb:checked').forEach(function(cb) {
          var guildBox = cb.closest('.tree-guild')?.querySelector('.tree-guild-cb');
          if (guildBox && guildBox.checked) return;
          policies.push({
            scopeType: 'category',
            guildId: cb.dataset.guildId,
            parentId: cb.dataset.parentId || null,
            categoryName: cb.dataset.categoryName || null,
          });
        });
        document.querySelectorAll('.tree-channel-cb:checked').forEach(function(cb) {
          var categoryBox = cb.closest('.tree-category')?.querySelector('.tree-category-cb');
          var guildBox = cb.closest('.tree-guild')?.querySelector('.tree-guild-cb');
          if ((guildBox && guildBox.checked) || (categoryBox && categoryBox.checked)) return;
          policies.push({ scopeType: 'channel', channelId: cb.dataset.channelId });
        });
        return policies;
      }
      function countSelected(channels) {
        return channels.filter(isSelected).length;
      }
      function renderChannel(ch) {
        var checked = isSelected(ch) || hasPolicy(function(p) { return p.scopeType === 'channel' && p.channelId === ch.channelId; });
        var groupTags = ch.groups.map(function(g) {
          return '<span style="background:#312e81;color:#c4b5fd;border-radius:4px;padding:1px 4px;margin-right:3px;font-size:.65rem;">' + g.agentKey + ':' + g.groupKey + '</span>';
        }).join('');
        return '<label style="display:block;padding:5px 8px 5px 42px;border-top:1px solid rgba(45,45,78,.45);cursor:pointer;">' +
          '<input type="checkbox" class="grp-ch-cb tree-channel-cb" data-channel-id="' + ch.channelId + '" ' + (checked ? 'checked' : '') + ' ' + (selected ? '' : 'disabled') + ' /> ' +
          '<strong>#' + (ch.name || ch.channelId) + '</strong> ' +
          '<span style="color:#7c7ca8;font-size:.72rem;">' + ch.channelId + ' · ' + fmtNum(ch.messageCount) + ' msgs</span>' +
          '<div style="margin-left:22px;margin-top:2px;">' + groupTags + '</div>' +
        '</label>';
      }
      function renderCategory(cat, guild) {
        var channels = cat.channels.filter(function(ch) { return channelMatches(ch, guild, cat); });
        if (channels.length === 0) return '';
        var selectedCount = countSelected(channels);
        var checked = hasPolicy(function(p) { return p.scopeType === 'category' && p.guildId === guild.guildId && ((p.parentId && p.parentId === cat.parentId) || (!p.parentId && p.categoryName === cat.categoryName)); }) || (channels.length > 0 && selectedCount === channels.length);
        var partial = selectedCount > 0 && selectedCount < channels.length;
        return '<div class="tree-category" style="margin:6px 0 8px 16px;background:#111827;border:1px solid #2d2d4e;border-radius:8px;overflow:hidden;">' +
          '<label style="display:block;padding:8px;cursor:pointer;background:#16213e;">' +
          '<input type="checkbox" class="tree-category-cb" data-category-key="' + cat.categoryKey + '" data-guild-id="' + (guild.guildId || '') + '" data-parent-id="' + (cat.parentId || '') + '" data-category-name="' + cat.categoryName + '" ' + (checked ? 'checked' : '') + ' ' + (selected ? '' : 'disabled') + ' /> ' +
          '<strong>' + cat.categoryName + '</strong> <span style="color:#7c7ca8;font-size:.72rem;">' + selectedCount + '/' + channels.length + ' selected</span>' +
          '</label>' + channels.map(renderChannel).join('') + '</div>';
      }
      var html = tree.map(function(guild) {
        var categoryHtml = guild.categories.map(function(cat) { return renderCategory(cat, guild); }).filter(Boolean).join('');
        if (!categoryHtml) return '';
        var allChannels = [];
        guild.categories.forEach(function(cat) { cat.channels.forEach(function(ch) { if (channelMatches(ch, guild, cat)) allChannels.push(ch); }); });
        var selectedCount = countSelected(allChannels);
        var checked = hasPolicy(function(p) { return p.scopeType === 'guild' && p.guildId === guild.guildId; }) || (allChannels.length > 0 && selectedCount === allChannels.length);
        return '<div class="tree-guild" style="background:#16213e;border:1px solid #2d2d4e;border-radius:10px;margin-bottom:10px;padding:10px;">' +
          '<label style="display:block;cursor:pointer;">' +
          '<input type="checkbox" class="tree-guild-cb" data-guild-id="' + (guild.guildId || '') + '" ' + (checked ? 'checked' : '') + ' ' + (selected ? '' : 'disabled') + ' /> ' +
          '<strong style="color:#e5e7eb;">' + (guild.guildName || 'Unknown Server') + '</strong> ' +
          '<span style="color:#a78bfa;font-size:.75rem;">' + selectedCount + '/' + allChannels.length + ' channels</span>' +
          '</label>' + categoryHtml + '</div>';
      }).filter(Boolean).join('');
      el.innerHTML = html || '<div style="color:#7c7ca8;font-size:.8rem;">Khong co channel indexed.</div>';

      el.querySelectorAll('.tree-channel-cb').forEach(function(cb) { cb.addEventListener('change', saveGroupChannels); });
      el.querySelectorAll('.tree-category-cb').forEach(function(cb) {
        var box = cb;
        var wrapper = box.closest('.tree-category');
        var childCbs = wrapper ? Array.from(wrapper.querySelectorAll('.tree-channel-cb')) : [];
        var checkedChildren = childCbs.filter(function(x) { return x.checked; }).length;
        box.indeterminate = checkedChildren > 0 && checkedChildren < childCbs.length;
        box.addEventListener('change', function() {
          childCbs.forEach(function(x) { x.checked = box.checked; });
          saveGroupChannels();
        });
      });
      el.querySelectorAll('.tree-guild-cb').forEach(function(cb) {
        var box = cb;
        var wrapper = box.closest('.tree-guild');
        var childCbs = wrapper ? Array.from(wrapper.querySelectorAll('.tree-channel-cb')) : [];
        var checkedChildren = childCbs.filter(function(x) { return x.checked; }).length;
        box.indeterminate = checkedChildren > 0 && checkedChildren < childCbs.length;
        box.addEventListener('change', function() {
          childCbs.forEach(function(x) { x.checked = box.checked; });
          saveGroupChannels();
        });
      });
    }

    async function loadIntelligence() {
      try {
        var results = await Promise.all([
          fetch('/api/chat-storage/summary').then(function(r) { return r.json(); }),
          fetch('/api/chat-storage/groups').then(function(r) { return r.json(); }),
          fetch('/api/chat-storage/channels').then(function(r) { return r.json(); }),
          fetch('/api/chat-storage/channel-tree').then(function(r) { return r.json(); }),
        ]);
        csState.groups   = results[1];
        csState.channels = results[2];
        csState.channelTree = results[3];
        if (!csState.selectedGroupKey && results[1][0]) csState.selectedGroupKey = results[1][0].groupKey;
        renderIntelligenceSummary(results[0]);
        renderIntelligenceGroups();
        renderIntelligenceChannels();
        populateCuScopeSelectors();
        await loadCuMappings();
      } catch(err) { showToast('Intelligence UI error: ' + err.message, 'error'); }
    }

    async function saveGroupChannels() {
      var groupKey = csState.selectedGroupKey;
      if (!groupKey) return;
      var policies = buildPoliciesFromTree();
      var res = await fetch('/api/chat-storage/groups/' + groupKey + '/policies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ policies: policies }),
      });
      if (!res.ok) showToast('Failed to assign policies', 'error');
      await loadIntelligence();
    }

    var refreshIntelBtn = document.getElementById('btn-refresh-intelligence');
    if (refreshIntelBtn) refreshIntelBtn.addEventListener('click', loadIntelligence);

    var chFilterEl = document.getElementById('channel-filter');
    if (chFilterEl) chFilterEl.addEventListener('input', renderIntelligenceChannels);

    var saveGroupBtn = document.getElementById('btn-save-group');
    if (saveGroupBtn) saveGroupBtn.addEventListener('click', async function() {
      var payload = {
        groupKey:    document.getElementById('group-key').value.trim(),
        displayName: document.getElementById('group-name').value.trim(),
        agentKey:    document.getElementById('group-agent').value,
        description: document.getElementById('group-desc').value,
      };
      if (!payload.groupKey) { showToast('group_key required', 'error'); return; }
      var res = await fetch('/api/chat-storage/groups', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      if (!res.ok) { showToast('Save group failed', 'error'); return; }
      csState.selectedGroupKey = payload.groupKey;
      showToast('Group saved', 'success');
      await loadIntelligence();
    });

    var syncBtn = document.getElementById('btn-sync-agent-access');
    if (syncBtn) syncBtn.addEventListener('click', async function() {
      var res  = await fetch('/api/chat-storage/agent-access/sync', { method: 'POST' });
      var data = await res.json();
      if (!res.ok) { showToast('Sync failed', 'error'); return; }
      showToast('Synced ' + data.upserted + ' access rows', 'success');
    });

    // ── ClickUp Project Mapping ───────────────────────────────────────────────
    var cuState = { mappings: [] };

    function renderCuMappings() {
      var el = document.getElementById('cu-mappings-list');
      if (!el) return;
      if (!cuState.mappings.length) {
        el.innerHTML = '<div style="color:#7c7ca8;font-size:.8rem;">Chua co mapping nao.</div>';
        return;
      }
      var AGENT_COLOR = { pm: '#7c3aed', ceo: '#b45309', hr: '#065f46', finance: '#1e40af' };
      var SCOPE_LABEL = { guild: '🏛 Server', category: '📂 Category', channel: '#️⃣ Channel' };
      el.innerHTML = cuState.mappings.map(function(m) {
        var scopeInfo = m.scopeType === 'guild' ? (m.guildId || '-')
          : m.scopeType === 'category' ? ((m.categoryName || '') + (m.parentId ? ' (' + m.parentId + ')' : ''))
          : (m.channelId || '-');
        var color = AGENT_COLOR[m.agentKey] || '#374151';
        var opacity = m.isActive ? '1' : '0.5';
        return '<div style="background:#16213e;border:1px solid #2d2d4e;border-radius:8px;padding:10px;margin-bottom:6px;display:flex;justify-content:space-between;align-items:flex-start;opacity:' + opacity + ';">' +
          '<div>' +
            '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">' +
              '<span style="background:' + color + ';color:#fff;border-radius:4px;padding:1px 6px;font-size:.65rem;font-weight:700;">' + m.agentKey.toUpperCase() + '</span>' +
              '<span style="color:#a78bfa;font-size:.72rem;">' + (SCOPE_LABEL[m.scopeType] || m.scopeType) + '</span>' +
              '<span style="color:#7c7ca8;font-size:.72rem;">' + scopeInfo + '</span>' +
            '</div>' +
            '<div style="font-weight:700;color:#e0e0e0;">' + m.clickupProjectName + '</div>' +
            '<div style="font-size:.7rem;color:#7c7ca8;">ID: ' + m.clickupProjectId +
              (m.folderId ? ' · Folder: ' + m.folderId : '') +
              (m.listId   ? ' · List: '   + m.listId   : '') +
            '</div>' +
          '</div>' +
          '<div style="display:flex;flex-direction:column;gap:4px;">' +
            '<button data-cu-toggle="' + m.id + '" data-active="' + m.isActive + '" class="btn btn-sm" style="background:#374151;color:#e5e7eb;font-size:.65rem;">' + (m.isActive ? 'Disable' : 'Enable') + '</button>' +
            '<button data-cu-delete="' + m.id + '" class="btn btn-sm" style="background:#7f1d1d;color:#fca5a5;font-size:.65rem;">Delete</button>' +
          '</div>' +
        '</div>';
      }).join('');

      el.querySelectorAll('[data-cu-toggle]').forEach(function(btn) {
        btn.addEventListener('click', async function() {
          var id = parseInt(btn.dataset.cuToggle);
          var active = parseInt(btn.dataset.active || '1');
          await fetch('/api/chat-storage/clickup-mappings/' + id + '/toggle', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ isActive: active === 0 }),
          });
          await loadCuMappings();
        });
      });
      el.querySelectorAll('[data-cu-delete]').forEach(function(btn) {
        btn.addEventListener('click', async function() {
          if (!confirm('Delete this mapping?')) return;
          await fetch('/api/chat-storage/clickup-mappings/' + btn.dataset.cuDelete, { method: 'DELETE' });
          await loadCuMappings();
        });
      });
    }

    function populateCuScopeSelectors() {
      var tree = csState.channelTree || [];
      var guildEl = document.getElementById('cu-guild-id');
      var catEl   = document.getElementById('cu-category-key');
      var chEl    = document.getElementById('cu-channel-id');
      if (!guildEl || !catEl || !chEl) return;

      guildEl.innerHTML = '<option value="">-- Select Server --</option>' +
        tree.map(function(g) {
          return '<option value="' + (g.guildId || '') + '">' + (g.guildName || g.guildId) + '</option>';
        }).join('');

      function refreshCatCh() {
        var gid = guildEl.value;
        var guild = tree.find(function(g) { return g.guildId === gid; });
        var cats = guild ? guild.categories : [];
        catEl.innerHTML = '<option value="">-- Select Category --</option>' +
          cats.map(function(c) {
            return '<option value="' + c.categoryKey + '" data-parent-id="' + (c.parentId || '') + '" data-category-name="' + c.categoryName + '">' + c.categoryName + '</option>';
          }).join('');
        chEl.innerHTML = '<option value="">-- Select Channel --</option>';
        if (catEl.value) refreshCh();
      }

      function refreshCh() {
        var gid = guildEl.value;
        var catKey = catEl.value;
        var guild = tree.find(function(g) { return g.guildId === gid; });
        var cat = guild ? guild.categories.find(function(c) { return c.categoryKey === catKey; }) : null;
        var channels = cat ? cat.channels : [];
        chEl.innerHTML = '<option value="">-- Select Channel --</option>' +
          channels.map(function(ch) {
            return '<option value="' + ch.channelId + '">#' + (ch.name || ch.channelId) + '</option>';
          }).join('');
      }

      guildEl.addEventListener('change', refreshCatCh);
      catEl.addEventListener('change', refreshCh);
    }

    function updateCuScopeVisibility() {
      var scopeType = document.getElementById('cu-scope-type').value;
      var catEl  = document.getElementById('cu-category-key');
      var chEl   = document.getElementById('cu-channel-id');
      if (catEl)  catEl.style.display  = (scopeType === 'category' || scopeType === 'channel') ? '' : 'none';
      if (chEl)   chEl.style.display   = (scopeType === 'channel') ? '' : 'none';
    }

    async function loadCuMappings() {
      try {
        var r = await fetch('/api/chat-storage/clickup-mappings');
        cuState.mappings = await r.json();
        renderCuMappings();
      } catch(err) { showToast('ClickUp mappings load error: ' + err.message, 'error'); }
    }

    var cuScopeTypeEl = document.getElementById('cu-scope-type');
    if (cuScopeTypeEl) {
      cuScopeTypeEl.addEventListener('change', updateCuScopeVisibility);
      updateCuScopeVisibility();
    }

    var saveCuBtn = document.getElementById('btn-save-cu-mapping');
    if (saveCuBtn) saveCuBtn.addEventListener('click', async function() {
      var scopeType = document.getElementById('cu-scope-type').value;
      var guildId   = document.getElementById('cu-guild-id').value.trim() || null;
      var catOption = document.getElementById('cu-category-key').selectedOptions[0];
      var channelId = document.getElementById('cu-channel-id').value.trim() || null;
      var projectId = document.getElementById('cu-project-id').value.trim();
      var projectName = document.getElementById('cu-project-name').value.trim();
      var folderId  = document.getElementById('cu-folder-id').value.trim() || null;
      var listId    = document.getElementById('cu-list-id').value.trim() || null;
      var agentKey  = document.getElementById('cu-agent-key').value;

      if (!projectId || !projectName) { showToast('Project ID va Project Name bat buoc', 'error'); return; }
      if (scopeType === 'guild' && !guildId) { showToast('Chon Server', 'error'); return; }
      if (scopeType === 'category' && (!guildId || !catOption?.value)) { showToast('Chon Server va Category', 'error'); return; }
      if (scopeType === 'channel' && !channelId) { showToast('Chon Channel', 'error'); return; }

      var payload = {
        scopeType, guildId, agentKey,
        parentId: (scopeType === 'category' && catOption) ? (catOption.dataset.parentId || null) : null,
        categoryName: (scopeType === 'category' && catOption) ? (catOption.dataset.categoryName || null) : null,
        channelId: scopeType === 'channel' ? channelId : null,
        clickupProjectId: projectId, clickupProjectName: projectName, folderId, listId,
      };
      var res = await fetch('/api/chat-storage/clickup-mappings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      if (!res.ok) { showToast('Save mapping failed', 'error'); return; }
      showToast('Mapping saved', 'success');
      await loadCuMappings();
    });

    // ── Slack Chat Storage ─────────────────────────────────────────────────────
    var slackState = { summary: null, workspaces: [], channels: [], mappings: [] };

    function renderSlackSummary(summary) {
      var el = document.getElementById('slack-summary');
      if (!el) return;
      var cards = [
        ['Workspaces', fmtNum(summary.workspaces)],
        ['Channels',   fmtNum(summary.channels)],
        ['Messages',   fmtNum(summary.messages)],
        ['Mappings',   fmtNum(summary.mappings)],
      ];
      el.innerHTML = cards.map(function(kv) {
        return '<div style="background:#16213e;border:1px solid #2d2d4e;border-radius:8px;padding:10px;">' +
          '<div style="font-size:.65rem;color:#7c7ca8;text-transform:uppercase;">' + kv[0] + '</div>' +
          '<div style="font-weight:800;color:#a78bfa;">' + kv[1] + '</div></div>';
      }).join('');
    }

    function slackChannelLabel(ch) {
      return (ch.workspace_name || ch.workspace_id || 'Slack') + ' / #' + (ch.name || ch.id);
    }

    function populateSlackScopeSelect() {
      var scopeTypeEl = document.getElementById('slack-scope-type');
      var scopeEl = document.getElementById('slack-scope-id');
      if (!scopeTypeEl || !scopeEl) return;
      var scopeType = scopeTypeEl.value;
      if (scopeType === 'workspace') {
        scopeEl.innerHTML = '<option value="">-- Select Slack workspace --</option>' + slackState.workspaces.map(function(w) {
          return '<option value="' + w.id + '">' + (w.name || w.id) + ' (' + (w.channel_count || 0) + ' channels)</option>';
        }).join('');
      } else {
        scopeEl.innerHTML = '<option value="">-- Select Slack channel --</option>' + slackState.channels.map(function(ch) {
          return '<option value="' + ch.id + '">' + slackChannelLabel(ch) + '</option>';
        }).join('');
      }
    }

    function renderSlackChannels() {
      var el = document.getElementById('slack-channels');
      if (!el) return;
      var filterEl = document.getElementById('slack-channel-filter');
      var q = filterEl ? filterEl.value.toLowerCase() : '';
      var rows = slackState.channels.filter(function(ch) {
        return !q || [ch.name, ch.id, ch.workspace_name, ch.mapping_project_name, ch.mapping_agent_key].filter(Boolean).join(' ').toLowerCase().indexOf(q) !== -1;
      });
      el.innerHTML = rows.map(function(ch) {
        var badge = ch.mapping_project_name ? '<span style="background:#312e81;color:#c4b5fd;border-radius:4px;padding:1px 5px;font-size:.65rem;">' + ch.mapping_agent_key + ': ' + ch.mapping_project_name + '</span>' : '';
        var flags = [ch.is_private ? 'private' : 'public', ch.is_im ? 'dm' : '', ch.is_mpim ? 'mpim' : ''].filter(Boolean).join(' · ');
        return '<div class="channel-card" style="padding:9px;margin-bottom:7px;cursor:pointer;" data-slack-channel-id="' + ch.id + '">' +
          '<div style="display:flex;justify-content:space-between;gap:8px;"><strong>#' + (ch.name || ch.id) + '</strong>' + badge + '</div>' +
          '<div style="font-size:.72rem;color:#7c7ca8;">' + (ch.workspace_name || ch.workspace_id) + ' · ' + ch.id + ' · ' + fmtNum(ch.message_count) + ' msgs · ' + flags + '</div>' +
        '</div>';
      }).join('') || '<div style="color:#7c7ca8;font-size:.8rem;">Chua co Slack channel. Chay npm run backfill:slack trong tdgames-slack truoc.</div>';
      el.querySelectorAll('[data-slack-channel-id]').forEach(function(node) {
        node.addEventListener('click', function() {
          document.getElementById('slack-scope-type').value = 'channel';
          populateSlackScopeSelect();
          document.getElementById('slack-scope-id').value = node.dataset.slackChannelId;
        });
      });
    }

    function renderSlackMappings() {
      var el = document.getElementById('slack-mappings-list');
      if (!el) return;
      el.innerHTML = slackState.mappings.map(function(m) {
        return '<div style="background:#16213e;border:1px solid #2d2d4e;border-radius:8px;padding:10px;margin-bottom:6px;display:flex;justify-content:space-between;gap:8px;opacity:' + (m.is_active ? '1' : '.5') + ';">' +
          '<div><div><span style="background:#7c3aed;color:#fff;border-radius:4px;padding:1px 6px;font-size:.65rem;font-weight:700;">' + m.agent_key + '</span> ' +
          '<span style="color:#a78bfa;font-size:.72rem;">' + m.scope_type + '</span> <span style="color:#7c7ca8;font-size:.72rem;">' + m.scope_id + '</span></div>' +
          '<div style="font-weight:700;color:#e0e0e0;margin-top:4px;">' + m.clickup_project_name + '</div>' +
          '<div style="font-size:.7rem;color:#7c7ca8;">ID: ' + m.clickup_project_id + (m.clickup_folder_id ? ' · Folder: ' + m.clickup_folder_id : '') + (m.clickup_list_id ? ' · List: ' + m.clickup_list_id : '') + '</div></div>' +
          '<button data-slack-delete="' + m.id + '" class="btn btn-sm" style="background:#7f1d1d;color:#fca5a5;font-size:.65rem;align-self:flex-start;">Delete</button>' +
        '</div>';
      }).join('') || '<div style="color:#7c7ca8;font-size:.8rem;">Chua co Slack mapping nao.</div>';
      el.querySelectorAll('[data-slack-delete]').forEach(function(btn) {
        btn.addEventListener('click', async function() {
          if (!confirm('Delete this Slack mapping?')) return;
          await fetch('/api/slack/mappings/' + btn.dataset.slackDelete, { method: 'DELETE' });
          await loadSlack();
        });
      });
    }

    async function loadSlack() {
      try {
        var results = await Promise.all([
          fetch('/api/slack/summary').then(function(r) { return r.json(); }),
          fetch('/api/slack/workspaces').then(function(r) { return r.json(); }),
          fetch('/api/slack/channels').then(function(r) { return r.json(); }),
          fetch('/api/slack/mappings').then(function(r) { return r.json(); }),
        ]);
        slackState.summary = results[0];
        slackState.workspaces = results[1];
        slackState.channels = results[2];
        slackState.mappings = results[3];
        renderSlackSummary(results[0]);
        populateSlackScopeSelect();
        renderSlackChannels();
        renderSlackMappings();
      } catch(err) { showToast('Slack UI error: ' + err.message, 'error'); }
    }

    var refreshSlackBtn = document.getElementById('btn-refresh-slack');
    if (refreshSlackBtn) refreshSlackBtn.addEventListener('click', loadSlack);
    var slackFilterEl = document.getElementById('slack-channel-filter');
    if (slackFilterEl) slackFilterEl.addEventListener('input', renderSlackChannels);
    var slackScopeTypeEl = document.getElementById('slack-scope-type');
    if (slackScopeTypeEl) slackScopeTypeEl.addEventListener('change', populateSlackScopeSelect);
    var saveSlackBtn = document.getElementById('btn-save-slack-mapping');
    if (saveSlackBtn) saveSlackBtn.addEventListener('click', async function() {
      var payload = {
        scope_type: document.getElementById('slack-scope-type').value,
        scope_id: document.getElementById('slack-scope-id').value.trim(),
        agent_key: document.getElementById('slack-agent-key').value,
        clickup_project_id: document.getElementById('slack-project-id').value.trim(),
        clickup_project_name: document.getElementById('slack-project-name').value.trim(),
        clickup_folder_id: document.getElementById('slack-folder-id').value.trim() || null,
        clickup_list_id: document.getElementById('slack-list-id').value.trim() || null,
      };
      if (!payload.scope_id || !payload.clickup_project_id || !payload.clickup_project_name) { showToast('Slack scope + ClickUp ID/name bat buoc', 'error'); return; }
      var res = await fetch('/api/slack/mappings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!res.ok) { var err = await res.json().catch(function(){ return {}; }); showToast(err.error || 'Save Slack mapping failed', 'error'); return; }
      showToast('Slack mapping saved', 'success');
      await loadSlack();
    });

    // ── CLIProxy Test ──────────────────────────────────────────────────────────
    var testCliproxyBtn = document.getElementById('btn-test-cliproxy');
    if (testCliproxyBtn) testCliproxyBtn.addEventListener('click', async function() {
      var btn    = document.getElementById('btn-test-cliproxy');
      var urlEl  = document.getElementById('CLIPROXY_API_URL');
      var keyEl  = document.getElementById('CLIPROXY_API_KEY');
      var url    = urlEl ? urlEl.value.trim() : '';
      var apiKey = keyEl ? keyEl.value.trim() : '';
      if (!url) { showToast('Nhap URL truoc', 'error'); return; }
      btn.textContent = '...';
      btn.className   = 'btn-test';
      try {
        var res  = await fetch('/api/test/cliproxy', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: url, apiKey: apiKey }),
        });
        var data = await res.json();
        if (data.ok) {
          btn.textContent = 'OK ' + data.latencyMs + 'ms';
          btn.className   = 'btn-test ok';
        } else {
          btn.textContent = 'Fail';
          btn.className   = 'btn-test fail';
          showToast('CLIProxy: ' + data.error, 'error');
        }
      } catch(err) {
        btn.textContent = 'Fail';
        btn.className   = 'btn-test fail';
        showToast('Test failed: ' + err.message, 'error');
      }
      setTimeout(function() { btn.textContent = 'Test'; btn.className = 'btn-test'; }, 4000);
    });

    // Error channel name
    var errChEl = document.getElementById('ERROR_CHANNEL_ID');
    if (errChEl) errChEl.addEventListener('blur', async function() {
      var id = errChEl.value.trim();
      var el = document.getElementById('error-channel-name');
      if (!id) { if (el) el.textContent = ''; return; }
      await resolveChannelNames([id]);
      var name = channelNameCache[id];
      if (el) {
        el.textContent = name ? '#' + name : '(bot cannot access this channel)';
        el.style.color = name ? '#a78bfa' : '#f87171';
      }
    });

    // ── Settings Save ──────────────────────────────────────────────────────────
    var saveSettingsBtn = document.getElementById('btn-save-settings');
    if (saveSettingsBtn) saveSettingsBtn.addEventListener('click', async function() {
      var keys = [
        'DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'ERROR_CHANNEL_ID',
        'CLIPROXY_API_URL', 'CLIPROXY_API_KEY',
        'OPENAI_API_KEY',
        'SESSION_HISTORY_LIMIT', 'SESSION_EXPIRE_MINUTES',
        'CHANNEL_QUEUE_MAX_PENDING',
      ];
      var payload = {};
      keys.forEach(function(k) { var el = document.getElementById(k); if (el) payload[k] = el.value; });
      try {
        var res = await fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (!res.ok) throw new Error((await res.json()).error || 'Save failed');
        showToast('Settings saved!', 'success');
      } catch(err) { showToast('Error: ' + err.message, 'error'); }
    });

    // ── Log Viewer ─────────────────────────────────────────────────────────────
    async function loadLogs() {
      var fileEl = document.getElementById('log-file-sel');
      var file   = fileEl ? fileEl.value : 'bot';
      var pre    = document.getElementById('log-content');
      if (!pre) return;
      try {
        var res = await fetch('/api/logs?file=' + file + '&lines=100');
        if (!res.ok) { pre.textContent = 'Khong the tai log.'; return; }
        var data = await res.json();
        pre.textContent = data.content || '(trong)';
        pre.scrollTop   = pre.scrollHeight;
      } catch(err) {
        pre.textContent = 'Loi: ' + err.message;
      }
    }
    var refreshLogsBtn = document.getElementById('btn-refresh-logs');
    if (refreshLogsBtn) refreshLogsBtn.addEventListener('click', loadLogs);
    var logFileSelEl = document.getElementById('log-file-sel');
    if (logFileSelEl) logFileSelEl.addEventListener('change', loadLogs);

    // ── loadConfig — pre-fill all tabs ─────────────────────────────────────────
    var ALL_KEYS = [
      'DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'ERROR_CHANNEL_ID',
      'IMAGE_CHANNEL_IDS', 'IMAGE_MODEL', 'IMAGE_SIZE', 'IMAGE_FALLBACK_MODEL', 'OPENAI_API_KEY',
      'CHAT_CHANNEL_IDS', 'CHAT_MODEL', 'CHAT_FALLBACK_MODEL',
      'UPSCALE_CHANNEL_IDS', 'UPSCAYL_BIN_PATH', 'UPSCAYL_MODELS_PATH', 'UPSCALE_SCALE', 'UPSCALE_MODEL',
      'UPSCALER_VIDEO_CHANNEL_IDS', 'UPSCALE_VIDEO_MAX_DURATION_SEC', 'FFMPEG_PATH', 'FFPROBE_PATH',
      'COMPRESSOR_CHANNEL_IDS', 'COMPRESS_IMAGE_QUALITY', 'COMPRESS_VIDEO_CRF', 'COMPRESS_VIDEO_PRESET',
      'CLIPROXY_API_URL', 'CLIPROXY_API_KEY',
      'SESSION_HISTORY_LIMIT', 'SESSION_EXPIRE_MINUTES',
      'CHANNEL_QUEUE_MAX_PENDING',
    ];

    async function loadConfig() {
      try {
        var res  = await fetch('/api/config');
        var data = await res.json();
        ALL_KEYS.forEach(function(key) {
          var el = document.getElementById(key);
          if (el && data[key] !== undefined) el.value = data[key];
        });
      } catch(err) {
        showToast('Failed to load config: ' + err.message, 'error');
      }
    }

    // ── Init ───────────────────────────────────────────────────────────────────
    (async function() {
      await loadConfig();
      await loadImageChannels();
      await loadTextChannels();
      await loadUpscalerChannels();
      await loadUpscalerVideoChannels();
      await loadCompressorChannels();
      loadLogs();
      loadIntelligence();
      loadSlack();
    })();
  </script>
  `;
}

function renderHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>TDGames Discord Bot &#x2014; Config</title>
  <style>${renderCss()}</style>
</head>
<body>
  <div class="container">
    <div class="header">&#x1F3AE; TDGames Discord Bot &#x2014; Config</div>
    ${renderTabNav()}
    ${renderOverviewTab()}
    ${renderImageGenTab()}
    ${renderTextChatTab()}
    ${renderUpscalerTab()}
    ${renderCompressorTab()}
    ${renderIntelligenceTab()}
    ${renderSlackTab()}
    ${renderSettingsTab()}
    ${renderLogsTab()}
  </div>
  <div id="toast"></div>
  ${renderClientJS()}
</body>
</html>`;
}

// ── Express App ──────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

// GET / — Serve HTML
app.get('/', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(renderHtml());
});

// GET /api/config — Read .env
app.get('/api/config', (_req: Request, res: Response) => {
  try {
    res.json(readEnv());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// POST /api/config — Write .env
app.post('/api/config', (req: Request, res: Response) => {
  try {
    const data = req.body as EnvMap;
    writeEnv(data);
    res.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// POST /api/restart — kill/respawn bot (no save — save rieng o tung tab)
app.post('/api/restart', (_req: Request, res: Response) => {
  try {
    restartBot();
    res.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// GET /api/channel-prompts
app.get('/api/channel-prompts', (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare(
      'SELECT channel_id, system_prompt FROM channel_prompts ORDER BY channel_id'
    ).all() as Array<{ channel_id: string; system_prompt: string }>;
    db.close();
    res.json(rows.map(r => ({ channelId: r.channel_id, systemPrompt: r.system_prompt })));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// POST /api/channel-prompts
app.post('/api/channel-prompts', (req: Request, res: Response) => {
  try {
    const { channelId, systemPrompt } = req.body as { channelId: string; systemPrompt: string };
    if (!channelId?.trim()) return void res.status(400).json({ error: 'channelId required' });
    const db = getDb();
    db.prepare(`INSERT INTO channel_prompts (channel_id, system_prompt, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(channel_id) DO UPDATE SET
        system_prompt = excluded.system_prompt,
        updated_at = excluded.updated_at`
    ).run(channelId.trim(), systemPrompt ?? '', Date.now());
    db.close();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// DELETE /api/channel-prompts/:id
app.delete('/api/channel-prompts/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    db.prepare('DELETE FROM channel_prompts WHERE channel_id = ?').run(req.params['id']);
    db.close();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── Chat Storage Admin API ──────────────────────────────────────────────────

app.get('/api/chat-storage/summary', (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const data = new ChatStorageAdminStore(db).getSummary();
    db.close();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/chat-storage/channels', (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const data = new ChatStorageAdminStore(db).listChannels();
    db.close();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/chat-storage/channel-tree', (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const data = new ChatStorageAdminStore(db).getChannelTree();
    db.close();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/chat-storage/groups', (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const data = new ChatStorageAdminStore(db).listGroups();
    db.close();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/chat-storage/groups', (req: Request, res: Response) => {
  try {
    const db = getDb();
    new ChatStorageAdminStore(db).upsertGroup(req.body);
    db.close();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.delete('/api/chat-storage/groups/:groupKey', (req: Request, res: Response) => {
  try {
    const db = getDb();
    new ChatStorageAdminStore(db).deleteGroup(req.params['groupKey']);
    db.close();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/chat-storage/groups/:groupKey/channels', (req: Request, res: Response) => {
  try {
    const channelIds = Array.isArray(req.body?.channelIds) ? req.body.channelIds : [];
    const db = getDb();
    new ChatStorageAdminStore(db).setGroupChannels(req.params['groupKey'], channelIds);
    db.close();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/chat-storage/groups/:groupKey/policies', (req: Request, res: Response) => {
  try {
    const policies = Array.isArray(req.body?.policies) ? req.body.policies : [];
    const db = getDb();
    new ChatStorageAdminStore(db).setGroupAssignmentPolicies(req.params['groupKey'], policies);
    db.close();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/chat-storage/agent-access/sync', (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const result = new ChatStorageAdminStore(db).syncAgentAccessFromGroups();
    db.close();
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── ClickUp Mapping API ───────────────────────────────────────────────────────

app.get('/api/chat-storage/clickup-mappings', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const agentKey = typeof req.query['agentKey'] === 'string' ? req.query['agentKey'] : undefined;
    const data = new ChatStorageAdminStore(db).listClickUpMappings(agentKey);
    db.close();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/chat-storage/clickup-mappings', (req: Request, res: Response) => {
  try {
    const input = req.body as ClickUpMappingInput;
    if (!input.clickupProjectId?.trim() || !input.clickupProjectName?.trim()) {
      return void res.status(400).json({ error: 'clickupProjectId and clickupProjectName required' });
    }
    if (!['guild', 'category', 'channel'].includes(input.scopeType)) {
      return void res.status(400).json({ error: 'scopeType must be guild/category/channel' });
    }
    const db = getDb();
    const id = new ChatStorageAdminStore(db).upsertClickUpMapping(input);
    db.close();
    res.json({ ok: true, id });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.delete('/api/chat-storage/clickup-mappings/:id', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params['id'], 10);
    if (isNaN(id)) return void res.status(400).json({ error: 'invalid id' });
    const db = getDb();
    new ChatStorageAdminStore(db).deleteClickUpMapping(id);
    db.close();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.patch('/api/chat-storage/clickup-mappings/:id/toggle', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params['id'], 10);
    if (isNaN(id)) return void res.status(400).json({ error: 'invalid id' });
    const isActive = Boolean(req.body?.isActive);
    const db = getDb();
    new ChatStorageAdminStore(db).toggleClickUpMapping(id, isActive);
    db.close();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── Slack Unified UI API ─────────────────────────────────────────────────────

app.get('/api/slack/summary', (_req: Request, res: Response) => {
  try {
    res.json(getSlackSummary());
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/slack/workspaces', (_req: Request, res: Response) => {
  try {
    res.json(listSlackWorkspaces());
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/slack/channels', (req: Request, res: Response) => {
  try {
    const workspaceId = typeof req.query['workspace_id'] === 'string' ? req.query['workspace_id'] : undefined;
    res.json(listSlackChannels(workspaceId));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/slack/mappings', (req: Request, res: Response) => {
  try {
    const activeOnly = 'active' in (req.query as Record<string, string>);
    res.json(listSlackMappings(activeOnly));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/slack/mappings', (req: Request, res: Response) => {
  try {
    const mapping = upsertSlackMapping(req.body as Record<string, unknown>);
    res.status(201).json(mapping);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.delete('/api/slack/mappings/:id', (req: Request, res: Response) => {
  const id = parseInt(req.params['id'], 10);
  if (isNaN(id)) return void res.status(400).json({ error: 'invalid id' });
  const db = getSlackDb();
  if (!db) return void res.status(404).json({ error: `Slack DB not found: ${slackDbPath}` });
  try {
    db.prepare('DELETE FROM clickup_project_mappings WHERE id = ?').run(id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  } finally {
    db.close();
  }
});

// GET /api/bot-status — check if bot process is running
app.get('/api/bot-status', (_req: Request, res: Response) => {
  try {
    if (!fs.existsSync(pidPath)) return void res.json({ status: 'offline' });
    const pid = parseInt(fs.readFileSync(pidPath, 'utf-8').trim(), 10);
    if (isNaN(pid)) return void res.json({ status: 'offline' });
    try {
      process.kill(pid, 0); // signal 0 = existence check only
      res.json({ status: 'online', pid });
    } catch {
      res.json({ status: 'offline' });
    }
  } catch (err) {
    res.json({ status: 'offline' });
  }
});

// GET /api/discord/channel-names?ids=id1,id2,...
app.get('/api/discord/channel-names', async (req: Request, res: Response) => {
  try {
    const env = readEnv();
    const token = env['DISCORD_TOKEN'];
    if (!token) return void res.json({});

    const raw = String(req.query['ids'] ?? '');
    const ids = raw.split(',').map((s) => s.trim()).filter(Boolean);
    if (ids.length === 0) return void res.json({});

    const result: Record<string, string> = {};
    await Promise.all(
      ids.map(async (id) => {
        try {
          const r = await fetch(`https://discord.com/api/v10/channels/${id}`, {
            headers: { Authorization: `Bot ${token}` },
          });
          if (r.ok) {
            const data = await r.json() as { name?: string };
            result[id] = data.name ?? id;
          }
        } catch {
          // ignore
        }
      })
    );
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/stats — image generation counts from bot.db
app.get('/api/stats', (_req: Request, res: Response) => {
  try {
    const db = new Database(dbPath, { readonly: true });
    const tableExists = db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='image_stats'"
    ).get();
    if (!tableExists) {
      db.close();
      const empty = { generates: 0, edits: 0, image_openai: 0, text_cliproxy: 0, text_openai: 0 };
      return void res.json({ today: empty, week: empty });
    }
    const todayDate = new Date().toLocaleDateString('sv');
    const weekAgo   = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toLocaleDateString('sv');
    type StatRow = { generates: number; edits: number; image_openai: number; text_cliproxy: number; text_openai: number };
    const todayRow = db.prepare(
      'SELECT generates, edits, image_openai, text_cliproxy, text_openai FROM image_stats WHERE date = ?'
    ).get(todayDate) as StatRow | undefined;
    const today = todayRow ?? { generates: 0, edits: 0, image_openai: 0, text_cliproxy: 0, text_openai: 0 };
    const week = db.prepare(`
      SELECT COALESCE(SUM(generates),0)    AS generates,
             COALESCE(SUM(edits),0)         AS edits,
             COALESCE(SUM(image_openai),0)  AS image_openai,
             COALESCE(SUM(text_cliproxy),0) AS text_cliproxy,
             COALESCE(SUM(text_openai),0)   AS text_openai
      FROM image_stats WHERE date >= ?
    `).get(weekAgo) as StatRow;
    db.close();
    res.json({ today, week });
  } catch {
    const empty = { generates: 0, edits: 0, image_openai: 0, text_cliproxy: 0, text_openai: 0 };
    res.json({ today: empty, week: empty });
  }
});

// GET /api/logs?file=bot&lines=100 — tail log files
app.get('/api/logs', (req: Request, res: Response) => {
  const fileKey = String(req.query['file'] ?? 'bot');
  const lines   = Math.min(200, Math.max(1, parseInt(String(req.query['lines'] ?? '100'), 10)));
  const fileMap: Record<string, string> = {
    'bot':              'bot.log',
    'bot-error':        'bot.error.log',
    'config-ui':        'config-ui.log',
    'config-ui-error':  'config-ui.error.log',
    'discord-backfill': 'discord-backfill.log',
  };
  const filename = fileMap[fileKey];
  if (!filename) return void res.status(400).json({ error: 'invalid file' });
  const logPath = path.join(projectRoot, 'logs', filename);
  if (!fs.existsSync(logPath)) return void res.json({ content: '' });
  const content  = fs.readFileSync(logPath, 'utf-8');
  const allLines = content.split('\n');
  res.json({ content: allLines.slice(-lines).join('\n') });
});

// POST /api/test/cliproxy — ping CLIProxy, return ok + latency
app.post('/api/test/cliproxy', async (req: Request, res: Response) => {
  const { url, apiKey } = req.body as { url?: string; apiKey?: string };
  if (!url?.trim()) return void res.status(400).json({ ok: false, error: 'URL required' });
  const start = Date.now();
  try {
    const r = await fetch(`${url.trim()}/v1/models`, {
      headers: { Authorization: `Bearer ${apiKey ?? ''}` },
      signal: AbortSignal.timeout(5000),
    });
    const latencyMs = Date.now() - start;
    if (r.ok || r.status === 401 || r.status === 404) {
      res.json({ ok: true, latencyMs, httpStatus: r.status });
    } else {
      res.json({ ok: false, error: `HTTP ${r.status}`, latencyMs });
    }
  } catch (err) {
    res.json({ ok: false, error: err instanceof Error ? err.message : String(err), latencyMs: Date.now() - start });
  }
});

// ── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Config UI running at http://0.0.0.0:${PORT}`);
});
