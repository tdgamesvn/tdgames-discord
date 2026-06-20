import express, { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

// ── Paths ────────────────────────────────────────────────────────────────────

const projectRoot = path.resolve(__dirname, '../../');
const envPath = path.join(projectRoot, '.env');
const envExamplePath = path.join(projectRoot, '.env.example');
const pidPath = path.join(projectRoot, 'data', 'bot.pid');

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
  </style>
</head>
<body>
  <div class="container">
    <div class="header">🎮 TDGames Discord Bot — Config</div>

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

        <div class="field">
          <label for="ALLOWED_CHANNEL_IDS">Allowed Channels</label>
          <div class="field-input-wrap">
            <input type="text" id="ALLOWED_CHANNEL_IDS" name="ALLOWED_CHANNEL_IDS" placeholder="123456,789012" autocomplete="off" />
          </div>
          <span class="tooltip-icon" data-tip="comma-separated channel IDs, no spaces">ℹ️</span>
        </div>
      </div>

      <!-- CLIPROXY -->
      <div class="section">
        <div class="section-title">CLIProxy API</div>

        <div class="field">
          <label for="CLIPROXY_API_URL">API URL</label>
          <div class="field-input-wrap">
            <input type="text" id="CLIPROXY_API_URL" name="CLIPROXY_API_URL" placeholder="http://localhost:8317" autocomplete="off" />
          </div>
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

        <div class="field">
          <label for="IMAGE_SIZE">Size</label>
          <div class="field-input-wrap">
            <input type="text" id="IMAGE_SIZE" name="IMAGE_SIZE" placeholder="1024x1024" autocomplete="off" />
          </div>
        </div>
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

        <div class="field">
          <label for="SESSION_EXPIRE_MINUTES">Expire (minutes)</label>
          <div class="field-input-wrap">
            <input type="number" id="SESSION_EXPIRE_MINUTES" name="SESSION_EXPIRE_MINUTES" min="1" />
          </div>
        </div>
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
      </div>

      <hr class="divider" />

      <div class="actions">
        <button type="button" class="btn btn-save" id="btn-save">💾 Save Config</button>
        <button type="button" class="btn btn-restart" id="btn-restart">🔄 Save &amp; Restart Bot</button>
      </div>

    </form>
  </div>

  <div id="toast"></div>

  <script>
    const KEYS = [
      'DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'ALLOWED_CHANNEL_IDS',
      'CLIPROXY_API_URL', 'CLIPROXY_API_KEY',
      'IMAGE_MODEL', 'IMAGE_SIZE',
      'SESSION_HISTORY_LIMIT', 'SESSION_EXPIRE_MINUTES',
      'CHANNEL_QUEUE_MAX_PENDING',
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

    // ── Save & Restart ─────────────────────────────────────────────────────
    document.getElementById('btn-restart').addEventListener('click', async () => {
      try {
        const res = await fetch('/api/restart', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(collectFormData()),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Restart failed');
        showToast('Bot restarted!', 'success');
      } catch (err) {
        showToast('Error: ' + err.message, 'error');
      }
    });

    loadConfig();
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

// ── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Config UI running at http://0.0.0.0:${PORT}`);
});
