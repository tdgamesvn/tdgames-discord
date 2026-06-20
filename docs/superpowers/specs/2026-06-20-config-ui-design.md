# Config UI — Design Spec

_Date: 2026-06-20_

---

## Overview

A standalone Express web server (`tools/config-ui/server.ts`) that serves a single-page UI for reading and writing the bot's `.env` file. Accessible via Tailscale at `http://<tailscale-ip>:3456`. No password — Tailscale network access is sufficient.

---

## Architecture

```
tdgames-discord/
├── tools/
│   └── config-ui/
│       └── server.ts     ← single-file Express server (~250 lines)
├── .env                  ← read/written by the UI
├── .env.example          ← used as template for regenerating .env
└── package.json          ← add "config-ui" script
```

Started with: `npm run config-ui`
Port: `3456` (configurable via `CONFIG_UI_PORT` env var)
Bind: `0.0.0.0` (so Tailscale can reach it)

---

## API Routes

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/` | Serve HTML page |
| GET | `/api/config` | Read `.env` → return `{ KEY: value, ... }` JSON |
| POST | `/api/config` | Accept `{ KEY: value, ... }` → write `.env` |
| POST | `/api/restart` | Write `.env` then kill+respawn bot process |

---

## UI Layout

Single dark-themed HTML page (inline in server.ts, no build step).

```
┌─────────────────────────────────────────────────────┐
│  🎮 TDGames Discord Bot — Config                    │
├─────────────────────────────────────────────────────┤
│  ▌ DISCORD                                          │
│  Bot Token        [••••••••••••••••••] 👁           │
│  Client ID        [                  ]              │
│  Allowed Channels [123456,789012     ] ℹ️           │
│                                                     │
│  ▌ CLIPROXY API                                     │
│  API URL          [http://localhost:8317]            │
│  API Key          [••••••••••••••••••] 👁           │
│                                                     │
│  ▌ IMAGE                                            │
│  Model            [gpt-image-1       ]              │
│  Size             [1024x1024         ]              │
│                                                     │
│  ▌ SESSION                                          │
│  History Limit    [10                ]              │
│  Expire (minutes) [30                ]              │
│                                                     │
│  ▌ QUEUE                                            │
│  Max Pending      [5                 ]              │
├─────────────────────────────────────────────────────┤
│  [💾 Save Config]        [🔄 Save & Restart Bot]    │
└─────────────────────────────────────────────────────┘
     ↳ toast notification: ✅ success | ❌ error
```

- `DISCORD_TOKEN` and `CLIPROXY_API_KEY` → `<input type="password">` with 👁 toggle
- `ALLOWED_CHANNEL_IDS` → text input + tooltip "comma-separated, no spaces"
- Numeric fields → `<input type="number">`
- Toast appears bottom-right, auto-dismisses after 3s

---

## .env Read/Write

**Read (`GET /api/config`):**
- Parse `.env` line by line
- Skip blank lines and `#` comments
- Split on first `=` → `{ KEY: "value" }`
- If `.env` missing → return `{}` (form shows empty/placeholder values)

**Write (`POST /api/config`):**
- Regenerate `.env` using `.env.example` as structure template
- Preserve section comments (lines starting with `#`) from `.env.example`
- Replace values with submitted form data
- Keys in form but not in `.env.example` are appended at end
- Atomic: write to `.env.tmp` first, then rename

---

## Restart Logic (`POST /api/restart`)

1. Call `writeEnv()` first
2. Read `data/bot.pid` → send `SIGTERM` to old process (ignore if file missing)
3. Spawn: `child_process.spawn('npm', ['run', 'dev'], { detached: true, cwd: projectRoot, stdio: 'ignore' })`
4. Write new PID to `data/bot.pid`
5. Return `{ ok: true, message: "Bot restarted" }`

Bot (`src/index.ts`) writes its PID on startup: `fs.writeFileSync('data/bot.pid', String(process.pid))`

---

## Error Handling

| Scenario | Behaviour |
|----------|-----------|
| `.env` missing on read | Return `{}` — form shows empty fields |
| Write permission denied | HTTP 500 + toast "Lỗi ghi file .env" |
| Restart: no PID file | Skip kill, spawn new process anyway |
| Restart: spawn fails | HTTP 500 + toast "Restart thất bại — chạy `npm run dev` thủ công" |

---

## Dependencies

- `express` — add to `dependencies`
- `@types/express` — add to `devDependencies`
- Runner: `tsx` (already in devDependencies) — no extra install needed

Script to add to `package.json`:
```json
"config-ui": "tsx tools/config-ui/server.ts"
```

Bot restart command (from `POST /api/restart`):
```
npm run dev   →   tsx watch src/index.ts
```

---

## Out of Scope

- Authentication (Tailscale provides network-level security)
- Logs viewer
- Bot status monitoring
- Multiple `.env` profiles
