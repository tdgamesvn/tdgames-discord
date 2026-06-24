# Design Spec — Feature Registry Architecture

_Ngày: 2026-06-24_
_Project: tdgames-discord_
_Trạng thái: Approved_

---

## 1. Tổng quan

Tái cấu trúc kiến trúc Discord bot từ dạng hardcode handler-per-type sang **Feature Registry Pattern** — mỗi feature (tạo ảnh, chat, video, upscale…) là một module độc lập, tự đăng ký vào router. Core bot không biết gì về các feature cụ thể.

**Mục tiêu:**
- Thêm feature mới = tạo 1 thư mục + 1 dòng register, không sờ vào code cũ
- Mỗi feature cô lập hoàn toàn: đọc/sửa feature nào chỉ cần xem thư mục đó
- `bot.ts` không bao giờ cần sửa khi thêm feature

**Routing cơ chế:** channel ID — mỗi feature được gán một tập channel IDs qua `.env`.

---

## 2. Cấu trúc thư mục

```
src/
├── core/
│   ├── types.ts          # Feature interface, FeatureContext
│   ├── router.ts         # FeatureRouter: channelId → Feature lookup
│   └── queue.ts          # QueueManager (move từ services/)
│
├── features/             # Mỗi feature = 1 thư mục khép kín
│   ├── image-gen/
│   │   ├── index.ts      # createImageGenFeature() → Feature
│   │   ├── handler.ts    # xử lý message
│   │   └── client.ts     # CLIProxy/OpenAI API wrapper
│   ├── text-chat/
│   │   ├── index.ts      # createTextChatFeature() → Feature
│   │   ├── handler.ts
│   │   └── client.ts
│   └── video-gen/        # Ví dụ feature tương lai
│       └── index.ts      # createVideoGenFeature() → Feature
│
├── shared/               # Services dùng chung giữa nhiều features
│   ├── sessionStore.ts
│   ├── channelPromptStore.ts
│   ├── errorReporter.ts
│   └── statsStore.ts
│
├── db/
│   └── schema.ts
├── config.ts
├── bot.ts                # Thin: Discord events → router dispatch
└── index.ts              # Bootstrap: register features + start bot
```

---

## 3. Core Types (`src/core/types.ts`)

```typescript
import type { Message } from 'discord.js';
import type Database from 'better-sqlite3';
import type { Config } from '../config';
import type { ErrorReporter } from '../shared/errorReporter';
import type { StatsStore } from '../shared/statsStore';

// Infrastructure context được inject vào mọi feature handler
export interface FeatureContext {
  db: Database.Database;
  config: Config;
  errorReporter: ErrorReporter;
  statsStore: StatsStore;
  sessionStore: SessionStore;         // Shared, tạo 1 lần trong index.ts
  channelPromptStore: ChannelPromptStore; // Shared, tạo 1 lần trong index.ts
}

// Contract mỗi feature phải implement
export interface Feature {
  id: string;              // 'image-gen', 'text-chat', 'video-gen'...
  channelIds: Set<string>; // Channels feature này quản lý
  handler: (message: Message, ctx: FeatureContext) => Promise<void>;
}
```

`FeatureContext` gói gọn phần infrastructure chung (db, config, error reporting, stats). Business logic (API clients, session stores) nằm bên trong từng feature — không lộ ra ngoài.

---

## 4. FeatureRouter (`src/core/router.ts`)

```typescript
import type { Feature } from './types';

export class FeatureRouter {
  private channelMap = new Map<string, Feature>(); // channelId → Feature

  register(feature: Feature): void {
    for (const channelId of feature.channelIds) {
      if (this.channelMap.has(channelId)) {
        const existing = this.channelMap.get(channelId)!;
        console.warn(
          `[router] Channel ${channelId} already registered to "${existing.id}", ` +
          `overwriting with "${feature.id}"`
        );
      }
      this.channelMap.set(channelId, feature);
    }
    console.log(
      `[router] Feature "${feature.id}" registered ` +
      `(${feature.channelIds.size} channel(s))`
    );
  }

  resolve(channelId: string): Feature | undefined {
    return this.channelMap.get(channelId);
  }

  get registeredChannelIds(): Set<string> {
    return new Set(this.channelMap.keys());
  }
}
```

---

## 5. bot.ts — thin, không bao giờ sửa

```typescript
import type { Message } from 'discord.js';
import type { FeatureRouter } from './core/router';
import type { QueueManager } from './core/queue';
import type { FeatureContext } from './core/types';

const MAX_SEEN_IDS = 500;
const seenMessageIds = new Set<string>();

function isDuplicate(id: string): boolean {
  if (seenMessageIds.has(id)) return true;
  seenMessageIds.add(id);
  if (seenMessageIds.size > MAX_SEEN_IDS) {
    const [oldest] = seenMessageIds;
    seenMessageIds.delete(oldest);
  }
  return false;
}

export function createMessageHandler(
  router: FeatureRouter,
  queueManager: QueueManager,
  ctx: FeatureContext,
) {
  return async (message: Message): Promise<void> => {
    if (message.author.bot) return;
    if (isDuplicate(message.id)) return;

    const feature = router.resolve(message.channelId);
    if (!feature) return; // Channel không có feature → ignore hoàn toàn

    const enqueued = queueManager.enqueue(
      message.channelId,
      () => feature.handler(message, ctx),
    );

    if (!enqueued) {
      await message.reply('⏳ Channel đang bận, vui lòng thử lại sau ít phút.');
    }
  };
}
```

So với hiện tại, `bot.ts` không còn hardcode:
```typescript
// ❌ Hiện tại — phải sửa mỗi khi thêm feature
const isTextChannel = deps.textChannelIds.has(message.channelId);
const handler = isTextChannel ? handleTextChat : handleImageMessage;
```

---

## 6. Feature Module Pattern

Mỗi feature có cấu trúc giống nhau:

**`src/features/<name>/index.ts`** — factory function, export Feature:
```typescript
// Ví dụ: image-gen/index.ts
export function createImageGenFeature(config: Config, db: Database.Database): Feature {
  const client = new ImageClient(/* config.imageGen.* */);
  return {
    id: 'image-gen',
    channelIds: config.imageGen.channelIds,
    handler: createImageGenHandler(client, db),
  };
}
```

**`src/features/<name>/handler.ts`** — message handling logic (giữ nguyên từ handlers/ hiện tại)

**`src/features/<name>/client.ts`** — API client (giữ nguyên từ services/ hiện tại)

---

## 7. index.ts — register features

```typescript
const router = new FeatureRouter();
router.register(createImageGenFeature(config, db));
router.register(createTextChatFeature(config, db));
// router.register(createVideoGenFeature(config, db)); // uncomment khi ready

const client = new Client({ /* intents */ });
client.on('messageCreate', createMessageHandler(router, queueManager, ctx));
```

**Thêm feature mới:**
1. Tạo `src/features/<name>/` với `index.ts`, `handler.ts`, `client.ts`
2. Thêm 1 dòng `router.register(...)` trong `index.ts`
3. Thêm env vars trong `.env` và `config.ts`

---

## 8. Config Structure

### `.env` — phân nhóm theo feature

```env
# ─── Discord Core ──────────────────────────────────────────
DISCORD_TOKEN=
DISCORD_CLIENT_ID=
ERROR_CHANNEL_ID=

# ─── Shared Infrastructure ─────────────────────────────────
CLIPROXY_API_URL=http://localhost:8317
CLIPROXY_API_KEY=
CLIPROXY_MAX_CONCURRENT=3
OPENAI_API_KEY=
OPENAI_API_URL=https://api.openai.com/v1

# ─── Session & Queue ───────────────────────────────────────
SESSION_HISTORY_LIMIT=10
SESSION_EXPIRE_MINUTES=30
CHANNEL_QUEUE_MAX_PENDING=5

# ─── Feature: Image Generation ─────────────────────────────
IMAGE_CHANNEL_IDS=111,222
IMAGE_MODEL=gpt-image-1
IMAGE_SIZE=1024x1024

# ─── Feature: Text Chat ────────────────────────────────────
CHAT_CHANNEL_IDS=333,444
CHAT_MODEL=gpt-4o
CHAT_FALLBACK_MODEL=gpt-4o-mini

# ─── Feature: Video Gen (future — uncomment khi dùng) ──────
# VIDEO_CHANNEL_IDS=555
# VIDEO_MODEL=wan-2.1
```

**Thay đổi từ `.env` hiện tại:**
- `ALLOWED_CHANNEL_IDS` → bỏ (router tự tổng hợp từ tất cả feature channel IDs)
- `TEXT_CHANNEL_IDS` → đổi tên thành `CHAT_CHANNEL_IDS`

### `config.ts` — interface tương ứng

```typescript
export interface Config {
  discord: { token: string; clientId: string; errorChannelId: string | null };
  cliproxy: { apiUrl: string; apiKey: string; maxConcurrent: number };
  openai: { apiKey: string | null; apiUrl: string };
  session: { historyLimit: number; expireMinutes: number };
  queue: { maxPending: number };

  // Mỗi feature có section riêng
  imageGen: { channelIds: Set<string>; model: string; size: string };
  textChat: { channelIds: Set<string>; model: string; fallbackModel: string };
  // videoGen: { channelIds: Set<string>; model: string }; // thêm khi ready
}
```

---

## 9. Migration Map

Logic bên trong các file **giữ nguyên hoàn toàn** — chỉ move + adjust import paths.

| Hiện tại | Sau migration |
|----------|--------------|
| `src/handlers/imageHandler.ts` | `src/features/image-gen/handler.ts` |
| `src/services/imageClient.ts` | `src/features/image-gen/client.ts` |
| `src/handlers/textChatHandler.ts` | `src/features/text-chat/handler.ts` |
| `src/services/chatClient.ts` | `src/features/text-chat/client.ts` |
| `src/services/queueManager.ts` | `src/core/queue.ts` |
| `src/services/sessionStore.ts` | `src/shared/sessionStore.ts` |
| `src/services/channelPromptStore.ts` | `src/shared/channelPromptStore.ts` |
| `src/services/errorReporter.ts` | `src/shared/errorReporter.ts` |
| `src/services/statsStore.ts` | `src/shared/statsStore.ts` |
| `src/bot.ts` | `src/bot.ts` (slim lại, dùng router) |
| `src/index.ts` | `src/index.ts` (register features) |

---

## 10. Quy tắc khi thêm feature mới

1. **Tạo thư mục** `src/features/<feature-name>/`
2. **Tạo 3 files:** `index.ts` (factory), `handler.ts` (logic), `client.ts` (API)
3. **Thêm config section** trong `config.ts` + env vars trong `.env` / `.env.example`
4. **Register** trong `src/index.ts`: `router.register(createXxxFeature(config, db))`
5. **Không sờ vào** `bot.ts`, `core/router.ts`, hay bất kỳ feature nào khác

---

## 11. Không thay đổi

- Logic xử lý ảnh, chat — giữ nguyên hoàn toàn
- SQLite schema
- Single-instance guard trong `index.ts`
- Graceful shutdown
- Config UI (Express server) — không nằm trong scope migration này
- Tests — chỉ cần update import paths
