# tdgames-discord

Discord Bot cho TDGames Studio.

## Tech Stack

- Runtime: Node.js (tsx dev / node dist prod)
- Framework: discord.js v14
- Language: TypeScript 5.3
- Database: SQLite (better-sqlite3)
- Test: Vitest
- Queue: p-queue (per-channel)

## Cấu trúc project

```
src/
├── index.ts / bot.ts / config.ts
├── core/          # router, queue, types
├── db/            # schema.ts (SQLite init)
├── features/      # image-gen, text-chat, upscaler, chat-storage
├── shared/        # session, error-reporter
└── backfill-discord-history.ts

tools/config-ui/   # Express UI port 3456
tests/             # Vitest — 14 files / 72 tests
deploy/            # launchd plists
```

## Lệnh thường dùng

```bash
# Dev
npm run dev

# Build
npm run build

# Test
npm test

# Config UI
npm run config-ui

# Backfill Discord history
npm run backfill:discord

# Deploy (launchd — macOS local)
# See deploy/README.md
```

## Conventions

- Feature Registry pattern: mỗi feature tự đăng ký vào `core/router`
- TDD: viết test RED trước, sau đó implement
- Build phải sạch trước khi commit: `npm run build && npm test`
- Update `.agent/meta/TASKS.md` và `.agent/meta/LOG.md` sau mỗi session

## Notes

- Target scale: 5–10 concurrent users
- Bot chạy trên Mac local qua launchd (không VPS riêng)
- Config UI: `http://localhost:3456` — chỉ access qua Tailscale
- Đọc `.agent/meta/PROJECT.md` để nắm context đầy đủ
- Đọc `.agent/meta/TASKS.md` trước khi bắt đầu bất kỳ task nào
- Cập nhật `.agent/meta/TASKS.md` và `.agent/meta/LOG.md` sau mỗi session
