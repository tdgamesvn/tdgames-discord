import express, { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import Database from 'better-sqlite3';

// ── Paths ────────────────────────────────────────────────────────────────────

const projectRoot = path.resolve(__dirname, '../../');
const envPath = path.join(projectRoot, '.env');
const envExamplePath = path.join(projectRoot, '.env.example');
const pidPath = path.join(projectRoot, 'data', 'bot.pid');
const dbPath = path.join(projectRoot, 'data', 'bot.db');

function getDb(): Database.Database {
  const db = new Database(dbPath);
  // Ensure table exists (idempotent)
  db.exec(`CREATE TABLE IF NOT EXISTS channel_prompts (
    channel_id    TEXT PRIMARY KEY,
    system_prompt TEXT NOT NULL DEFAULT '',
    updated_at    INTEGER NOT NULL
  )`);
  return db;
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

// ── HTML Page ────────────────────────────────────────────────────────────────

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>TDGames Discord Bot — Config</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #1a1a2e;
      color: #e0e0e0;
      min-height: 100vh;
      display: flex;
      justify-content: center;
      align-items: flex-start;
      padding: 32px 16px 80px;
    }

    .container {
      width: 100%;
      max-width: 640px;
    }

    .header {
      font-size: 1.4rem;
      font-weight: 700;
      color: #a78bfa;
      margin-bottom: 28px;
      padding-bottom: 12px;
      border-bottom: 1px solid #2d2d4e;
    }

    .section {
      margin-bottom: 28px;
    }

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

    .field {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 12px;
    }

    .field label {
      width: 160px;
      min-width: 160px;
      font-size: 0.875rem;
      color: #b0b0c8;
    }

    .field-input-wrap {
      flex: 1;
      position: relative;
      display: flex;
      align-items: center;
    }

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

    .field-input-wrap input:focus {
      border-color: #a78bfa;
    }

    .field-input-wrap input[type="password"],
    .field-input-wrap input.has-toggle {
      padding-right: 36px;
    }

    .field-hint {
      padding-left: 172px; /* align with inputs */
      margin-top: -6px;
      margin-bottom: 10px;
      font-size: 0.72rem;
      color: #7c7ca8;
      line-height: 1.4;
    }

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

    .tooltip-icon {
      color: #7c7ca8;
      cursor: help;
      font-size: 0.875rem;
      position: relative;
    }

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

    .divider {
      border: none;
      border-top: 1px solid #2d2d4e;
      margin: 28px 0;
    }

    .actions {
      display: flex;
      gap: 12px;
    }

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

    .btn-save {
      background: #4f46e5;
      color: #fff;
    }

    .btn-restart {
      background: #059669;
      color: #fff;
    }

    .btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none !important; }

    /* ── Bot status indicator ───────────────────── */
    #bot-status {
      display: flex;
      align-items: center;
      gap: 7px;
      margin-right: auto;
    }
    #status-label {
      font-size: 0.8rem;
      color: #b0b0c8;
    }
    .status-dot {
      width: 9px;
      height: 9px;
      border-radius: 50%;
      background: #6b7280;
      flex-shrink: 0;
      transition: background 0.3s;
    }
    .status-dot.online      { background: #10b981; box-shadow: 0 0 6px #10b981; }
    .status-dot.offline     { background: #6b7280; }
    .status-dot.restarting  { background: #f59e0b; animation: blink 0.8s ease-in-out infinite; }
    @keyframes blink {
      0%, 100% { opacity: 1; }
      50%       { opacity: 0.3; }
    }

    /* Toast */
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

    #toast.show {
      opacity: 1;
      transform: translateY(0);
    }

    #toast.success { background: #059669; }
    #toast.error   { background: #dc2626; }

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
    .channel-card .card-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      margin-top: 10px;
    }
    .btn-danger { background: #dc2626; color: #fff; }
    .btn-sm { padding: 5px 12px; font-size: 0.8rem; }

    /* ── Channel name resolution ────────────────────── */
    .channel-name-tags {
      padding-left: 172px; /* align with inputs (160px label + 12px gap) */
      margin-top: -4px;
      margin-bottom: 12px;
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      min-height: 20px;
    }
    .channel-name-tag {
      font-size: 0.72rem;
      color: #a78bfa;
      background: #16213e;
      border: 1px solid #2d2d4e;
      border-radius: 12px;
      padding: 2px 9px;
    }
    .channel-name-hint {
      padding-left: 172px;
      margin-top: -4px;
      margin-bottom: 12px;
      font-size: 0.75rem;
      color: #a78bfa;
      min-height: 18px;
    }
    .channel-name-label {
      font-size: 0.72rem;
      color: #a78bfa;
      margin-top: 4px;
      min-height: 16px;
    }

    /* ── Select (dark theme) ────────────────────── */
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

    /* ── Test button ────────────────────────────── */
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
    .btn-test.ok    { background: #064e3b; color: #6ee7b7; }
    .btn-test.fail  { background: #7f1d1d; color: #fca5a5; }

    /* ── Log viewer ─────────────────────────────── */
    #log-content {
      background: #0d1117;
      border: 1px solid #2d2d4e;
      border-radius: 6px;
      padding: 12px;
      font-family: 'SF Mono', 'Fira Code', monospace;
      font-size: 0.72rem;
      line-height: 1.5;
      color: #8b8bae;
      max-height: 320px;
      overflow-y: auto;
      white-space: pre-wrap;
      word-break: break-all;
      margin-top: 10px;
    }
    #log-content:empty::before { content: '(trống)'; color: #4a4a6a; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">🎮 TDGames Discord Bot — Config</div>

    <!-- STATS BAR -->
    <div style="display:flex; margin-bottom:24px; background:#16213e; border:1px solid #2d2d4e; border-radius:8px; overflow:hidden;">
      <div style="flex:1; padding:12px 16px; border-right:1px solid #2d2d4e;">
        <div style="font-size:0.68rem; color:#7c7ca8; text-transform:uppercase; letter-spacing:0.1em; margin-bottom:4px;">Hôm nay</div>
        <div id="stats-today" style="font-size:1rem; font-weight:700; color:#a78bfa;">—</div>
      </div>
      <div style="flex:1; padding:12px 16px;">
        <div style="font-size:0.68rem; color:#7c7ca8; text-transform:uppercase; letter-spacing:0.1em; margin-bottom:4px;">7 ngày qua</div>
        <div id="stats-week" style="font-size:1rem; font-weight:700; color:#a78bfa;">—</div>
      </div>
    </div>

    <form id="config-form">

      <!-- DISCORD -->
      <div class="section">
        <div class="section-title">Discord</div>

        <div class="field">
          <label for="DISCORD_TOKEN">Bot Token</label>
          <div class="field-input-wrap">
            <input type="password" id="DISCORD_TOKEN" name="DISCORD_TOKEN" class="has-toggle" autocomplete="off" />
            <button type="button" class="toggle-btn" data-target="DISCORD_TOKEN" title="Toggle visibility">👁</button>
          </div>
        </div>

        <div class="field">
          <label for="DISCORD_CLIENT_ID">Client ID</label>
          <div class="field-input-wrap">
            <input type="text" id="DISCORD_CLIENT_ID" name="DISCORD_CLIENT_ID" autocomplete="off" />
          </div>
        </div>

        <!-- Hidden — managed by channel cards below; included in form Save -->
        <input type="hidden" id="ALLOWED_CHANNEL_IDS" name="ALLOWED_CHANNEL_IDS" />

        <div class="field" style="align-items: flex-start; margin-top: 4px;">
          <label style="padding-top: 8px; font-size:0.875rem; color:#b0b0c8; min-width:160px;">Channels</label>
          <div style="flex:1;">
            <div id="unified-channel-list"></div>
            <button type="button" id="btn-add-channel" style="
              margin-top:8px; background:#4f46e5; color:#fff; border:none;
              border-radius:5px; padding:5px 14px; font-size:0.8rem;
              cursor:pointer; font-weight:600;">+ Add Channel</button>
          </div>
        </div>

        <div class="field" style="margin-top:16px;">
          <label for="ERROR_CHANNEL_ID">Error Channel</label>
          <div class="field-input-wrap">
            <input type="text" id="ERROR_CHANNEL_ID" name="ERROR_CHANNEL_ID" placeholder="(optional) channel ID for error alerts" autocomplete="off" />
          </div>
          <span class="tooltip-icon" data-tip="Bot sẽ gửi thông báo lỗi vào channel này. Để trống nếu không dùng.">ℹ️</span>
        </div>
        <div class="channel-name-hint" id="error-channel-name"></div>
      </div>

      <!-- CLIPROXY -->
      <div class="section">
        <div class="section-title">CLIProxy API</div>

        <div class="field">
          <label for="CLIPROXY_API_URL">API URL</label>
          <div class="field-input-wrap">
            <input type="text" id="CLIPROXY_API_URL" name="CLIPROXY_API_URL" placeholder="http://localhost:8317" autocomplete="off" />
          </div>
          <button type="button" class="btn-test" id="btn-test-cliproxy">Test</button>
        </div>

        <div class="field">
          <label for="CLIPROXY_API_KEY">API Key</label>
          <div class="field-input-wrap">
            <input type="password" id="CLIPROXY_API_KEY" name="CLIPROXY_API_KEY" class="has-toggle" autocomplete="off" />
            <button type="button" class="toggle-btn" data-target="CLIPROXY_API_KEY" title="Toggle visibility">👁</button>
          </div>
        </div>
      </div>

      <!-- IMAGE -->
      <div class="section">
        <div class="section-title">Image</div>

        <div class="field">
          <label for="IMAGE_MODEL">Model</label>
          <div class="field-input-wrap">
            <input type="text" id="IMAGE_MODEL" name="IMAGE_MODEL" placeholder="gpt-image-1" autocomplete="off" />
          </div>
        </div>
        <p class="field-hint">Tên model AI dùng để sinh ảnh. Hiện tại: <strong style="color:#a78bfa">gpt-image-1</strong> (hỗ trợ edit nhiều ảnh). Thay đổi nếu CLIProxy hỗ trợ model khác.</p>

        <div class="field">
          <label for="IMAGE_SIZE">Size</label>
          <div class="field-input-wrap">
            <select id="IMAGE_SIZE" name="IMAGE_SIZE">
              <option value="1024x1024">1024 × 1024 — Vuông (1:1)</option>
              <option value="1536x1024">1536 × 1024 — Ngang (3:2)</option>
              <option value="1024x1536">1024 × 1536 — Dọc (2:3)</option>
            </select>
          </div>
        </div>
        <p class="field-hint">Kích thước ảnh mặc định. User có thể ghi đè bằng flag <code style="color:#a78bfa">--ratio 16:9</code> khi nhắn tin.</p>
      </div>

      <!-- SESSION -->
      <div class="section">
        <div class="section-title">Session</div>

        <div class="field">
          <label for="SESSION_HISTORY_LIMIT">History Limit</label>
          <div class="field-input-wrap">
            <input type="number" id="SESSION_HISTORY_LIMIT" name="SESSION_HISTORY_LIMIT" min="1" />
          </div>
        </div>
        <p class="field-hint">Số lượng ảnh tối đa bot ghi nhớ trong 1 phiên làm việc của mỗi user. Bot dùng lịch sử này để chỉnh sửa ảnh liên tiếp (edit mode). Tăng lên nếu muốn bot nhớ lâu hơn; giảm xuống để tiết kiệm bộ nhớ.</p>

        <div class="field">
          <label for="SESSION_EXPIRE_MINUTES">Expire (minutes)</label>
          <div class="field-input-wrap">
            <input type="number" id="SESSION_EXPIRE_MINUTES" name="SESSION_EXPIRE_MINUTES" min="1" />
          </div>
        </div>
        <p class="field-hint">Thời gian không hoạt động trước khi session tự động xoá. Ví dụ: 60 = nếu user không nhắn tin trong 60 phút, lịch sử bị xoá và lần sau bot coi như user mới. Khuyến nghị: 30–120 phút.</p>
      </div>

      <!-- QUEUE -->
      <div class="section">
        <div class="section-title">Queue</div>

        <div class="field">
          <label for="CHANNEL_QUEUE_MAX_PENDING">Max Pending</label>
          <div class="field-input-wrap">
            <input type="number" id="CHANNEL_QUEUE_MAX_PENDING" name="CHANNEL_QUEUE_MAX_PENDING" min="1" />
          </div>
        </div>
        <p class="field-hint">Số request đang chờ xử lý tối đa trong mỗi channel. Nếu vượt quá, bot tự từ chối request mới và báo "Channel is busy". Tăng nếu nhiều user cùng gửi lệnh; giảm để tránh hàng đợi quá dài. Khuyến nghị: 3–10.</p>
      </div>

      <!-- OPENAI FALLBACK -->
      <div class="section">
        <div class="section-title">OpenAI Fallback</div>
        <div class="field">
          <label for="OPENAI_API_KEY">API Key</label>
          <div class="field-input-wrap">
            <input type="password" id="OPENAI_API_KEY" name="OPENAI_API_KEY" class="has-toggle"
                   autocomplete="off" placeholder="sk-... (optional)" />
            <button type="button" class="toggle-btn" data-target="OPENAI_API_KEY" title="Toggle">👁</button>
          </div>
        </div>
        <p class="field-hint">API key OpenAI dự phòng khi CLIProxy bị lỗi (5xx). Nếu để trống, bot sẽ báo lỗi thẳng cho user thay vì tự chuyển sang OpenAI. Để trống nếu không muốn dùng fallback.</p>
      </div>

      <hr class="divider" />

      <div class="actions">
        <div id="bot-status">
          <span class="status-dot" id="status-dot"></span>
          <span id="status-label">Checking...</span>
        </div>
        <button type="button" class="btn btn-save" id="btn-save">💾 Save Config</button>
        <button type="button" class="btn btn-restart" id="btn-restart">🔄 Save &amp; Restart Bot</button>
      </div>

    </form>

    <hr class="divider" />

    <!-- LOG VIEWER -->
    <div class="section">
      <div class="section-title" style="justify-content:space-between;">
        <span>Logs</span>
        <div style="display:flex; gap:8px; align-items:center;">
          <select id="log-file-sel" style="background:#16213e; border:1px solid #2d2d4e; color:#e0e0e0; border-radius:4px; padding:4px 8px; font-size:0.78rem; cursor:pointer;">
            <option value="bot">bot.log</option>
            <option value="bot-error">bot.error.log</option>
            <option value="config-ui">config-ui.log</option>
            <option value="config-ui-error">config-ui.error.log</option>
          </select>
          <button id="btn-refresh-logs" style="background:#2d2d4e; color:#b0b0c8; border:none; border-radius:4px; padding:4px 10px; font-size:0.78rem; cursor:pointer; font-weight:600;">↻ Refresh</button>
        </div>
      </div>
      <pre id="log-content"></pre>
    </div>

  </div>

  <div id="toast"></div>

  <script>
    const KEYS = [
      'DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'ALLOWED_CHANNEL_IDS', 'ERROR_CHANNEL_ID',
      'CLIPROXY_API_URL', 'CLIPROXY_API_KEY',
      'IMAGE_MODEL', 'IMAGE_SIZE',
      'SESSION_HISTORY_LIMIT', 'SESSION_EXPIRE_MINUTES',
      'CHANNEL_QUEUE_MAX_PENDING',
      'OPENAI_API_KEY',
    ];

    // ── Toast ──────────────────────────────────────────────────────────────
    let toastTimer = null;
    function showToast(msg, type = 'success') {
      const el = document.getElementById('toast');
      el.textContent = msg;
      el.className = 'show ' + type;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => {
        el.className = '';
      }, 3000);
    }

    // ── Password toggles ───────────────────────────────────────────────────
    document.querySelectorAll('.toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const targetId = btn.getAttribute('data-target');
        const input = document.getElementById(targetId);
        input.type = input.type === 'password' ? 'text' : 'password';
      });
    });

    // ── Channel name resolution ────────────────────────────────────────────
    // Cache: id → "#name"
    let channelNameCache = {};

    async function resolveAndApplyNames() {
      // Collect all known IDs from config fields + channel prompt cards
      const ids = new Set();
      const allowedRaw = (document.getElementById('ALLOWED_CHANNEL_IDS')?.value || '');
      allowedRaw.split(',').map(s => s.trim()).filter(Boolean).forEach(id => ids.add(id));
      const errorId = (document.getElementById('ERROR_CHANNEL_ID')?.value || '').trim();
      if (errorId) ids.add(errorId);
      document.querySelectorAll('.channel-id-input').forEach(el => {
        const v = el.value.trim();
        if (v) ids.add(v);
      });

      if (ids.size === 0) return;

      try {
        const res = await fetch('/api/discord/channel-names?ids=' + [...ids].join(','));
        if (!res.ok) return;
        channelNameCache = { ...channelNameCache, ...(await res.json()) };
      } catch { return; }

      applyChannelNames();
    }

    function applyChannelNames() {
      // ERROR_CHANNEL_ID → single hint
      const errorId = (document.getElementById('ERROR_CHANNEL_ID')?.value || '').trim();
      const errorEl = document.getElementById('error-channel-name');
      if (errorEl) {
        const name = errorId && channelNameCache[errorId];
        errorEl.textContent = name ? '#' + name : '';
      }

      // Channel cards → name label under each ID input
      document.querySelectorAll('.channel-card').forEach(card => {
        const idInput = card.querySelector('.channel-id-input');
        const nameEl = card.querySelector('.channel-name-label');
        if (!idInput || !nameEl) return;
        const id = idInput.value.trim();
        const name = id && channelNameCache[id];
        nameEl.textContent = name ? '#' + name : '';
      });
    }

    // ── Load config ────────────────────────────────────────────────────────
    async function loadConfig() {
      try {
        const res = await fetch('/api/config');
        const data = await res.json();
        for (const key of KEYS) {
          const el = document.getElementById(key);
          if (el && data[key] !== undefined) {
            el.value = data[key];
          }
        }
        // Resolve names after config values are populated
        await resolveAndApplyNames();
      } catch (err) {
        showToast('Failed to load config: ' + err.message, 'error');
      }
    }

    // ── Collect form data ──────────────────────────────────────────────────
    function collectFormData() {
      const payload = {};
      for (const key of KEYS) {
        const el = document.getElementById(key);
        if (el) payload[key] = el.value;
      }
      return payload;
    }

    // ── Save ───────────────────────────────────────────────────────────────
    document.getElementById('btn-save').addEventListener('click', async () => {
      try {
        const res = await fetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(collectFormData()),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Save failed');
        showToast('Config saved!', 'success');
      } catch (err) {
        showToast('Error: ' + err.message, 'error');
      }
    });

    // ── Bot status ─────────────────────────────────────────────────────────
    function updateStatusUI(status) {
      const dot = document.getElementById('status-dot');
      const label = document.getElementById('status-label');
      if (!dot || !label) return;
      dot.className = 'status-dot ' + status;
      label.textContent = status === 'online' ? 'Bot Online'
                        : status === 'restarting' ? 'Restarting...'
                        : 'Bot Offline';
      label.style.color = status === 'online' ? '#10b981'
                        : status === 'restarting' ? '#f59e0b'
                        : '#6b7280';
    }

    async function checkBotStatus() {
      try {
        const res = await fetch('/api/bot-status');
        const data = await res.json();
        updateStatusUI(data.status);
        return data.status;
      } catch {
        updateStatusUI('offline');
        return 'offline';
      }
    }

    // Check on load + every 10s
    checkBotStatus();
    setInterval(checkBotStatus, 10000);

    // ── Save & Restart ─────────────────────────────────────────────────────
    document.getElementById('btn-restart').addEventListener('click', async () => {
      const btn = document.getElementById('btn-restart');
      try {
        btn.disabled = true;
        btn.textContent = '⏳ Restarting...';
        updateStatusUI('restarting');

        const res = await fetch('/api/restart', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(collectFormData()),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Restart failed');

        // Poll until bot comes back online (max 30s)
        let attempts = 0;
        const poll = async () => {
          attempts++;
          const status = await checkBotStatus();
          if (status === 'online') {
            showToast('✅ Bot restarted successfully!', 'success');
            btn.disabled = false;
            btn.innerHTML = '🔄 Save &amp; Restart Bot';
          } else if (attempts < 30) {
            setTimeout(poll, 1000);
          } else {
            showToast('⚠️ Bot is taking too long to start', 'error');
            btn.disabled = false;
            btn.innerHTML = '🔄 Save &amp; Restart Bot';
          }
        };
        setTimeout(poll, 1500); // wait 1.5s before first check

      } catch (err) {
        showToast('Error: ' + err.message, 'error');
        btn.disabled = false;
        btn.innerHTML = '🔄 Save &amp; Restart Bot';
        updateStatusUI('offline');
      }
    });

    loadConfig();

    // ── Usage Stats ────────────────────────────────────────────────────────────
    async function loadStats() {
      try {
        const res = await fetch('/api/stats');
        if (!res.ok) return;
        const { today, week } = await res.json();
        const fmt = d => \`\${d.generates} gen · \${d.edits} edit\`;
        document.getElementById('stats-today').textContent = fmt(today);
        document.getElementById('stats-week').textContent  = fmt(week);
      } catch { /* silent */ }
    }
    loadStats();
    setInterval(loadStats, 30000); // refresh mỗi 30s

    // ── Log Viewer ─────────────────────────────────────────────────────────────
    async function loadLogs() {
      const file = document.getElementById('log-file-sel').value;
      const pre  = document.getElementById('log-content');
      try {
        const res = await fetch(\`/api/logs?file=\${file}&lines=100\`);
        if (!res.ok) { pre.textContent = 'Không thể tải log.'; return; }
        const { content } = await res.json();
        pre.textContent = content || '(trống)';
        pre.scrollTop = pre.scrollHeight; // scroll to bottom
      } catch (err) {
        pre.textContent = 'Lỗi: ' + err.message;
      }
    }
    loadLogs();
    document.getElementById('btn-refresh-logs').addEventListener('click', loadLogs);
    document.getElementById('log-file-sel').addEventListener('change', loadLogs);

    // ── Test CLIProxy connection ────────────────────────────────────────────────
    document.getElementById('btn-test-cliproxy').addEventListener('click', async () => {
      const btn = document.getElementById('btn-test-cliproxy');
      const url    = document.getElementById('CLIPROXY_API_URL').value.trim();
      const apiKey = document.getElementById('CLIPROXY_API_KEY').value.trim();
      if (!url) { showToast('Nhập URL trước', 'error'); return; }
      btn.textContent = '...';
      btn.className = 'btn-test';
      try {
        const res = await fetch('/api/test/cliproxy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url, apiKey }),
        });
        const data = await res.json();
        if (data.ok) {
          btn.textContent = \`✓ \${data.latencyMs}ms\`;
          btn.className = 'btn-test ok';
        } else {
          btn.textContent = '✗ Fail';
          btn.className = 'btn-test fail';
          showToast('CLIProxy: ' + data.error, 'error');
        }
      } catch (err) {
        btn.textContent = '✗ Fail';
        btn.className = 'btn-test fail';
        showToast('Test failed: ' + err.message, 'error');
      }
      setTimeout(() => { btn.textContent = 'Test'; btn.className = 'btn-test'; }, 4000);
    });

    // ── Unified Channel Manager ────────────────────────────────────────────────

    /** Rebuild ALLOWED_CHANNEL_IDS hidden input from current channel cards. */
    function syncAllowedChannelIds() {
      const ids = [];
      document.querySelectorAll('#unified-channel-list .channel-card').forEach(card => {
        const id = card.querySelector('.channel-id-input')?.value.trim();
        if (id) ids.push(id);
      });
      document.getElementById('ALLOWED_CHANNEL_IDS').value = ids.join(',');
    }

    function renderUnifiedChannelCard(data = { channelId: '', systemPrompt: '' }, isNew = false) {
      const card = document.createElement('div');
      card.className = 'channel-card';
      const cachedName = data.channelId && channelNameCache[data.channelId]
        ? '#' + channelNameCache[data.channelId] : '';
      card.innerHTML = \`
        <div class="channel-id-row">
          <input type="text" placeholder="Channel ID (e.g. 123456789012345678)"
                 value="\${data.channelId}" \${isNew ? '' : 'readonly'}
                 class="channel-id-input" />
          <button class="btn btn-sm btn-danger btn-delete-channel">🗑️</button>
        </div>
        <div class="channel-name-label">\${cachedName}</div>
        <textarea class="channel-prompt-input" rows="2"
          placeholder="System prompt (optional) — vd: Game art style, anime aesthetic"
        >\${data.systemPrompt || ''}</textarea>
        <div class="card-actions">
          <button class="btn btn-sm btn-save btn-save-channel">💾 Save</button>
        </div>
      \`;

      card.querySelector('.btn-save-channel').addEventListener('click', async () => {
        const channelId = card.querySelector('.channel-id-input').value.trim();
        const systemPrompt = card.querySelector('.channel-prompt-input').value;
        if (!channelId) { showToast('Channel ID is required', 'error'); return; }
        try {
          // 1. Save system prompt to DB (even if empty — registers the channel)
          const r = await fetch('/api/channel-prompts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ channelId, systemPrompt }),
          });
          if (!r.ok) throw new Error((await r.json()).error);
          // 2. Lock ID and sync hidden ALLOWED_CHANNEL_IDS
          card.querySelector('.channel-id-input').readOnly = true;
          syncAllowedChannelIds();
          // 3. Resolve + display name
          await resolveAndApplyNames();
          showToast('Channel saved!', 'success');
        } catch (err) {
          showToast('Error: ' + err.message, 'error');
        }
      });

      card.querySelector('.btn-delete-channel').addEventListener('click', async () => {
        const channelId = card.querySelector('.channel-id-input').value.trim();
        if (!channelId) { card.remove(); syncAllowedChannelIds(); return; }
        try {
          await fetch(\`/api/channel-prompts/\${channelId}\`, { method: 'DELETE' });
          card.remove();
          syncAllowedChannelIds();
          showToast('Channel removed', 'success');
        } catch (err) {
          showToast('Error: ' + err.message, 'error');
        }
      });

      return card;
    }

    async function loadUnifiedChannels() {
      try {
        // Load saved system prompts
        const r1 = await fetch('/api/channel-prompts');
        const prompts = await r1.json();
        const promptMap = Object.fromEntries(prompts.map(p => [p.channelId, p.systemPrompt]));

        // Load ALLOWED_CHANNEL_IDS (may include channels without prompts)
        const r2 = await fetch('/api/config');
        const config = await r2.json();
        const allowedIds = (config.ALLOWED_CHANNEL_IDS || '').split(',').map(s => s.trim()).filter(Boolean);

        // Union of both sources, preserving order (allowed first)
        const allIds = [...new Set([...allowedIds, ...prompts.map(p => p.channelId)])];

        const container = document.getElementById('unified-channel-list');
        container.innerHTML = '';
        for (const id of allIds) {
          container.appendChild(renderUnifiedChannelCard(
            { channelId: id, systemPrompt: promptMap[id] || '' }, false
          ));
        }
        // Sync hidden input
        document.getElementById('ALLOWED_CHANNEL_IDS').value = allIds.join(',');
        // Resolve names for all cards
        await resolveAndApplyNames();
      } catch (err) {
        showToast('Failed to load channels: ' + err.message, 'error');
      }
    }

    document.getElementById('btn-add-channel').addEventListener('click', () => {
      document.getElementById('unified-channel-list')
        .appendChild(renderUnifiedChannelCard({ channelId: '', systemPrompt: '' }, true));
    });

    loadUnifiedChannels();
  </script>
</body>
</html>`;

// ── Express App ──────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

// GET / — Serve HTML
app.get('/', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(HTML);
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

// POST /api/restart — Write .env + kill/respawn bot
app.post('/api/restart', (req: Request, res: Response) => {
  try {
    const data = req.body as EnvMap;
    writeEnv(data);
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
// Resolves channel IDs → names via Discord API using the saved bot token.
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
            const data = await r.json() as { name?: string; topic?: string };
            result[id] = data.name ?? id;
          }
        } catch {
          // ignore — channel may be inaccessible
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
      return void res.json({ today: { generates: 0, edits: 0 }, week: { generates: 0, edits: 0 } });
    }
    const todayDate = new Date().toLocaleDateString('sv');
    const weekAgo   = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toLocaleDateString('sv');
    const today = (db.prepare('SELECT generates, edits FROM image_stats WHERE date = ?').get(todayDate)
      as { generates: number; edits: number } | undefined) ?? { generates: 0, edits: 0 };
    const week = db.prepare(
      'SELECT COALESCE(SUM(generates),0) AS generates, COALESCE(SUM(edits),0) AS edits FROM image_stats WHERE date >= ?'
    ).get(weekAgo) as { generates: number; edits: number };
    db.close();
    res.json({ today, week });
  } catch {
    res.json({ today: { generates: 0, edits: 0 }, week: { generates: 0, edits: 0 } });
  }
});

// GET /api/logs?file=bot&lines=100 — tail log files
app.get('/api/logs', (req: Request, res: Response) => {
  const fileKey = String(req.query['file'] ?? 'bot');
  const lines   = Math.min(200, Math.max(1, parseInt(String(req.query['lines'] ?? '100'), 10)));
  const fileMap: Record<string, string> = {
    'bot':           'bot.log',
    'bot-error':     'bot.error.log',
    'config-ui':     'config-ui.log',
    'config-ui-error': 'config-ui.error.log',
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
    // 401/404 means server is reachable, just auth/route mismatch
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
