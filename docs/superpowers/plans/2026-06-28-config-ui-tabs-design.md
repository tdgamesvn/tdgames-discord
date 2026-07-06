# Config UI — Tab Layout Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor `tools/config-ui/server.ts` từ vertical-scroll layout thành 7-tab layout (Overview, Image Gen, Text Chat, Upscaler, Intelligence, Settings, Logs) — UI refactor thuần, không đổi API.

**Architecture:** Xóa `const HTML = \`...\`` (lines 183–1583). Thay bằng `renderHtml()` gọi các `render*Tab()` và `renderClientJS()`. Per-tab Save buttons chỉ ghi đúng env keys của tab đó. Restart Bot chỉ ở Overview (không kèm Save). Backend routes giữ nguyên.

**Tech Stack:** TypeScript 5.3, Express.js, Vanilla HTML/CSS/JS, SQLite better-sqlite3, tsx runner.

## Global Constraints
- Không thêm npm dependency mới
- Không thêm/xóa API endpoints — giữ nguyên tất cả `/api/*` routes
- Dark theme: bg `#1a1a2e`, accent `#a78bfa`, purple `#7c3aed`, border `#2d2d4e`
- Container max-width: `800px` (mở rộng từ 640px)
- `npm run build` clean sau mỗi task
- `npm test` giữ nguyên 72 tests passed

## Phát hiện cần fix (env key mismatch)
Config.ts đọc `IMAGE_CHANNEL_IDS` nhưng server.ts hiện save vào `ALLOWED_CHANNEL_IDS` → sửa luôn trong Task 3.  
Config.ts đọc `CHAT_CHANNEL_IDS` nhưng server.ts hiện save vào `TEXT_CHANNEL_IDS` → sửa luôn trong Task 4.

## File Structure

```
tools/config-ui/server.ts
├── imports & setup (giữ nguyên)
├── getDb() (giữ nguyên)
├── readEnv() / writeEnv() (giữ nguyên)
├── restartBot() (giữ nguyên, task 10 sẽ fix /api/restart route)
│
├── [MỚI] renderCss()
├── [MỚI] renderTabNav()
├── [MỚI] renderOverviewTab()
├── [MỚI] renderImageGenTab()
├── [MỚI] renderTextChatTab()
├── [MỚI] renderUpscalerTab()
├── [MỚI] renderIntelligenceTab()
├── [MỚI] renderSettingsTab()
├── [MỚI] renderLogsTab()
├── [MỚI] renderClientJS()
├── [MỚI] renderHtml()
│
└── app.get/post routes (giữ nguyên — chỉ sửa app.get('/') gọi renderHtml())
```

---

## Task 1: Scaffold — render functions + CSS tabs + empty panels

**Files:**
- Modify: `tools/config-ui/server.ts`

**Interfaces:**
- Produces: `renderHtml(): string` được gọi bởi `app.get('/')`
- Produces: tab switching JS hoạt động — 7 tabs chuyển đổi, content trống

- [ ] **Step 1: Xóa const HTML**

Xóa toàn bộ block từ dòng 183 đến dòng 1583 (inclusive):
```ts
const HTML = `<!DOCTYPE html>
...
</html>`;
```

- [ ] **Step 2: Thêm renderCss() — ngay trên dòng `const app = express()`**

```ts
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
    .btn-test.ok  { background: #064e3b; color: #6ee7b7; }
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
    #log-content:empty::before { content: '(trống)'; color: #4a4a6a; }

    /* ── Stats cards ── */
    .stats-bar {
      display: flex;
      background: #16213e;
      border: 1px solid #2d2d4e;
      border-radius: 8px;
      overflow: hidden;
      margin-bottom: 24px;
    }
    .stat-cell {
      flex: 1;
      padding: 12px 16px;
      border-right: 1px solid #2d2d4e;
    }
    .stat-cell:last-child { border-right: none; }
    .stat-label { font-size: 0.68rem; color: #7c7ca8; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 4px; }
    .stat-value { font-size: 1rem; font-weight: 700; color: #a78bfa; }
  `;
}
```

- [ ] **Step 3: Thêm renderTabNav()**

```ts
function renderTabNav(): string {
  return `
    <div class="tabs-nav">
      <button class="tab-btn active" data-tab="overview">📊 Overview</button>
      <button class="tab-btn" data-tab="image-gen">🖼 Image Gen</button>
      <button class="tab-btn" data-tab="text-chat">💬 Text Chat</button>
      <button class="tab-btn" data-tab="upscaler">⬆️ Upscaler</button>
      <button class="tab-btn" data-tab="intelligence">🧠 Intelligence</button>
      <button class="tab-btn" data-tab="settings">⚙️ Settings</button>
      <button class="tab-btn" data-tab="logs">📋 Logs</button>
    </div>
  `;
}
```

- [ ] **Step 4: Thêm 7 render*Tab() stubs (để trống nội dung tạm thời)**

```ts
function renderOverviewTab(): string {
  return `<div id="tab-overview" class="tab-panel active"><p style="color:#7c7ca8;">Overview — coming soon</p></div>`;
}

function renderImageGenTab(): string {
  return `<div id="tab-image-gen" class="tab-panel"><p style="color:#7c7ca8;">Image Gen — coming soon</p></div>`;
}

function renderTextChatTab(): string {
  return `<div id="tab-text-chat" class="tab-panel"><p style="color:#7c7ca8;">Text Chat — coming soon</p></div>`;
}

function renderUpscalerTab(): string {
  return `<div id="tab-upscaler" class="tab-panel"><p style="color:#7c7ca8;">Upscaler — coming soon</p></div>`;
}

function renderIntelligenceTab(): string {
  return `<div id="tab-intelligence" class="tab-panel"><p style="color:#7c7ca8;">Intelligence — coming soon</p></div>`;
}

function renderSettingsTab(): string {
  return `<div id="tab-settings" class="tab-panel"><p style="color:#7c7ca8;">Settings — coming soon</p></div>`;
}

function renderLogsTab(): string {
  return `<div id="tab-logs" class="tab-panel"><p style="color:#7c7ca8;">Logs — coming soon</p></div>`;
}
```

- [ ] **Step 5: Thêm renderClientJS() stub (chỉ có tab switching)**

```ts
function renderClientJS(): string {
  return `
  <script>
    // ── Tab switching ──────────────────────────────────────────────────────────
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
      });
    });

    // ── Toast ──────────────────────────────────────────────────────────────────
    let toastTimer = null;
    function showToast(msg, type) {
      type = type || 'success';
      const el = document.getElementById('toast');
      el.textContent = msg;
      el.className = 'show ' + type;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { el.className = ''; }, 3000);
    }
  </script>
  `;
}
```

- [ ] **Step 6: Thêm renderHtml()**

```ts
function renderHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>TDGames Discord Bot — Config</title>
  <style>${renderCss()}</style>
</head>
<body>
  <div class="container">
    <div class="header">🎮 TDGames Discord Bot — Config</div>
    ${renderTabNav()}
    ${renderOverviewTab()}
    ${renderImageGenTab()}
    ${renderTextChatTab()}
    ${renderUpscalerTab()}
    ${renderIntelligenceTab()}
    ${renderSettingsTab()}
    ${renderLogsTab()}
  </div>
  <div id="toast"></div>
  ${renderClientJS()}
</body>
</html>`;
}
```

- [ ] **Step 7: Update app.get('/') — thay `res.send(HTML)` thành `res.send(renderHtml())`**

```ts
app.get('/', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(renderHtml());
});
```

- [ ] **Step 8: Chạy build và verify**

```bash
cd /Users/tdgames_mac01/Work/apps/tdgames-discord
npm run build
```

Expected: `tsc` exits 0, không có TypeScript errors.

- [ ] **Step 9: Commit**

```bash
git add tools/config-ui/server.ts
git commit -m "refactor(config-ui): scaffold tab layout — render functions + CSS + empty panels"
```

---

## Task 2: Overview Tab

**Files:**
- Modify: `tools/config-ui/server.ts` — `renderOverviewTab()` và `renderClientJS()`

**Interfaces:**
- Consumes: `/api/stats`, `/api/bot-status`, `/api/restart`
- Produces: Stats bar, bot status dot+label, Restart Bot button

- [ ] **Step 1: Điền nội dung renderOverviewTab()**

Thay thế stub hiện tại bằng:

```ts
function renderOverviewTab(): string {
  return `
  <div id="tab-overview" class="tab-panel active">

    <!-- Stats bar -->
    <div class="stats-bar">
      <div class="stat-cell">
        <div class="stat-label">Hôm nay</div>
        <div class="stat-value" id="stats-today">—</div>
      </div>
      <div class="stat-cell">
        <div class="stat-label">7 ngày qua</div>
        <div class="stat-value" id="stats-week">—</div>
      </div>
    </div>

    <!-- Bot status + Restart -->
    <div style="display:flex; align-items:center; gap:16px; background:#16213e; border:1px solid #2d2d4e; border-radius:8px; padding:16px 20px;">
      <div id="bot-status">
        <span class="status-dot" id="status-dot"></span>
        <span id="status-label">Checking...</span>
      </div>
      <button type="button" class="btn btn-restart" id="btn-restart" style="margin-left:auto;">
        🔄 Restart Bot
      </button>
    </div>

  </div>
  `;
}
```

- [ ] **Step 2: Thêm JS cho Overview vào renderClientJS() — sau phần toast**

Thêm vào trong `<script>` của `renderClientJS()`:

```js
    // ── Bot status ─────────────────────────────────────────────────────────────
    function updateStatusUI(status) {
      const dot   = document.getElementById('status-dot');
      const label = document.getElementById('status-label');
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
        const res = await fetch('/api/bot-status');
        const data = await res.json();
        updateStatusUI(data.status);
        return data.status;
      } catch {
        updateStatusUI('offline');
        return 'offline';
      }
    }

    checkBotStatus();
    setInterval(checkBotStatus, 10000);

    // ── Restart Bot ────────────────────────────────────────────────────────────
    document.getElementById('btn-restart').addEventListener('click', async () => {
      const btn = document.getElementById('btn-restart');
      try {
        btn.disabled = true;
        btn.textContent = '⏳ Restarting...';
        updateStatusUI('restarting');

        const res = await fetch('/api/restart', { method: 'POST' });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Restart failed');

        let attempts = 0;
        const poll = async () => {
          attempts++;
          const status = await checkBotStatus();
          if (status === 'online') {
            showToast('✅ Bot restarted!', 'success');
            btn.disabled = false;
            btn.textContent = '🔄 Restart Bot';
          } else if (attempts < 30) {
            setTimeout(poll, 1000);
          } else {
            showToast('⚠️ Bot đang mất nhiều thời gian hơn bình thường', 'error');
            btn.disabled = false;
            btn.textContent = '🔄 Restart Bot';
          }
        };
        setTimeout(poll, 1500);
      } catch (err) {
        showToast('Lỗi: ' + err.message, 'error');
        btn.disabled = false;
        btn.textContent = '🔄 Restart Bot';
        updateStatusUI('offline');
      }
    });

    // ── Stats ──────────────────────────────────────────────────────────────────
    async function loadStats() {
      try {
        const res = await fetch('/api/stats');
        if (!res.ok) return;
        const { today, week } = await res.json();
        const fmt = d => {
          const img  = (d.generates || 0) + (d.edits || 0);
          const imgFb = d.image_openai || 0;
          const chat = (d.text_cliproxy || 0) + (d.text_openai || 0);
          return img + (imgFb ? \`+\${imgFb}↑\` : '') + ' ảnh · ' + chat + ' chat';
        };
        document.getElementById('stats-today').textContent = fmt(today);
        document.getElementById('stats-week').textContent  = fmt(week);
      } catch { /* silent */ }
    }
    loadStats();
    setInterval(loadStats, 30000);
```

- [ ] **Step 3: Fix /api/restart — bỏ writeEnv, chỉ gọi restartBot()**

Tìm route `app.post('/api/restart', ...)` và thay bằng:

```ts
// POST /api/restart — kill/respawn bot (không save env — save riêng ở từng tab)
app.post('/api/restart', (_req: Request, res: Response) => {
  try {
    restartBot();
    res.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});
```

- [ ] **Step 4: Build verify**

```bash
npm run build
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add tools/config-ui/server.ts
git commit -m "feat(config-ui): overview tab — stats, bot status, restart button (separate from save)"
```

---

## Task 3: Image Gen Tab

**Files:**
- Modify: `tools/config-ui/server.ts` — `renderImageGenTab()` và `renderClientJS()`

**Interfaces:**
- Env keys: `IMAGE_CHANNEL_IDS` (fix từ `ALLOWED_CHANNEL_IDS`), `IMAGE_MODEL`, `IMAGE_SIZE`, `IMAGE_FALLBACK_MODEL` (mới), `OPENAI_API_KEY`
- Consumes: `/api/channel-prompts`, `/api/config`

- [ ] **Step 1: Điền nội dung renderImageGenTab()**

```ts
function renderImageGenTab(): string {
  return `
  <div id="tab-image-gen" class="tab-panel">

    <!-- Image Channels -->
    <div class="section">
      <div class="section-title">Image Channels</div>
      <input type="hidden" id="IMAGE_CHANNEL_IDS" name="IMAGE_CHANNEL_IDS" />
      <div id="image-channel-list"></div>
      <button type="button" id="btn-add-image-channel" class="btn btn-save btn-sm" style="margin-top:8px;">+ Add Channel</button>
    </div>

    <hr class="divider" />

    <!-- Model settings -->
    <div class="section">
      <div class="section-title">Model Settings</div>

      <div class="field">
        <label for="IMAGE_MODEL">Model</label>
        <div class="field-input-wrap">
          <input type="text" id="IMAGE_MODEL" name="IMAGE_MODEL" placeholder="gpt-image-1" autocomplete="off" />
        </div>
      </div>
      <p class="field-hint">Model AI để sinh ảnh. Mặc định: <strong style="color:#a78bfa">gpt-image-1</strong>.</p>

      <div class="field">
        <label for="IMAGE_SIZE">Size</label>
        <div class="field-input-wrap">
          <select id="IMAGE_SIZE" name="IMAGE_SIZE">
            <option value="auto">Tự động — Bot chọn tỉ lệ theo nội dung</option>
            <option value="1024x1024">1024 × 1024 — Vuông (1:1)</option>
            <option value="1536x1024">1536 × 1024 — Ngang (3:2)</option>
            <option value="1024x1536">1024 × 1536 — Dọc (2:3)</option>
          </select>
        </div>
      </div>
      <p class="field-hint">Kích thước ảnh mặc định. User override bằng flag <code style="color:#a78bfa">--ratio</code>.</p>

      <div class="field">
        <label for="IMAGE_FALLBACK_MODEL">Fallback Model</label>
        <div class="field-input-wrap">
          <input type="text" id="IMAGE_FALLBACK_MODEL" name="IMAGE_FALLBACK_MODEL" placeholder="gpt-image-2" autocomplete="off" />
        </div>
      </div>
      <p class="field-hint">Model dùng khi fallback sang OpenAI trực tiếp (CLIProxy lỗi 5xx).</p>
    </div>

    <hr class="divider" />

    <!-- OpenAI -->
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
      <p class="field-hint">API key OpenAI dự phòng khi CLIProxy bị lỗi. Để trống nếu không dùng fallback.</p>
    </div>

    <div class="actions">
      <button type="button" class="btn btn-save" id="btn-save-image-gen">💾 Save Image Gen</button>
    </div>

  </div>
  `;
}
```

- [ ] **Step 2: Thêm Image Channel Manager JS vào renderClientJS()**

Thêm sau phần Stats JS:

```js
    // ── Image Channel Manager ──────────────────────────────────────────────────
    let channelNameCache = {};

    async function resolveChannelNames(ids) {
      if (!ids || ids.length === 0) return;
      try {
        const res = await fetch('/api/discord/channel-names?ids=' + ids.join(','));
        if (!res.ok) return;
        Object.assign(channelNameCache, await res.json());
      } catch { /* silent */ }
    }

    function applyNameLabel(card) {
      const idInput = card.querySelector('.channel-id-input');
      const nameEl  = card.querySelector('.channel-name-label');
      if (!idInput || !nameEl) return;
      const id   = idInput.value.trim();
      const name = id && channelNameCache[id];
      nameEl.textContent = name ? '#' + name : (id ? '(bot cannot access this channel)' : '');
      nameEl.style.color = name ? '#a78bfa' : '#f87171';
    }

    function syncHiddenIds(listId, hiddenId) {
      const ids = [];
      document.querySelectorAll('#' + listId + ' .channel-card').forEach(card => {
        const id = card.querySelector('.channel-id-input')?.value.trim();
        if (id) ids.push(id);
      });
      const el = document.getElementById(hiddenId);
      if (el) el.value = ids.join(',');
    }

    function renderImageChannelCard(data) {
      data = data || { channelId: '', systemPrompt: '' };
      const card = document.createElement('div');
      card.className = 'channel-card';
      card.dataset.originalId = data.channelId;
      card.innerHTML = \`
        <div class="channel-id-row">
          <input type="text" placeholder="Channel ID" value="\${data.channelId}" class="channel-id-input" />
          <button class="btn btn-sm btn-danger btn-del-ch">🗑️</button>
        </div>
        <div class="channel-name-label"></div>
        <textarea class="channel-prompt-input" rows="2" placeholder="System prompt (optional)">\${data.systemPrompt || ''}</textarea>
        <div class="card-actions">
          <button class="btn btn-sm btn-save btn-save-ch">💾 Save</button>
        </div>
      \`;

      if (data.channelId) {
        resolveChannelNames([data.channelId]).then(() => applyNameLabel(card));
      }

      card.querySelector('.btn-save-ch').addEventListener('click', async () => {
        const channelId    = card.querySelector('.channel-id-input').value.trim();
        const systemPrompt = card.querySelector('.channel-prompt-input').value;
        if (!channelId) { showToast('Channel ID is required', 'error'); return; }
        const oldId = card.dataset.originalId;
        try {
          if (oldId && oldId !== channelId) {
            await fetch(\`/api/channel-prompts/\${oldId}\`, { method: 'DELETE' });
          }
          const r = await fetch('/api/channel-prompts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ channelId, systemPrompt }),
          });
          if (!r.ok) throw new Error((await r.json()).error);
          card.dataset.originalId = channelId;
          syncHiddenIds('image-channel-list', 'IMAGE_CHANNEL_IDS');
          await resolveChannelNames([channelId]);
          applyNameLabel(card);
          showToast('Channel saved!', 'success');
        } catch (err) { showToast('Error: ' + err.message, 'error'); }
      });

      card.querySelector('.btn-del-ch').addEventListener('click', async () => {
        const channelId = card.querySelector('.channel-id-input').value.trim();
        if (channelId) {
          try { await fetch(\`/api/channel-prompts/\${channelId}\`, { method: 'DELETE' }); }
          catch { /* ignore */ }
        }
        card.remove();
        syncHiddenIds('image-channel-list', 'IMAGE_CHANNEL_IDS');
        showToast('Channel removed', 'success');
      });

      return card;
    }

    async function loadImageChannels() {
      try {
        const [promptsRes, configRes] = await Promise.all([
          fetch('/api/channel-prompts').then(r => r.json()),
          fetch('/api/config').then(r => r.json()),
        ]);
        const promptMap   = Object.fromEntries(promptsRes.map(p => [p.channelId, p.systemPrompt]));
        const imageIds    = (configRes.IMAGE_CHANNEL_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
        const chatIds     = new Set((configRes.CHAT_CHANNEL_IDS || '').split(',').map(s => s.trim()).filter(Boolean));
        const allIds      = [...new Set([...imageIds, ...promptsRes.map(p => p.channelId)])].filter(id => !chatIds.has(id));
        const container   = document.getElementById('image-channel-list');
        container.innerHTML = '';
        for (const id of allIds) {
          container.appendChild(renderImageChannelCard({ channelId: id, systemPrompt: promptMap[id] || '' }));
        }
        document.getElementById('IMAGE_CHANNEL_IDS').value = allIds.join(',');
      } catch (err) { showToast('Failed to load image channels: ' + err.message, 'error'); }
    }

    document.getElementById('btn-add-image-channel').addEventListener('click', () => {
      document.getElementById('image-channel-list').appendChild(renderImageChannelCard({ channelId: '', systemPrompt: '' }));
    });

    // ── Image Gen Save ─────────────────────────────────────────────────────────
    document.getElementById('btn-save-image-gen').addEventListener('click', async () => {
      syncHiddenIds('image-channel-list', 'IMAGE_CHANNEL_IDS');
      const keys = ['IMAGE_CHANNEL_IDS', 'IMAGE_MODEL', 'IMAGE_SIZE', 'IMAGE_FALLBACK_MODEL', 'OPENAI_API_KEY'];
      const payload = {};
      keys.forEach(k => { const el = document.getElementById(k); if (el) payload[k] = el.value; });
      try {
        const res = await fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (!res.ok) throw new Error((await res.json()).error || 'Save failed');
        showToast('Image Gen saved!', 'success');
      } catch (err) { showToast('Error: ' + err.message, 'error'); }
    });

    // ── Password toggles ───────────────────────────────────────────────────────
    document.querySelectorAll('.toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const input = document.getElementById(btn.getAttribute('data-target'));
        if (input) input.type = input.type === 'password' ? 'text' : 'password';
      });
    });
```

- [ ] **Step 3: Build verify**

```bash
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add tools/config-ui/server.ts
git commit -m "feat(config-ui): image gen tab — channels, model, fallback, OpenAI key, per-tab save; fix IMAGE_CHANNEL_IDS env key"
```

---

## Task 4: Text Chat Tab

**Files:**
- Modify: `tools/config-ui/server.ts` — `renderTextChatTab()` và `renderClientJS()`

**Interfaces:**
- Env keys: `CHAT_CHANNEL_IDS` (fix từ `TEXT_CHANNEL_IDS`), `CHAT_MODEL`, `CHAT_FALLBACK_MODEL` (mới)

- [ ] **Step 1: Điền nội dung renderTextChatTab()**

```ts
function renderTextChatTab(): string {
  return `
  <div id="tab-text-chat" class="tab-panel">

    <!-- Text Channels -->
    <div class="section">
      <div class="section-title">Text Channels</div>
      <input type="hidden" id="CHAT_CHANNEL_IDS" name="CHAT_CHANNEL_IDS" />
      <div id="text-channel-list"></div>
      <button type="button" id="btn-add-text-channel" class="btn btn-sm" style="background:#059669; color:#fff; margin-top:8px;">+ Add Channel</button>
    </div>

    <hr class="divider" />

    <!-- Model settings -->
    <div class="section">
      <div class="section-title">Model Settings</div>

      <div class="field">
        <label for="CHAT_MODEL">Model</label>
        <div class="field-input-wrap">
          <input type="text" id="CHAT_MODEL" name="CHAT_MODEL" placeholder="gpt-4o-mini" autocomplete="off" />
        </div>
      </div>
      <p class="field-hint">Model AI dùng cho Text Channel. Mặc định: <strong style="color:#a78bfa">gpt-4o-mini</strong>.</p>

      <div class="field">
        <label for="CHAT_FALLBACK_MODEL">Fallback Model</label>
        <div class="field-input-wrap">
          <input type="text" id="CHAT_FALLBACK_MODEL" name="CHAT_FALLBACK_MODEL" placeholder="gpt-4o-mini" autocomplete="off" />
        </div>
      </div>
      <p class="field-hint">Model dùng khi fallback sang OpenAI trực tiếp (CLIProxy lỗi 5xx).</p>
    </div>

    <div class="actions">
      <button type="button" class="btn btn-save" id="btn-save-text-chat">💾 Save Text Chat</button>
    </div>

  </div>
  `;
}
```

- [ ] **Step 2: Thêm Text Channel Manager JS vào renderClientJS()**

Thêm sau phần Image Gen JS:

```js
    // ── Text Channel Manager ───────────────────────────────────────────────────
    function renderTextChannelCard(data) {
      data = data || { channelId: '', systemPrompt: '' };
      const card = document.createElement('div');
      card.className = 'channel-card';
      card.style.borderColor = '#065f46';
      card.dataset.originalId = data.channelId;
      card.innerHTML = \`
        <div class="channel-id-row">
          <input type="text" placeholder="Channel ID" value="\${data.channelId}" class="channel-id-input" />
          <button class="btn btn-sm btn-danger btn-del-ch">🗑️</button>
        </div>
        <div class="channel-name-label"></div>
        <textarea class="channel-prompt-input" rows="2" placeholder="System prompt (optional)">\${data.systemPrompt || ''}</textarea>
        <div class="card-actions">
          <button class="btn btn-sm btn-save btn-save-ch" style="background:#059669;">💾 Save</button>
        </div>
      \`;

      if (data.channelId) {
        resolveChannelNames([data.channelId]).then(() => applyNameLabel(card));
      }

      card.querySelector('.btn-save-ch').addEventListener('click', async () => {
        const channelId    = card.querySelector('.channel-id-input').value.trim();
        const systemPrompt = card.querySelector('.channel-prompt-input').value;
        if (!channelId) { showToast('Channel ID is required', 'error'); return; }
        const oldId = card.dataset.originalId;
        try {
          if (oldId && oldId !== channelId) {
            await fetch(\`/api/channel-prompts/\${oldId}\`, { method: 'DELETE' });
          }
          const r = await fetch('/api/channel-prompts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ channelId, systemPrompt }),
          });
          if (!r.ok) throw new Error((await r.json()).error);
          card.dataset.originalId = channelId;
          syncHiddenIds('text-channel-list', 'CHAT_CHANNEL_IDS');
          await resolveChannelNames([channelId]);
          applyNameLabel(card);
          showToast('Text channel saved!', 'success');
        } catch (err) { showToast('Error: ' + err.message, 'error'); }
      });

      card.querySelector('.btn-del-ch').addEventListener('click', async () => {
        const channelId = card.querySelector('.channel-id-input').value.trim();
        if (channelId) {
          try { await fetch(\`/api/channel-prompts/\${channelId}\`, { method: 'DELETE' }); }
          catch { /* ignore */ }
        }
        card.remove();
        syncHiddenIds('text-channel-list', 'CHAT_CHANNEL_IDS');
        showToast('Text channel removed', 'success');
      });

      return card;
    }

    async function loadTextChannels() {
      try {
        const [promptsRes, configRes] = await Promise.all([
          fetch('/api/channel-prompts').then(r => r.json()),
          fetch('/api/config').then(r => r.json()),
        ]);
        const promptMap = Object.fromEntries(promptsRes.map(p => [p.channelId, p.systemPrompt]));
        const textIds   = (configRes.CHAT_CHANNEL_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
        const container = document.getElementById('text-channel-list');
        container.innerHTML = '';
        for (const id of textIds) {
          container.appendChild(renderTextChannelCard({ channelId: id, systemPrompt: promptMap[id] || '' }));
        }
        document.getElementById('CHAT_CHANNEL_IDS').value = textIds.join(',');
      } catch (err) { showToast('Failed to load text channels: ' + err.message, 'error'); }
    }

    document.getElementById('btn-add-text-channel').addEventListener('click', () => {
      document.getElementById('text-channel-list').appendChild(renderTextChannelCard({ channelId: '', systemPrompt: '' }));
    });

    // ── Text Chat Save ─────────────────────────────────────────────────────────
    document.getElementById('btn-save-text-chat').addEventListener('click', async () => {
      syncHiddenIds('text-channel-list', 'CHAT_CHANNEL_IDS');
      const keys = ['CHAT_CHANNEL_IDS', 'CHAT_MODEL', 'CHAT_FALLBACK_MODEL'];
      const payload = {};
      keys.forEach(k => { const el = document.getElementById(k); if (el) payload[k] = el.value; });
      try {
        const res = await fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (!res.ok) throw new Error((await res.json()).error || 'Save failed');
        showToast('Text Chat saved!', 'success');
      } catch (err) { showToast('Error: ' + err.message, 'error'); }
    });
```

- [ ] **Step 3: Build verify**

```bash
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add tools/config-ui/server.ts
git commit -m "feat(config-ui): text chat tab — channels, model, fallback; fix CHAT_CHANNEL_IDS env key"
```

---

## Task 5: Upscaler Tab

**Files:**
- Modify: `tools/config-ui/server.ts` — `renderUpscalerTab()` và `renderClientJS()`

**Interfaces:**
- Env keys: `UPSCALE_CHANNEL_IDS`, `UPSCAYL_BIN_PATH`, `UPSCAYL_MODELS_PATH`, `UPSCALE_SCALE`, `UPSCALE_MODEL`

- [ ] **Step 1: Điền nội dung renderUpscalerTab()**

```ts
function renderUpscalerTab(): string {
  return `
  <div id="tab-upscaler" class="tab-panel">

    <!-- Upscaler Channels -->
    <div class="section">
      <div class="section-title">Upscaler Channels</div>
      <input type="hidden" id="UPSCALE_CHANNEL_IDS" name="UPSCALE_CHANNEL_IDS" />
      <div id="upscaler-channel-list"></div>
      <button type="button" id="btn-add-upscaler-channel" class="btn btn-sm" style="background:#7c3aed; color:#fff; margin-top:8px;">+ Add Channel</button>
    </div>

    <hr class="divider" />

    <!-- Upscayl settings -->
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
      <p class="field-hint">Đường dẫn tới binary <code style="color:#a78bfa">upscayl-bin</code>. Cài qua <code>brew install --cask upscayl</code>.</p>

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
            <option value="2">2x — Nhanh, file nhỏ</option>
            <option value="4">4x — Mặc định, cân bằng</option>
            <option value="8">8x — Chậm, file rất lớn</option>
          </select>
        </div>
      </div>
      <p class="field-hint"><strong style="color:#a78bfa">4x</strong> là lựa chọn tốt nhất cho hầu hết trường hợp.</p>

      <div class="field">
        <label for="UPSCALE_MODEL">Model</label>
        <div class="field-input-wrap">
          <select id="UPSCALE_MODEL" name="UPSCALE_MODEL">
            <option value="digital-art-4x">digital-art-4x — Anime / Game art (mặc định)</option>
            <option value="high-fidelity-4x">high-fidelity-4x — Giữ chi tiết cao</option>
            <option value="remacri-4x">remacri-4x — Ảnh thực tế</option>
            <option value="ultramix-balanced-4x">ultramix-balanced-4x — Cân bằng</option>
            <option value="ultrasharp-4x">ultrasharp-4x — Sắc nét</option>
          </select>
        </div>
      </div>
      <p class="field-hint">Với game art/anime: <strong style="color:#a78bfa">digital-art-4x</strong>. Với ảnh thực: <strong style="color:#a78bfa">remacri-4x</strong>.</p>
    </div>

    <div class="actions">
      <button type="button" class="btn btn-save" id="btn-save-upscaler">💾 Save Upscaler</button>
    </div>

  </div>
  `;
}
```

- [ ] **Step 2: Thêm Upscaler Channel Manager JS vào renderClientJS()**

```js
    // ── Upscaler Channel Manager ───────────────────────────────────────────────
    function renderUpscalerChannelCard(channelId) {
      channelId = channelId || '';
      const card = document.createElement('div');
      card.className = 'channel-card';
      card.style.borderColor = '#7c3aed';
      card.innerHTML = \`
        <div class="channel-id-row">
          <input type="text" placeholder="Channel ID" value="\${channelId}" class="channel-id-input" />
          <button class="btn btn-sm btn-danger btn-del-ch">🗑️</button>
        </div>
        <div class="channel-name-label"></div>
        <div class="card-actions">
          <button class="btn btn-sm btn-save btn-save-ch" style="background:#7c3aed;">💾 Save</button>
        </div>
      \`;

      if (channelId) {
        resolveChannelNames([channelId]).then(() => applyNameLabel(card));
      }

      card.querySelector('.btn-save-ch').addEventListener('click', async () => {
        const id = card.querySelector('.channel-id-input').value.trim();
        if (!id) { showToast('Channel ID is required', 'error'); return; }
        syncHiddenIds('upscaler-channel-list', 'UPSCALE_CHANNEL_IDS');
        await resolveChannelNames([id]);
        applyNameLabel(card);
        showToast('Upscaler channel saved!', 'success');
      });

      card.querySelector('.btn-del-ch').addEventListener('click', () => {
        card.remove();
        syncHiddenIds('upscaler-channel-list', 'UPSCALE_CHANNEL_IDS');
        showToast('Upscaler channel removed', 'success');
      });

      return card;
    }

    async function loadUpscalerChannels() {
      try {
        const config  = await fetch('/api/config').then(r => r.json());
        const ids     = (config.UPSCALE_CHANNEL_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
        const container = document.getElementById('upscaler-channel-list');
        container.innerHTML = '';
        for (const id of ids) { container.appendChild(renderUpscalerChannelCard(id)); }
        document.getElementById('UPSCALE_CHANNEL_IDS').value = ids.join(',');
      } catch (err) { showToast('Failed to load upscaler channels: ' + err.message, 'error'); }
    }

    document.getElementById('btn-add-upscaler-channel').addEventListener('click', () => {
      document.getElementById('upscaler-channel-list').appendChild(renderUpscalerChannelCard(''));
    });

    // ── Upscaler Save ──────────────────────────────────────────────────────────
    document.getElementById('btn-save-upscaler').addEventListener('click', async () => {
      syncHiddenIds('upscaler-channel-list', 'UPSCALE_CHANNEL_IDS');
      const keys = ['UPSCALE_CHANNEL_IDS', 'UPSCAYL_BIN_PATH', 'UPSCAYL_MODELS_PATH', 'UPSCALE_SCALE', 'UPSCALE_MODEL'];
      const payload = {};
      keys.forEach(k => { const el = document.getElementById(k); if (el) payload[k] = el.value; });
      try {
        const res = await fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (!res.ok) throw new Error((await res.json()).error || 'Save failed');
        showToast('Upscaler saved!', 'success');
      } catch (err) { showToast('Error: ' + err.message, 'error'); }
    });
```

- [ ] **Step 3: Build + Commit**

```bash
npm run build
git add tools/config-ui/server.ts
git commit -m "feat(config-ui): upscaler tab — channels, bin/model settings, per-tab save"
```

---

## Task 6: Intelligence Tab (Chat Storage Admin)

**Files:**
- Modify: `tools/config-ui/server.ts` — `renderIntelligenceTab()` và `renderClientJS()`

**Interfaces:**
- Consumes: `/api/chat-storage/summary`, `/api/chat-storage/groups`, `/api/chat-storage/channels`, `/api/chat-storage/agent-access/sync`
- Produces: Summary stats, Group CRUD, Channel assign, Sync button

- [ ] **Step 1: Điền nội dung renderIntelligenceTab()**

```ts
function renderIntelligenceTab(): string {
  return `
  <div id="tab-intelligence" class="tab-panel">

    <!-- Summary stats -->
    <div class="section">
      <div class="section-title" style="justify-content:space-between;">
        <span>Chat Storage</span>
        <button type="button" id="btn-refresh-intelligence" class="btn btn-sm" style="background:#374151; color:#e5e7eb;">↻ Refresh</button>
      </div>
      <div id="intelligence-summary" style="display:grid; grid-template-columns:repeat(4,1fr); gap:8px; margin-bottom:14px;"></div>
    </div>

    <!-- Agent Groups + Channels (2-column) -->
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:20px;">

      <!-- Groups editor -->
      <div>
        <div style="font-size:.75rem; color:#7c7ca8; font-weight:700; margin-bottom:10px; text-transform:uppercase; letter-spacing:0.08em;">Agent Groups</div>
        <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:10px;">
          <input id="group-key"   placeholder="group_key (vd: pm_project_updates)" style="background:#16213e; border:1px solid #2d2d4e; color:#e0e0e0; border-radius:6px; padding:7px; width:100%;" />
          <input id="group-name"  placeholder="Display name" style="background:#16213e; border:1px solid #2d2d4e; color:#e0e0e0; border-radius:6px; padding:7px; width:100%;" />
          <div style="display:flex; gap:8px;">
            <select id="group-agent" style="flex:1; background:#16213e; border:1px solid #2d2d4e; color:#e0e0e0; border-radius:6px; padding:7px;">
              <option value="pm">PM</option>
              <option value="ceo">CEO</option>
              <option value="hr">HR</option>
              <option value="finance">Finance</option>
            </select>
          </div>
          <textarea id="group-desc" rows="2" placeholder="Description" style="width:100%; background:#16213e; border:1px solid #2d2d4e; color:#e0e0e0; border-radius:6px; padding:7px;"></textarea>
        </div>
        <div style="display:flex; gap:8px; margin-bottom:12px; flex-wrap:wrap;">
          <button type="button" id="btn-save-group" class="btn btn-save btn-sm">💾 Save Group</button>
          <button type="button" id="btn-sync-agent-access" class="btn btn-sm" style="background:#7c3aed; color:#fff;">🔁 Sync Agent Access</button>
        </div>
        <div id="intelligence-groups" style="max-height:320px; overflow:auto;"></div>
      </div>

      <!-- Indexed Channels -->
      <div>
        <div style="font-size:.75rem; color:#7c7ca8; font-weight:700; margin-bottom:10px; text-transform:uppercase; letter-spacing:0.08em;">Indexed Channels</div>
        <input id="channel-filter" placeholder="Search channel/server..." style="width:100%; background:#16213e; border:1px solid #2d2d4e; color:#e0e0e0; border-radius:6px; padding:7px; margin-bottom:8px;" />
        <div id="intelligence-channels" style="max-height:440px; overflow:auto;"></div>
      </div>
    </div>

    <p style="font-size:.72rem; color:#7c7ca8; margin-top:14px;">Gán channel vào group theo agent. Agent PM/CEO/HR/Finance sẽ đọc Discord data qua group/access mapping này.</p>

  </div>
  `;
}
```

- [ ] **Step 2: Thêm Chat Storage JS vào renderClientJS()**

```js
    // ── Intelligence / Chat Storage ────────────────────────────────────────────
    let csState = { groups: [], channels: [], selectedGroupKey: null };

    function fmtNum(n) { return new Intl.NumberFormat().format(n || 0); }

    function renderIntelligenceSummary(summary) {
      const el = document.getElementById('intelligence-summary');
      if (!el) return;
      const cards = [
        ['Messages',  fmtNum(summary.totalMessages)],
        ['24h',       fmtNum(summary.messages24h)],
        ['Channels',  fmtNum(summary.channelsIndexed)],
        ['Backfill',  fmtNum(summary.backfill.savedMessages) + '/' + fmtNum(summary.backfill.scannedMessages)],
      ];
      el.innerHTML = cards.map(([k, v]) =>
        '<div style="background:#16213e; border:1px solid #2d2d4e; border-radius:8px; padding:10px;">' +
        '<div style="font-size:.65rem;color:#7c7ca8;text-transform:uppercase;">' + k + '</div>' +
        '<div style="font-weight:800;color:#a78bfa;">' + v + '</div></div>'
      ).join('');
    }

    function renderIntelligenceGroups() {
      const el = document.getElementById('intelligence-groups');
      if (!el) return;
      el.innerHTML = csState.groups.map(g =>
        '<div class="channel-card" style="padding:10px; margin-bottom:8px; border-color:' +
        (g.groupKey === csState.selectedGroupKey ? '#a78bfa' : '#2d2d4e') +
        '; cursor:pointer;" data-group-key="' + g.groupKey + '">' +
        '<div style="display:flex;justify-content:space-between;"><strong>' + g.displayName + '</strong><span style="color:#a78bfa;">' + (g.agentKey || '-') + '</span></div>' +
        '<div style="font-size:.72rem;color:#7c7ca8;">' + g.groupKey + ' · ' + (g.channelCount || 0) + ' channels</div>' +
        '<div style="font-size:.72rem;color:#b0b0c8;margin-top:3px;">' + (g.description || '') + '</div>' +
        '</div>'
      ).join('') || '<div style="color:#7c7ca8;font-size:.8rem;">Chưa có group.</div>';

      el.querySelectorAll('[data-group-key]').forEach(node => {
        node.addEventListener('click', () => {
          const g = csState.groups.find(x => x.groupKey === node.dataset.groupKey);
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
      const el = document.getElementById('intelligence-channels');
      if (!el) return;
      const q        = (document.getElementById('channel-filter')?.value || '').toLowerCase();
      const selected = csState.selectedGroupKey;
      const channels = csState.channels.filter(ch =>
        !q || [ch.name, ch.guildName, ch.channelId, ch.categoryName].filter(Boolean).join(' ').toLowerCase().includes(q)
      );
      el.innerHTML = channels.map(ch => {
        const checked    = selected && ch.groups.some(g => g.groupKey === selected);
        const groupTags  = ch.groups.map(g =>
          '<span style="background:#312e81;color:#c4b5fd;border-radius:4px;padding:1px 4px;margin-right:3px;font-size:.65rem;">' + g.agentKey + ':' + g.groupKey + '</span>'
        ).join('');
        return '<label style="display:block;background:#16213e;border:1px solid #2d2d4e;border-radius:8px;padding:8px;margin-bottom:6px;cursor:pointer;">' +
          '<div style="display:flex;gap:8px;align-items:flex-start;">' +
          '<input type="checkbox" class="grp-ch-cb" data-channel-id="' + ch.channelId + '" ' +
          (checked ? 'checked' : '') + ' ' + (selected ? '' : 'disabled') + ' />' +
          '<div style="flex:1;"><div><strong>#' + (ch.name || ch.channelId) + '</strong> <span style="color:#7c7ca8;font-size:.72rem;">' + (ch.guildName || '') + '</span></div>' +
          '<div style="color:#7c7ca8;font-size:.72rem;">' + ch.channelId + ' · ' + fmtNum(ch.messageCount) + ' msgs</div>' +
          '<div style="margin-top:2px;">' + groupTags + '</div></div>' +
          '</div></label>';
      }).join('') || '<div style="color:#7c7ca8;font-size:.8rem;">Không có channel indexed.</div>';

      el.querySelectorAll('.grp-ch-cb').forEach(cb => cb.addEventListener('change', saveGroupChannels));
    }

    async function loadIntelligence() {
      try {
        const [summary, groups, channels] = await Promise.all([
          fetch('/api/chat-storage/summary').then(r => r.json()),
          fetch('/api/chat-storage/groups').then(r => r.json()),
          fetch('/api/chat-storage/channels').then(r => r.json()),
        ]);
        csState.groups   = groups;
        csState.channels = channels;
        if (!csState.selectedGroupKey && groups[0]) csState.selectedGroupKey = groups[0].groupKey;
        renderIntelligenceSummary(summary);
        renderIntelligenceGroups();
        renderIntelligenceChannels();
      } catch (err) { showToast('Intelligence UI error: ' + err.message, 'error'); }
    }

    async function saveGroupChannels() {
      const groupKey = csState.selectedGroupKey;
      if (!groupKey) return;
      const channelIds = [...document.querySelectorAll('.grp-ch-cb:checked')].map(cb => cb.dataset.channelId);
      const res = await fetch('/api/chat-storage/groups/' + groupKey + '/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelIds }),
      });
      if (!res.ok) showToast('Failed to assign channels', 'error');
      await loadIntelligence();
    }

    document.getElementById('btn-refresh-intelligence')?.addEventListener('click', loadIntelligence);
    document.getElementById('channel-filter')?.addEventListener('input', renderIntelligenceChannels);

    document.getElementById('btn-save-group')?.addEventListener('click', async () => {
      const payload = {
        groupKey:    document.getElementById('group-key').value.trim(),
        displayName: document.getElementById('group-name').value.trim(),
        agentKey:    document.getElementById('group-agent').value,
        description: document.getElementById('group-desc').value,
      };
      if (!payload.groupKey) { showToast('group_key required', 'error'); return; }
      const res = await fetch('/api/chat-storage/groups', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      if (!res.ok) { showToast('Save group failed', 'error'); return; }
      csState.selectedGroupKey = payload.groupKey;
      showToast('Group saved', 'success');
      await loadIntelligence();
    });

    document.getElementById('btn-sync-agent-access')?.addEventListener('click', async () => {
      const res  = await fetch('/api/chat-storage/agent-access/sync', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) { showToast('Sync failed', 'error'); return; }
      showToast('Synced ' + data.upserted + ' access rows', 'success');
    });
```

- [ ] **Step 3: Build + Commit**

```bash
npm run build
git add tools/config-ui/server.ts
git commit -m "feat(config-ui): intelligence tab — chat storage admin, group CRUD, channel assign, sync"
```

---

## Task 7: Settings Tab

**Files:**
- Modify: `tools/config-ui/server.ts` — `renderSettingsTab()` và `renderClientJS()`

**Interfaces:**
- Env keys: `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `ERROR_CHANNEL_ID`, `CLIPROXY_API_URL`, `CLIPROXY_API_KEY`, `SESSION_HISTORY_LIMIT`, `SESSION_EXPIRE_MINUTES`, `CHANNEL_QUEUE_MAX_PENDING`

- [ ] **Step 1: Điền nội dung renderSettingsTab()**

```ts
function renderSettingsTab(): string {
  return `
  <div id="tab-settings" class="tab-panel">

    <!-- Discord -->
    <div class="section">
      <div class="section-title">Discord</div>

      <div class="field">
        <label for="DISCORD_TOKEN">Bot Token</label>
        <div class="field-input-wrap">
          <input type="password" id="DISCORD_TOKEN" name="DISCORD_TOKEN" class="has-toggle" autocomplete="off" />
          <button type="button" class="toggle-btn" data-target="DISCORD_TOKEN" title="Toggle">👁</button>
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
        <span class="tooltip-icon" data-tip="Bot gửi thông báo lỗi vào channel này.">ℹ️</span>
      </div>
      <div class="channel-name-hint" id="error-channel-name"></div>
    </div>

    <hr class="divider" />

    <!-- CLIProxy -->
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
          <button type="button" class="toggle-btn" data-target="CLIPROXY_API_KEY" title="Toggle">👁</button>
        </div>
      </div>
    </div>

    <hr class="divider" />

    <!-- Session -->
    <div class="section">
      <div class="section-title">Session</div>

      <div class="field">
        <label for="SESSION_HISTORY_LIMIT">History Limit</label>
        <div class="field-input-wrap">
          <input type="number" id="SESSION_HISTORY_LIMIT" name="SESSION_HISTORY_LIMIT" min="1" />
        </div>
      </div>
      <p class="field-hint">Số ảnh bot nhớ trong 1 session (dùng cho edit liên tiếp). Khuyến nghị: 3–10.</p>

      <div class="field">
        <label for="SESSION_EXPIRE_MINUTES">Expire (minutes)</label>
        <div class="field-input-wrap">
          <input type="number" id="SESSION_EXPIRE_MINUTES" name="SESSION_EXPIRE_MINUTES" min="1" />
        </div>
      </div>
      <p class="field-hint">Thời gian không hoạt động trước khi session tự xoá. Khuyến nghị: 30–120.</p>
    </div>

    <hr class="divider" />

    <!-- Queue -->
    <div class="section">
      <div class="section-title">Queue</div>

      <div class="field">
        <label for="CHANNEL_QUEUE_MAX_PENDING">Max Pending</label>
        <div class="field-input-wrap">
          <input type="number" id="CHANNEL_QUEUE_MAX_PENDING" name="CHANNEL_QUEUE_MAX_PENDING" min="1" />
        </div>
      </div>
      <p class="field-hint">Số request chờ tối đa mỗi channel. Vượt quá → bot từ chối. Khuyến nghị: 3–10.</p>
    </div>

    <div class="actions">
      <button type="button" class="btn btn-save" id="btn-save-settings">💾 Save Settings</button>
    </div>

  </div>
  `;
}
```

- [ ] **Step 2: Thêm Settings JS vào renderClientJS()**

```js
    // ── CLIProxy Test ──────────────────────────────────────────────────────────
    document.getElementById('btn-test-cliproxy')?.addEventListener('click', async () => {
      const btn    = document.getElementById('btn-test-cliproxy');
      const url    = document.getElementById('CLIPROXY_API_URL')?.value.trim();
      const apiKey = document.getElementById('CLIPROXY_API_KEY')?.value.trim();
      if (!url) { showToast('Nhập URL trước', 'error'); return; }
      btn.textContent = '...';
      btn.className   = 'btn-test';
      try {
        const res  = await fetch('/api/test/cliproxy', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url, apiKey }),
        });
        const data = await res.json();
        if (data.ok) {
          btn.textContent = \`✓ \${data.latencyMs}ms\`;
          btn.className   = 'btn-test ok';
        } else {
          btn.textContent = '✗ Fail';
          btn.className   = 'btn-test fail';
          showToast('CLIProxy: ' + data.error, 'error');
        }
      } catch (err) {
        btn.textContent = '✗ Fail';
        btn.className   = 'btn-test fail';
        showToast('Test failed: ' + err.message, 'error');
      }
      setTimeout(() => { btn.textContent = 'Test'; btn.className = 'btn-test'; }, 4000);
    });

    // Error channel name resolution
    document.getElementById('ERROR_CHANNEL_ID')?.addEventListener('blur', async () => {
      const id  = document.getElementById('ERROR_CHANNEL_ID').value.trim();
      const el  = document.getElementById('error-channel-name');
      if (!id) { el.textContent = ''; return; }
      await resolveChannelNames([id]);
      const name = channelNameCache[id];
      el.textContent   = name ? '#' + name : '(bot cannot access this channel)';
      el.style.color   = name ? '#a78bfa' : '#f87171';
    });

    // ── Settings Save ──────────────────────────────────────────────────────────
    document.getElementById('btn-save-settings')?.addEventListener('click', async () => {
      const keys = [
        'DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'ERROR_CHANNEL_ID',
        'CLIPROXY_API_URL', 'CLIPROXY_API_KEY',
        'SESSION_HISTORY_LIMIT', 'SESSION_EXPIRE_MINUTES',
        'CHANNEL_QUEUE_MAX_PENDING',
      ];
      const payload = {};
      keys.forEach(k => { const el = document.getElementById(k); if (el) payload[k] = el.value; });
      try {
        const res = await fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (!res.ok) throw new Error((await res.json()).error || 'Save failed');
        showToast('Settings saved!', 'success');
      } catch (err) { showToast('Error: ' + err.message, 'error'); }
    });
```

- [ ] **Step 3: Build + Commit**

```bash
npm run build
git add tools/config-ui/server.ts
git commit -m "feat(config-ui): settings tab — discord, cliproxy, session, queue, per-tab save"
```

---

## Task 8: Logs Tab

**Files:**
- Modify: `tools/config-ui/server.ts` — `renderLogsTab()` và `renderClientJS()`

**Interfaces:**
- Consumes: `/api/logs?file=<name>&lines=100`

- [ ] **Step 1: Điền nội dung renderLogsTab()**

```ts
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
          <button id="btn-refresh-logs" style="background:#2d2d4e; color:#b0b0c8; border:none; border-radius:4px; padding:5px 10px; font-size:0.78rem; cursor:pointer; font-weight:600;">↻ Refresh</button>
        </div>
      </div>
      <pre id="log-content"></pre>
    </div>
  </div>
  `;
}
```

- [ ] **Step 2: Thêm Log JS vào renderClientJS()**

```js
    // ── Log Viewer ─────────────────────────────────────────────────────────────
    async function loadLogs() {
      const file = document.getElementById('log-file-sel')?.value || 'bot';
      const pre  = document.getElementById('log-content');
      if (!pre) return;
      try {
        const res = await fetch(\`/api/logs?file=\${file}&lines=100\`);
        if (!res.ok) { pre.textContent = 'Không thể tải log.'; return; }
        const { content } = await res.json();
        pre.textContent = content || '(trống)';
        pre.scrollTop   = pre.scrollHeight;
      } catch (err) {
        pre.textContent = 'Lỗi: ' + err.message;
      }
    }
    document.getElementById('btn-refresh-logs')?.addEventListener('click', loadLogs);
    document.getElementById('log-file-sel')?.addEventListener('change', loadLogs);
```

- [ ] **Step 3: Build + Commit**

```bash
npm run build
git add tools/config-ui/server.ts
git commit -m "feat(config-ui): logs tab — file selector, viewer, refresh"
```

---

## Task 9: loadConfig() — populate tất cả tabs khi trang load

**Files:**
- Modify: `tools/config-ui/server.ts` — thêm vào `renderClientJS()`

**Interfaces:**
- Consumes: `/api/config`
- Produces: Tất cả input fields được pre-filled từ `.env` khi trang load

- [ ] **Step 1: Thêm loadConfig() và init sequence vào renderClientJS()**

Thêm vào CUỐI `<script>` trong `renderClientJS()`:

```js
    // ── loadConfig — pre-fill all tabs from .env ───────────────────────────────
    const ALL_KEYS = [
      'DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'ERROR_CHANNEL_ID',
      'IMAGE_CHANNEL_IDS', 'IMAGE_MODEL', 'IMAGE_SIZE', 'IMAGE_FALLBACK_MODEL', 'OPENAI_API_KEY',
      'CHAT_CHANNEL_IDS', 'CHAT_MODEL', 'CHAT_FALLBACK_MODEL',
      'UPSCALE_CHANNEL_IDS', 'UPSCAYL_BIN_PATH', 'UPSCAYL_MODELS_PATH', 'UPSCALE_SCALE', 'UPSCALE_MODEL',
      'CLIPROXY_API_URL', 'CLIPROXY_API_KEY',
      'SESSION_HISTORY_LIMIT', 'SESSION_EXPIRE_MINUTES',
      'CHANNEL_QUEUE_MAX_PENDING',
    ];

    async function loadConfig() {
      try {
        const res  = await fetch('/api/config');
        const data = await res.json();
        for (const key of ALL_KEYS) {
          const el = document.getElementById(key);
          if (el && data[key] !== undefined) el.value = data[key];
        }
      } catch (err) {
        showToast('Failed to load config: ' + err.message, 'error');
      }
    }

    // ── Init ───────────────────────────────────────────────────────────────────
    (async () => {
      await loadConfig();
      await loadImageChannels();
      await loadTextChannels();
      await loadUpscalerChannels();
      loadLogs();
      loadIntelligence();
    })();
```

- [ ] **Step 2: Build verify**

```bash
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add tools/config-ui/server.ts
git commit -m "feat(config-ui): loadConfig — pre-fill all tabs from env on page load; init sequence"
```

---

## Task 10: Final verification

**Files:**
- Verify: `tools/config-ui/server.ts` đầy đủ, không còn stub

- [ ] **Step 1: Build + Test**

```bash
cd /Users/tdgames_mac01/Work/apps/tdgames-discord
npm run build && npm test
```

Expected:
```
tsc → exit 0 (no errors)
Vitest → 14 files, 72 tests passed
```

- [ ] **Step 2: Checklist verification từ spec**

Tự kiểm tra từng item:
- [ ] 7 tab render không lỗi
- [ ] Tab switching không reload trang
- [ ] Save Image Gen chỉ ghi `IMAGE_CHANNEL_IDS`, `IMAGE_MODEL`, `IMAGE_SIZE`, `IMAGE_FALLBACK_MODEL`, `OPENAI_API_KEY`
- [ ] Save Text Chat chỉ ghi `CHAT_CHANNEL_IDS`, `CHAT_MODEL`, `CHAT_FALLBACK_MODEL`
- [ ] Save Upscaler chỉ ghi 5 upscaler keys
- [ ] Save Settings chỉ ghi 8 settings keys
- [ ] Bot status poll mỗi 10s vẫn hoạt động
- [ ] CLIProxy Test Connection hiện kết quả
- [ ] Intelligence: groups CRUD + channel assign + sync hoạt động
- [ ] Logs tab: load file + refresh hoạt động
- [ ] Restart Bot (Overview) không save env

- [ ] **Step 3: Commit cuối**

```bash
git add tools/config-ui/server.ts
git commit -m "feat(config-ui): 7-tab layout complete — image gen, text chat, upscaler, intelligence, settings, logs"
```

---

## Tóm tắt env key fixes

| Env key cũ (server.ts) | Env key mới (đúng config.ts) | Tab |
|---|---|---|
| `ALLOWED_CHANNEL_IDS` | `IMAGE_CHANNEL_IDS` | Image Gen |
| `TEXT_CHANNEL_IDS` | `CHAT_CHANNEL_IDS` | Text Chat |
| _(không có)_ | `IMAGE_FALLBACK_MODEL` | Image Gen |
| _(không có)_ | `CHAT_FALLBACK_MODEL` | Text Chat |
