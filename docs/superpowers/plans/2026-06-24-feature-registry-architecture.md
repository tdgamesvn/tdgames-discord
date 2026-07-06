# Feature Registry Architecture — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor bot từ hardcoded handler-per-type sang Feature Registry Pattern — mỗi feature là module độc lập, tự đăng ký vào router, `bot.ts` không bao giờ cần sửa khi thêm feature mới.

**Architecture:** Channel ID routing — `FeatureRouter` ánh xạ channelId → Feature. Mỗi feature có factory function riêng. `bot.ts` chỉ dispatch, không biết feature cụ thể.

**Tech Stack:** TypeScript, discord.js v14, better-sqlite3, vitest, tsx

## Global Constraints

- TypeScript strict mode, không dùng `any` trừ khi test mock
- Toàn bộ business logic giữ nguyên — chỉ move file + đổi import path + đổi handler signature
- Không xóa file cũ cho đến khi task tương ứng hoàn thành và test pass
- Run `npm test` sau mỗi task — phải green trước khi commit
- Vitest dùng `tests/` directory (flat, không nested namespace)

---

## File Map

| Từ | Sang | Loại |
|----|------|------|
| _(new)_ | `src/core/types.ts` | Tạo mới |
| _(new)_ | `src/core/router.ts` | Tạo mới |
| `src/services/queueManager.ts` | `src/core/queue.ts` | Move |
| `src/services/sessionStore.ts` | `src/shared/sessionStore.ts` | Move |
| `src/services/channelPromptStore.ts` | `src/shared/channelPromptStore.ts` | Move |
| `src/services/errorReporter.ts` | `src/shared/errorReporter.ts` | Move |
| `src/services/statsStore.ts` | `src/shared/statsStore.ts` | Move |
| `src/services/imageClient.ts` | `src/features/image-gen/client.ts` | Move |
| `src/handlers/imageHandler.ts` | `src/features/image-gen/handler.ts` | Move + wrap |
| _(new)_ | `src/features/image-gen/index.ts` | Tạo mới |
| `src/services/chatClient.ts` | `src/features/text-chat/client.ts` | Move |
| `src/handlers/textChatHandler.ts` | `src/features/text-chat/handler.ts` | Move + wrap |
| _(new)_ | `src/features/text-chat/index.ts` | Tạo mới |
| `src/config.ts` | `src/config.ts` | Rewrite interface |
| `src/bot.ts` | `src/bot.ts` | Rewrite slim |
| `src/index.ts` | `src/index.ts` | Rewrite register |

---

## Task 1: Core types và FeatureRouter

**Files:**
- Create: `src/core/types.ts`
- Create: `src/core/router.ts`
- Create: `tests/router.test.ts`

**Interfaces:**
- Produces: `Feature`, `FeatureContext` (dùng trong Tasks 4, 5, 7)
- Produces: `FeatureRouter` với `.register()`, `.resolve()`, `.registeredChannelIds` (dùng trong Tasks 7, 8)

- [ ] **Step 1: Tạo `src/core/types.ts`**

```typescript
import type { Message } from 'discord.js';
import type Database from 'better-sqlite3';
import type { Config } from '../config';
import type { ErrorReporter } from '../shared/errorReporter';
import type { StatsStore } from '../shared/statsStore';
import type { SessionStore } from '../shared/sessionStore';
import type { ChannelPromptStore } from '../shared/channelPromptStore';

export interface FeatureContext {
  db: Database.Database;
  config: Config;
  errorReporter: ErrorReporter;
  statsStore: StatsStore;
  sessionStore: SessionStore;
  channelPromptStore: ChannelPromptStore;
}

export interface Feature {
  id: string;
  channelIds: Set<string>;
  handler: (message: Message, ctx: FeatureContext) => Promise<void>;
}
```

> **Note:** Import types từ `../shared/` — những file đó sẽ được tạo ở Task 3. TypeScript chỉ cần type để check, không cần runtime value, nên order không quan trọng.

- [ ] **Step 2: Tạo `src/core/router.ts`**

```typescript
import type { Feature } from './types';

export class FeatureRouter {
  private channelMap = new Map<string, Feature>();

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

- [ ] **Step 3: Viết failing tests**

```typescript
// tests/router.test.ts
import { describe, it, expect, vi } from 'vitest';
import { FeatureRouter } from '../src/core/router';
import type { Feature } from '../src/core/types';

function makeFeature(id: string, channelIds: string[]): Feature {
  return {
    id,
    channelIds: new Set(channelIds),
    handler: vi.fn().mockResolvedValue(undefined),
  };
}

describe('FeatureRouter', () => {
  it('resolves a registered channel to its feature', () => {
    const router = new FeatureRouter();
    const feat = makeFeature('image-gen', ['chan-1', 'chan-2']);
    router.register(feat);
    expect(router.resolve('chan-1')).toBe(feat);
    expect(router.resolve('chan-2')).toBe(feat);
  });

  it('returns undefined for unregistered channel', () => {
    const router = new FeatureRouter();
    expect(router.resolve('unknown')).toBeUndefined();
  });

  it('registeredChannelIds returns all registered channels', () => {
    const router = new FeatureRouter();
    router.register(makeFeature('a', ['c1', 'c2']));
    router.register(makeFeature('b', ['c3']));
    const ids = router.registeredChannelIds;
    expect(ids.has('c1')).toBe(true);
    expect(ids.has('c2')).toBe(true);
    expect(ids.has('c3')).toBe(true);
    expect(ids.size).toBe(3);
  });

  it('overwrites with warning when channel already registered', () => {
    const router = new FeatureRouter();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const feat1 = makeFeature('a', ['c1']);
    const feat2 = makeFeature('b', ['c1']);
    router.register(feat1);
    router.register(feat2);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('already registered'));
    expect(router.resolve('c1')).toBe(feat2);
    warnSpy.mockRestore();
  });
});
```

- [ ] **Step 4: Chạy test để verify fail**

```bash
cd /Users/tdgames_mac01/Work/apps/tdgames-discord && npm test -- --reporter=verbose 2>&1 | grep -E "(PASS|FAIL|Error)"
```

Expected: test file mới chạy, PASS (types và router đã được tạo ở step 1-2).

- [ ] **Step 5: Chạy toàn bộ test suite**

```bash
npm test
```

Expected: toàn bộ tests cũ vẫn PASS (không sửa file nào cũ).

- [ ] **Step 6: Commit**

```bash
git add src/core/types.ts src/core/router.ts tests/router.test.ts
git commit -m "feat: add core Feature interface and FeatureRouter"
```

---

## Task 2: Move QueueManager → `src/core/queue.ts`

**Files:**
- Create: `src/core/queue.ts` (copy từ `src/services/queueManager.ts`, cập nhật export name)
- Modify: `tests/queueManager.test.ts` — update import path
- Delete: `src/services/queueManager.ts` (sau khi tests pass)

**Interfaces:**
- Consumes: nothing new
- Produces: `QueueManager` tại path `src/core/queue.ts` (dùng trong Task 7, 8)

- [ ] **Step 1: Copy file với internal path update**

Tạo `src/core/queue.ts` — nội dung GIỐNG HỆT `src/services/queueManager.ts`. Không thay đổi logic, chỉ tạo ở path mới. File hiện tại không import gì từ `services/` nên không cần sửa gì bên trong.

```bash
cp src/services/queueManager.ts src/core/queue.ts
```

- [ ] **Step 2: Cập nhật import trong test**

Trong `tests/queueManager.test.ts`, tìm dòng:
```typescript
import { QueueManager } from '../src/services/queueManager';
```
Đổi thành:
```typescript
import { QueueManager } from '../src/core/queue';
```

- [ ] **Step 3: Chạy tests**

```bash
npm test
```

Expected: tất cả PASS.

- [ ] **Step 4: Xóa file cũ**

```bash
rm src/services/queueManager.ts
```

- [ ] **Step 5: Chạy tests lại để confirm**

```bash
npm test
```

Expected: tất cả PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/queue.ts tests/queueManager.test.ts
git rm src/services/queueManager.ts
git commit -m "refactor: move QueueManager to src/core/queue.ts"
```

---

## Task 3: Move shared services → `src/shared/`

**Files:**
- Create: `src/shared/sessionStore.ts` (move từ `src/services/sessionStore.ts`)
- Create: `src/shared/channelPromptStore.ts` (move từ `src/services/channelPromptStore.ts`)
- Create: `src/shared/errorReporter.ts` (move từ `src/services/errorReporter.ts`)
- Create: `src/shared/statsStore.ts` (move từ `src/services/statsStore.ts`)
- Modify: `tests/sessionStore.test.ts` — update import path
- Delete: `src/services/sessionStore.ts`, `src/services/channelPromptStore.ts`, `src/services/errorReporter.ts`, `src/services/statsStore.ts`

**Interfaces:**
- Produces: `SessionStore`, `ChannelPromptStore`, `ErrorReporter`, `StatsStore` tại `src/shared/` (dùng trong Tasks 1 types, 4, 5, 7, 8)

- [ ] **Step 1: Copy 4 files**

```bash
cp src/services/sessionStore.ts src/shared/sessionStore.ts
cp src/services/channelPromptStore.ts src/shared/channelPromptStore.ts
cp src/services/errorReporter.ts src/shared/errorReporter.ts
cp src/services/statsStore.ts src/shared/statsStore.ts
```

Kiểm tra nội dung: các file này không import lẫn nhau và không import từ `services/` nên không cần chỉnh sửa nội dung.

> Nếu `channelPromptStore.ts` hoặc `errorReporter.ts` có import từ `./sessionStore` hay file khác trong `services/`, cập nhật path thành `../shared/<file>` tương ứng.

- [ ] **Step 2: Cập nhật import trong `tests/sessionStore.test.ts`**

Tìm và thay toàn bộ `'../src/services/sessionStore'` thành `'../src/shared/sessionStore'`:

```typescript
// Trước:
import { SessionStore } from '../src/services/sessionStore';
// Sau:
import { SessionStore } from '../src/shared/sessionStore';
```

- [ ] **Step 3: Chạy tests**

```bash
npm test
```

Expected: PASS. (File cũ vẫn còn, nên các test khác không bị broken)

- [ ] **Step 4: Xóa file cũ**

```bash
rm src/services/sessionStore.ts src/services/channelPromptStore.ts src/services/errorReporter.ts src/services/statsStore.ts
```

- [ ] **Step 5: Chạy tests lại**

```bash
npm test
```

Expected: PASS. Nếu có test nào import từ `src/services/` cho 4 file này, fix import path tương tự.

- [ ] **Step 6: Commit**

```bash
git add src/shared/
git add tests/sessionStore.test.ts
git rm src/services/sessionStore.ts src/services/channelPromptStore.ts src/services/errorReporter.ts src/services/statsStore.ts
git commit -m "refactor: move shared services to src/shared/"
```

---

## Task 4: Feature image-gen

**Files:**
- Create: `src/features/image-gen/client.ts` (copy từ `src/services/imageClient.ts`)
- Create: `src/features/image-gen/handler.ts` (move từ `src/handlers/imageHandler.ts`, đổi export sang factory)
- Create: `src/features/image-gen/index.ts` (factory mới)
- Modify: `tests/imageHandler.test.ts` — new import path + new calling convention
- Modify: `tests/imageClient.test.ts` — update import path
- Delete: `src/services/imageClient.ts`, `src/handlers/imageHandler.ts`

**Interfaces:**
- Consumes: `Feature`, `FeatureContext` từ `src/core/types.ts` (Task 1)
- Consumes: `SessionStore`, `ChannelPromptStore`, `ErrorReporter`, `StatsStore` từ `src/shared/` (Task 3)
- Consumes: `Config` từ `src/config.ts` — dùng `config.imageGen.model`, `config.imageGen.size`
- Produces: `createImageGenFeature(config, db): Feature` tại `src/features/image-gen/index.ts` (dùng trong Task 8)

- [ ] **Step 1: Copy imageClient**

```bash
cp src/services/imageClient.ts src/features/image-gen/client.ts
```

Nội dung không thay đổi, không có import từ `services/`.

- [ ] **Step 2: Tạo `src/features/image-gen/handler.ts`**

Copy toàn bộ nội dung từ `src/handlers/imageHandler.ts` vào `src/features/image-gen/handler.ts`, sau đó thực hiện các thay đổi sau:

**Cập nhật imports (đầu file):**

```typescript
// Trước:
import type { ImageClient } from '../services/imageClient';
import type { SessionStore, HistoryEntry } from '../services/sessionStore';
import type { ChannelPromptStore } from '../services/channelPromptStore';
import type { ErrorReporter } from '../services/errorReporter';
import type { StatsStore } from '../services/statsStore';

// Sau:
import type { ImageClient } from './client';
import type { HistoryEntry } from '../../shared/sessionStore';
import type { FeatureContext } from '../../core/types';
```

**Xóa `ImageHandlerDeps` interface** — không còn dùng.

**Đổi exported function** — thay toàn bộ:

```typescript
// Trước:
export async function handleImageMessage(
  message: Message,
  deps: ImageHandlerDeps
): Promise<void> {
  const { imageClient, sessionStore, channelPromptStore, imageModel, imageSize, errorReporter, statsStore } = deps;
```

**Sau — bọc trong factory:**

```typescript
export function createImageGenHandler(
  imageClient: ImageClient,
): (message: Message, ctx: FeatureContext) => Promise<void> {
  return async (message, ctx) => {
    const { sessionStore, channelPromptStore, errorReporter, statsStore, config } = ctx;
    const imageModel = config.imageGen.model;
    const imageSize = config.imageGen.size;
    // === PHẦN CÒN LẠI: copy nguyên xi từ handleImageMessage body ===
    // Toàn bộ logic từ "const userId = message.author.id;" đến hết function
    // KHÔNG thay đổi gì thêm
```

> Đóng ngoặc `};` (return) và `}` (factory) ở cuối file.

- [ ] **Step 3: Tạo `src/features/image-gen/index.ts`**

```typescript
import type Database from 'better-sqlite3';
import type { Config } from '../../config';
import type { Feature } from '../../core/types';
import { ImageClient } from './client';
import { createImageGenHandler } from './handler';

export function createImageGenFeature(config: Config, db: Database.Database): Feature {
  const client = new ImageClient(
    config.cliproxy.apiUrl,
    config.cliproxy.apiKey,
    config.openai.apiKey ?? undefined,
    config.openai.apiUrl,
    config.cliproxy.maxConcurrent,
  );
  return {
    id: 'image-gen',
    channelIds: config.imageGen.channelIds,
    handler: createImageGenHandler(client),
  };
}
```

> **Note:** `config.imageGen` sẽ có sau Task 6. Nếu chạy test trước Task 6, TypeScript sẽ báo lỗi type — đây là bình thường, fix ở Task 6.

- [ ] **Step 4: Cập nhật `tests/imageClient.test.ts`**

Tìm:
```typescript
import { ImageClient } from '../src/services/imageClient';
```
Đổi thành:
```typescript
import { ImageClient } from '../src/features/image-gen/client';
```

- [ ] **Step 5: Rewrite `tests/imageHandler.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('discord.js', () => ({
  AttachmentBuilder: vi.fn().mockImplementation((buffer: Buffer, opts: object) => ({
    _buffer: buffer,
    _opts: opts,
  })),
}));

import { createImageGenHandler } from '../src/features/image-gen/handler';
import type { ImageClient } from '../src/features/image-gen/client';
import type { FeatureContext } from '../src/core/types';

// ─── Helpers ────────────────────────────────────────────────────────────────

function stubFetchImage() {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    arrayBuffer: async () => Buffer.from('fake-downloaded-img').buffer,
  }));
}

function makeClient(): ImageClient {
  return {
    generate: vi.fn().mockResolvedValue({ buffer: Buffer.from('fake-img'), usedFallback: false }),
    edit: vi.fn().mockResolvedValue({ buffer: Buffer.from('fake-edited-img'), usedFallback: false }),
  } as unknown as ImageClient;
}

function makeCtx(overrides: Partial<FeatureContext> = {}): FeatureContext {
  return {
    db: {} as any,
    config: {
      imageGen: { model: 'gpt-image-1', size: '1024x1024', channelIds: new Set(['chan-456']) },
      textChat: { model: 'gpt-4o-mini', fallbackModel: 'gpt-4o-mini', channelIds: new Set() },
      discord: { token: '', clientId: '', errorChannelId: null },
      cliproxy: { apiUrl: '', apiKey: '', maxConcurrent: 1 },
      openai: { apiKey: null, apiUrl: '' },
      session: { historyLimit: 10, expireMinutes: 30 },
      queue: { maxPending: 5 },
    } as any,
    sessionStore: {
      get: vi.fn().mockReturnValue(null),
      upsert: vi.fn(),
      delete: vi.fn(),
    } as any,
    channelPromptStore: {
      get: vi.fn().mockReturnValue(null),
    } as any,
    errorReporter: { report: vi.fn().mockResolvedValue(undefined) } as any,
    statsStore: { increment: vi.fn() } as any,
    ...overrides,
  };
}

type FakeAttachment = { url: string; name: string; contentType: string };

function makeMessage(content: string, attachments: FakeAttachment[] = []) {
  const sentMsg = {
    attachments: { first: () => ({ url: 'https://cdn.discordapp.com/image.png' }) },
  };
  const thinkingMsg = { edit: vi.fn().mockResolvedValue(sentMsg) };
  return {
    content,
    author: { id: 'user-123', bot: false },
    channelId: 'chan-456',
    attachments: { values: () => attachments[Symbol.iterator]() },
    reply: vi.fn().mockResolvedValue(thinkingMsg),
    _thinkingMsg: thinkingMsg,
  };
}

const IMG = (n = 1): FakeAttachment => ({
  url: `https://cdn.discordapp.com/uploaded${n}.png`,
  name: `uploaded${n}.png`,
  contentType: 'image/png',
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('createImageGenHandler', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('calls imageClient.generate with the message content as prompt', async () => {
    const client = makeClient();
    const handler = createImageGenHandler(client);
    const ctx = makeCtx();
    const message = makeMessage('a futuristic city at night');

    await handler(message as any, ctx);

    expect(client.generate).toHaveBeenCalledWith({
      prompt: 'a futuristic city at night',
      model: 'gpt-image-1',
      size: '1024x1024',
    });
  });

  it('replies with a thinking message then edits it with the generated image', async () => {
    const client = makeClient();
    const handler = createImageGenHandler(client);
    const ctx = makeCtx();
    const message = makeMessage('a dragon');

    await handler(message as any, ctx);

    expect(message.reply).toHaveBeenCalledWith(expect.stringContaining('Generating'));
    expect(message._thinkingMsg.edit).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Done') })
    );
  });

  it('resets session on !reset command', async () => {
    const client = makeClient();
    const handler = createImageGenHandler(client);
    const ctx = makeCtx();
    const message = makeMessage('!reset');

    await handler(message as any, ctx);

    expect(ctx.sessionStore.delete).toHaveBeenCalledWith('user-123', 'chan-456');
    expect(message.reply).toHaveBeenCalledWith(expect.stringContaining('reset'));
  });

  it('calls imageClient.edit when image attachment present', async () => {
    stubFetchImage();
    const client = makeClient();
    const handler = createImageGenHandler(client);
    const ctx = makeCtx();
    const message = makeMessage('add fire', [IMG(1)]);

    await handler(message as any, ctx);

    expect(client.edit).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: 'add fire', model: 'gpt-image-1' })
    );
  });
});
```

- [ ] **Step 6: Chạy tests**

```bash
npm test
```

Expected: `tests/imageHandler.test.ts` PASS, toàn bộ suite PASS.

- [ ] **Step 7: Xóa file cũ**

```bash
rm src/services/imageClient.ts src/handlers/imageHandler.ts
```

- [ ] **Step 8: Chạy tests lại**

```bash
npm test
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/features/image-gen/ tests/imageHandler.test.ts tests/imageClient.test.ts
git rm src/services/imageClient.ts src/handlers/imageHandler.ts
git commit -m "feat: extract image-gen feature module"
```

---

## Task 5: Feature text-chat

**Files:**
- Create: `src/features/text-chat/client.ts` (copy từ `src/services/chatClient.ts`)
- Create: `src/features/text-chat/handler.ts` (move từ `src/handlers/textChatHandler.ts`, đổi export sang factory)
- Create: `src/features/text-chat/index.ts` (factory mới)
- Delete: `src/services/chatClient.ts`, `src/handlers/textChatHandler.ts`

**Interfaces:**
- Consumes: `Feature`, `FeatureContext` từ `src/core/types.ts`
- Consumes: `config.textChat.model` từ FeatureContext
- Produces: `createTextChatFeature(config, db): Feature` tại `src/features/text-chat/index.ts` (dùng trong Task 8)

- [ ] **Step 1: Copy chatClient**

```bash
cp src/services/chatClient.ts src/features/text-chat/client.ts
```

Không thay đổi nội dung.

- [ ] **Step 2: Tạo `src/features/text-chat/handler.ts`**

Copy toàn bộ từ `src/handlers/textChatHandler.ts`, sau đó:

**Cập nhật imports:**

```typescript
// Trước:
import type { ChatClient, ChatMessage, ChatMessageContentPart } from '../services/chatClient';
import type { SessionStore, HistoryEntry } from '../services/sessionStore';
import type { ChannelPromptStore } from '../services/channelPromptStore';
import type { ErrorReporter } from '../services/errorReporter';
import type { StatsStore } from '../services/statsStore';

// Sau:
import type { ChatClient, ChatMessage, ChatMessageContentPart } from './client';
import type { HistoryEntry } from '../../shared/sessionStore';
import type { FeatureContext } from '../../core/types';
```

**Xóa `TextChatHandlerDeps` interface** — không còn dùng.

**Đổi exported function:**

```typescript
// Trước:
export async function handleTextChat(
  message: Message,
  deps: TextChatHandlerDeps,
): Promise<void> {
  const { chatClient, sessionStore, channelPromptStore, chatModel, errorReporter, statsStore } = deps;

// Sau:
export function createTextChatHandler(
  chatClient: ChatClient,
): (message: Message, ctx: FeatureContext) => Promise<void> {
  return async (message, ctx) => {
    const { sessionStore, channelPromptStore, errorReporter, statsStore, config } = ctx;
    const chatModel = config.textChat.model;
    // === PHẦN CÒN LẠI: copy nguyên xi từ handleTextChat body ===
    // Toàn bộ logic từ "const userId = message.author.id;" đến hết
```

> Đóng `};` và `}` ở cuối.

Helper functions `splitMessage`, `buildCurrentContent`, `buildMessages` — giữ nguyên hoàn toàn, chúng là pure functions, không liên quan đến deps/ctx.

- [ ] **Step 3: Tạo `src/features/text-chat/index.ts`**

```typescript
import type Database from 'better-sqlite3';
import type { Config } from '../../config';
import type { Feature } from '../../core/types';
import { ChatClient } from './client';
import { createTextChatHandler } from './handler';

export function createTextChatFeature(config: Config, db: Database.Database): Feature {
  const client = new ChatClient(
    config.cliproxy.apiUrl,
    config.cliproxy.apiKey,
    config.openai.apiKey ?? undefined,
    config.openai.apiUrl,
    config.textChat.fallbackModel,
    config.cliproxy.maxConcurrent,
  );
  return {
    id: 'text-chat',
    channelIds: config.textChat.channelIds,
    handler: createTextChatHandler(client),
  };
}
```

- [ ] **Step 4: Chạy tests**

```bash
npm test
```

Expected: PASS (tests/bot.test.ts sẽ fail vì mock paths — xử lý ở Task 7, nhưng hiện tại chưa xóa file cũ nên ok).

- [ ] **Step 5: Xóa file cũ**

```bash
rm src/services/chatClient.ts src/handlers/textChatHandler.ts
```

- [ ] **Step 6: Chạy tests**

```bash
npm test
```

Expected: `tests/bot.test.ts` FAIL (mock path cũ `../src/handlers/textChatHandler` không còn) — **chấp nhận được**, sẽ fix ở Task 7.

- [ ] **Step 7: Commit**

```bash
git add src/features/text-chat/
git rm src/services/chatClient.ts src/handlers/textChatHandler.ts
git commit -m "feat: extract text-chat feature module"
```

---

## Task 6: Restructure `src/config.ts`

**Files:**
- Modify: `src/config.ts` — interface mới, env vars mới
- Modify: `tests/config.test.ts` — cập nhật env vars + assertions

**Interfaces:**
- Produces: `Config` mới với `imageGen`, `textChat`, không có `discord.allowedChannelIds`, `discord.textChannelIds` (dùng trong Tasks 4, 5, 7, 8)

- [ ] **Step 1: Rewrite `src/config.ts`**

Giữ nguyên `requireEnv`, `requireEnvInt`, singleton pattern. Thay đổi `Config` interface và `loadConfig()`:

```typescript
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

function parseChannelIds(envVar: string): Set<string> {
  const raw = process.env[envVar] ?? '';
  return new Set(raw.split(',').map((id) => id.trim()).filter(Boolean));
}

export interface Config {
  discord: {
    token: string;
    clientId: string;
    errorChannelId: string | null;
  };
  cliproxy: {
    apiUrl: string;
    apiKey: string;
    maxConcurrent: number;
  };
  openai: {
    apiKey: string | null;
    apiUrl: string;
  };
  session: {
    historyLimit: number;
    expireMinutes: number;
  };
  queue: {
    maxPending: number;
  };
  imageGen: {
    channelIds: Set<string>;
    model: string;
    size: string;
  };
  textChat: {
    channelIds: Set<string>;
    model: string;
    fallbackModel: string;
  };
}

export function loadConfig(): Config {
  // Load .env file nếu có (dev mode)
  try {
    if (process.env.NODE_ENV === 'test') throw new Error('skip');
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
    // .env not found hoặc test env — OK
  }

  return {
    discord: {
      token: requireEnv('DISCORD_TOKEN'),
      clientId: requireEnv('DISCORD_CLIENT_ID'),
      errorChannelId: process.env.ERROR_CHANNEL_ID?.trim() || null,
    },
    cliproxy: {
      apiUrl: requireEnv('CLIPROXY_API_URL'),
      apiKey: requireEnv('CLIPROXY_API_KEY'),
      maxConcurrent: parseInt(process.env.CLIPROXY_MAX_CONCURRENT ?? '1', 10) || 1,
    },
    openai: {
      apiKey: process.env.OPENAI_API_KEY ?? null,
      apiUrl: process.env.OPENAI_API_URL ?? 'https://api.openai.com',
    },
    session: {
      historyLimit: requireEnvInt('SESSION_HISTORY_LIMIT'),
      expireMinutes: requireEnvInt('SESSION_EXPIRE_MINUTES'),
    },
    queue: {
      maxPending: requireEnvInt('CHANNEL_QUEUE_MAX_PENDING'),
    },
    imageGen: {
      channelIds: parseChannelIds('IMAGE_CHANNEL_IDS'),
      model: process.env.IMAGE_MODEL ?? 'gpt-image-1',
      size: process.env.IMAGE_SIZE ?? 'auto',
    },
    textChat: {
      channelIds: parseChannelIds('CHAT_CHANNEL_IDS'),
      model: process.env.CHAT_MODEL ?? 'gpt-4o-mini',
      fallbackModel: process.env.CHAT_FALLBACK_MODEL ?? 'gpt-4o-mini',
    },
  };
}

let configInstance: Config | null = null;

export function getConfig(): Config {
  if (!configInstance) configInstance = loadConfig();
  return configInstance;
}

let config: Config | undefined;
try {
  config = loadConfig();
} catch (e) {
  console.warn('Failed to load config at import time:', e);
}

export { config };
```

- [ ] **Step 2: Rewrite `tests/config.test.ts`**

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('loadConfig', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.NODE_ENV = 'test';
    process.env.DISCORD_TOKEN = 'test-token';
    process.env.DISCORD_CLIENT_ID = '111';
    process.env.CLIPROXY_API_URL = 'http://localhost:8317';
    process.env.CLIPROXY_API_KEY = 'test-key';
    process.env.IMAGE_CHANNEL_IDS = '123,456';
    process.env.IMAGE_MODEL = 'gpt-image-1';
    process.env.IMAGE_SIZE = '1024x1024';
    process.env.CHAT_CHANNEL_IDS = '789';
    process.env.SESSION_HISTORY_LIMIT = '10';
    process.env.SESSION_EXPIRE_MINUTES = '30';
    process.env.CHANNEL_QUEUE_MAX_PENDING = '5';
  });

  it('parses IMAGE_CHANNEL_IDS into imageGen.channelIds Set', async () => {
    const { loadConfig } = await import('../src/config');
    const cfg = loadConfig();
    expect(cfg.imageGen.channelIds).toBeInstanceOf(Set);
    expect(cfg.imageGen.channelIds.has('123')).toBe(true);
    expect(cfg.imageGen.channelIds.has('456')).toBe(true);
  });

  it('parses CHAT_CHANNEL_IDS into textChat.channelIds Set', async () => {
    const { loadConfig } = await import('../src/config');
    const cfg = loadConfig();
    expect(cfg.textChat.channelIds).toBeInstanceOf(Set);
    expect(cfg.textChat.channelIds.has('789')).toBe(true);
  });

  it('parses numeric env vars as numbers', async () => {
    const { loadConfig } = await import('../src/config');
    const cfg = loadConfig();
    expect(cfg.session.historyLimit).toBe(10);
    expect(cfg.session.expireMinutes).toBe(30);
    expect(cfg.queue.maxPending).toBe(5);
  });

  it('throws if DISCORD_TOKEN is missing', async () => {
    delete process.env.DISCORD_TOKEN;
    const { loadConfig } = await import('../src/config');
    expect(() => loadConfig()).toThrow('DISCORD_TOKEN');
  });

  it('returns empty set when IMAGE_CHANNEL_IDS not set', async () => {
    delete process.env.IMAGE_CHANNEL_IDS;
    const { loadConfig } = await import('../src/config');
    const cfg = loadConfig();
    expect(cfg.imageGen.channelIds.size).toBe(0);
  });

  it('Config has no discord.allowedChannelIds (old field removed)', async () => {
    const { loadConfig } = await import('../src/config');
    const cfg = loadConfig();
    expect((cfg.discord as any).allowedChannelIds).toBeUndefined();
  });
});
```

- [ ] **Step 3: Chạy tests**

```bash
npm test
```

Expected: `tests/config.test.ts` PASS. Các test khác có thể FAIL nếu import `config.discord.allowedChannelIds` — fix từng file.

- [ ] **Step 4: Cập nhật `.env.example`**

Trong `.env.example`, thay:
```
ALLOWED_CHANNEL_IDS=111,222
TEXT_CHANNEL_IDS=333,444
```
Thành:
```
# ─── Feature: Image Generation ─────────────────────────────────────────────────
IMAGE_CHANNEL_IDS=111,222
IMAGE_MODEL=gpt-image-1
IMAGE_SIZE=auto

# ─── Feature: Text Chat ──────────────────────────────────────────────────────────
CHAT_CHANNEL_IDS=333,444
CHAT_MODEL=gpt-4o-mini
CHAT_FALLBACK_MODEL=gpt-4o-mini
```

Và xóa dòng `ALLOWED_CHANNEL_IDS`.

- [ ] **Step 5: Chạy tests**

```bash
npm test
```

Expected: config tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/config.ts tests/config.test.ts .env.example
git commit -m "refactor: restructure Config — imageGen/textChat sections, remove ALLOWED_CHANNEL_IDS"
```

---

## Task 7: Slim `src/bot.ts` + update tests

**Files:**
- Modify: `src/bot.ts` — rewrite dùng router
- Modify: `tests/bot.test.ts` — new signature, mock router

**Interfaces:**
- Consumes: `FeatureRouter` từ `src/core/router.ts` (Task 1)
- Consumes: `QueueManager` từ `src/core/queue.ts` (Task 2)
- Consumes: `FeatureContext` từ `src/core/types.ts` (Task 1)
- Produces: `createMessageHandler(router, queueManager, ctx)` (dùng trong Task 8)

- [ ] **Step 1: Rewrite `src/bot.ts`**

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
    if (!feature) return;

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

- [ ] **Step 2: Rewrite `tests/bot.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('discord.js', () => ({}));

import { createMessageHandler } from '../src/bot';
import type { FeatureRouter } from '../src/core/router';
import type { QueueManager } from '../src/core/queue';
import type { FeatureContext } from '../src/core/types';
import type { Feature } from '../src/core/types';

// ─── Helpers ────────────────────────────────────────────────────────────────

let _msgCounter = 0;

function makeMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: `msg-${++_msgCounter}`,
    author: { id: 'user-123', bot: false },
    channelId: 'chan-image',
    content: 'a sunset',
    reply: vi.fn().mockResolvedValue({}),
    ...overrides,
  };
}

function makeFeature(channelIds: string[]): Feature {
  return {
    id: 'test-feature',
    channelIds: new Set(channelIds),
    handler: vi.fn().mockResolvedValue(undefined),
  };
}

function makeRouter(feature?: Feature): FeatureRouter {
  return {
    resolve: vi.fn().mockReturnValue(feature),
    register: vi.fn(),
    registeredChannelIds: new Set(feature ? [...feature.channelIds] : []),
  } as unknown as FeatureRouter;
}

function makeQueueManager(enqueues = true): QueueManager {
  return {
    enqueue: vi.fn().mockReturnValue(enqueues),
    getPendingCount: vi.fn().mockReturnValue(0),
  } as unknown as QueueManager;
}

function makeCtx(): FeatureContext {
  return {} as unknown as FeatureContext;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('createMessageHandler', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('ignores messages from bots', async () => {
    const qm = makeQueueManager();
    const router = makeRouter();
    const handler = createMessageHandler(router, qm, makeCtx());
    await handler(makeMessage({ author: { id: 'bot-1', bot: true } }) as any);
    expect(qm.enqueue).not.toHaveBeenCalled();
  });

  it('ignores messages in unregistered channels (router returns undefined)', async () => {
    const qm = makeQueueManager();
    const router = makeRouter(undefined); // resolve returns undefined
    const handler = createMessageHandler(router, qm, makeCtx());
    await handler(makeMessage({ channelId: 'chan-unknown' }) as any);
    expect(qm.enqueue).not.toHaveBeenCalled();
  });

  it('enqueues task for valid message in registered channel', async () => {
    const feature = makeFeature(['chan-image']);
    const qm = makeQueueManager();
    const router = makeRouter(feature);
    const handler = createMessageHandler(router, qm, makeCtx());
    await handler(makeMessage({ channelId: 'chan-image' }) as any);
    expect(qm.enqueue).toHaveBeenCalledWith('chan-image', expect.any(Function));
  });

  it('does not reply when successfully enqueued', async () => {
    const feature = makeFeature(['chan-image']);
    const qm = makeQueueManager(true);
    const router = makeRouter(feature);
    const handler = createMessageHandler(router, qm, makeCtx());
    const message = makeMessage({ channelId: 'chan-image' });
    await handler(message as any);
    expect(message.reply).not.toHaveBeenCalled();
  });

  it('replies with busy notice when queue is full', async () => {
    const feature = makeFeature(['chan-image']);
    const qm = makeQueueManager(false);
    const router = makeRouter(feature);
    const handler = createMessageHandler(router, qm, makeCtx());
    const message = makeMessage({ channelId: 'chan-image' });
    await handler(message as any);
    expect(message.reply).toHaveBeenCalledWith(expect.stringMatching(/bận|busy/i));
  });

  it('calls feature.handler with (message, ctx) when enqueued task executes', async () => {
    const feature = makeFeature(['chan-image']);
    let capturedTask: (() => Promise<void>) | undefined;
    const qm = {
      enqueue: vi.fn().mockImplementation((_ch: string, task: () => Promise<void>) => {
        capturedTask = task;
        return true;
      }),
    } as unknown as QueueManager;
    const ctx = makeCtx();
    const router = makeRouter(feature);
    const handler = createMessageHandler(router, qm, ctx);
    const message = makeMessage({ channelId: 'chan-image' });

    await handler(message as any);
    expect(capturedTask).toBeDefined();
    await capturedTask!();

    expect(feature.handler).toHaveBeenCalledWith(message, ctx);
  });

  it('skips duplicate message IDs', async () => {
    const feature = makeFeature(['chan-image']);
    const qm = makeQueueManager();
    const router = makeRouter(feature);
    const handler = createMessageHandler(router, qm, makeCtx());
    const message = makeMessage({ channelId: 'chan-image', id: 'same-id-99' });

    await handler(message as any);
    await handler(message as any); // duplicate

    expect(qm.enqueue).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3: Chạy tests**

```bash
npm test
```

Expected: `tests/bot.test.ts` PASS, toàn bộ suite PASS.

- [ ] **Step 4: Commit**

```bash
git add src/bot.ts tests/bot.test.ts
git commit -m "refactor: slim bot.ts — router-based dispatch, remove hardcoded handler routing"
```

---

## Task 8: Rewrite `src/index.ts` — register features

**Files:**
- Modify: `src/index.ts` — wiring features vào router

**Interfaces:**
- Consumes: `FeatureRouter` (Task 1), `QueueManager` (Task 2)
- Consumes: `SessionStore`, `ChannelPromptStore`, `ErrorReporter`, `StatsStore` từ `src/shared/` (Task 3)
- Consumes: `createImageGenFeature` (Task 4), `createTextChatFeature` (Task 5)
- Consumes: `getConfig()` — Config mới (Task 6)
- Consumes: `createMessageHandler` — signature mới (Task 7)

- [ ] **Step 1: Rewrite `src/index.ts`**

Giữ nguyên `enforceSingleInstance()` và `shutdown()` — KHÔNG thay đổi. Chỉ thay đổi phần `main()` từ dòng `const config = getConfig()` trở đi:

```typescript
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { Client, GatewayIntentBits } from 'discord.js';
import { getConfig } from './config';
import { initDb, cleanupExpiredSessions } from './db/schema';
import { SessionStore } from './shared/sessionStore';
import { ChannelPromptStore } from './shared/channelPromptStore';
import { ErrorReporter } from './shared/errorReporter';
import { StatsStore } from './shared/statsStore';
import { QueueManager } from './core/queue';
import { FeatureRouter } from './core/router';
import { createImageGenFeature } from './features/image-gen';
import { createTextChatFeature } from './features/text-chat';
import { createMessageHandler } from './bot';

// ─── Single-instance guard (giữ nguyên hoàn toàn) ───────────────────────────
async function enforceSingleInstance(): Promise<void> {
  // ... copy nguyên xi từ index.ts hiện tại
}

// ─── Bootstrap ───────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  await enforceSingleInstance();

  const config = getConfig();
  const db = initDb('data/bot.db');

  // ─── Shared infrastructure ──────────────────────────────────────────────
  const sessionStore = new SessionStore(
    db,
    config.session.historyLimit,
    config.session.expireMinutes,
  );
  const channelPromptStore = new ChannelPromptStore(db);
  const queueManager = new QueueManager(config.queue.maxPending);

  // ─── Discord client (trước errorReporter vì errorReporter cần client) ───
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  const errorReporter = new ErrorReporter(client, config.discord.errorChannelId);
  const statsStore = new StatsStore(db);

  // ─── FeatureContext ─────────────────────────────────────────────────────
  const ctx = {
    db,
    config,
    errorReporter,
    statsStore,
    sessionStore,
    channelPromptStore,
  };

  // ─── Feature registry ───────────────────────────────────────────────────
  const router = new FeatureRouter();
  router.register(createImageGenFeature(config, db));
  router.register(createTextChatFeature(config, db));
  // router.register(createVideoGenFeature(config, db)); // uncomment khi ready

  console.log(`🚀 Router: ${router.registeredChannelIds.size} channel(s) registered`);

  if (!config.openai.apiKey) {
    console.warn('⚠️  OPENAI_API_KEY not set — no fallback if CLIProxy is rate-limited.');
  }

  // ─── Event routing ──────────────────────────────────────────────────────
  client.on('messageCreate', createMessageHandler(router, queueManager, ctx));

  client.once('ready', (c) => {
    console.log(`✅ Logged in as ${c.user.tag}`);
    setInterval(() => {
      const deleted = cleanupExpiredSessions(db, config.session.expireMinutes);
      if (deleted > 0) console.log(`🧹 Cleaned up ${deleted} expired session(s)`);
    }, 60 * 60 * 1000);
  });

  client.on('error', (err) => {
    console.error('Discord client error:', err);
    void errorReporter.report(err, { source: 'discord-client' });
  });

  process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
    void errorReporter.report(err, { source: 'uncaughtException' });
  });

  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled rejection:', reason);
    void errorReporter.report(reason, { source: 'unhandledRejection' });
  });

  // ─── Graceful shutdown (giữ nguyên) ────────────────────────────────────
  async function shutdown(signal: string): Promise<void> {
    console.log(`\n${signal} received — shutting down...`);
    client.destroy();
    await new Promise((r) => setTimeout(r, 1_000));
    db.close();
    try { fs.unlinkSync(path.join(process.cwd(), 'data', 'bot.pid')); } catch {}
    process.exit(0);
  }

  process.on('SIGINT', () => { void shutdown('SIGINT'); });
  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });

  await client.login(config.discord.token);
}

main().catch((err) => {
  console.error('Failed to start bot:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Chạy toàn bộ tests**

```bash
npm test
```

Expected: **tất cả PASS**.

- [ ] **Step 3: TypeScript compile check**

```bash
npx tsc --noEmit
```

Expected: không có lỗi.

- [ ] **Step 4: Kiểm tra services/ còn file nào không**

```bash
ls src/services/ 2>/dev/null && echo "CÒN FILE CŨ" || echo "services/ đã sạch"
```

Nếu còn file, xóa nốt.

- [ ] **Step 5: Kiểm tra handlers/ còn file nào không**

```bash
ls src/handlers/ 2>/dev/null && echo "CÒN FILE CŨ" || echo "handlers/ đã sạch"
```

Nếu còn file, xóa nốt.

- [ ] **Step 6: Final test run**

```bash
npm test
```

Expected: toàn bộ PASS.

- [ ] **Step 7: Commit**

```bash
git add src/index.ts
git commit -m "refactor: wire feature registry in index.ts — bot.ts no longer changes for new features"
```

---

## Self-review checklist

**Spec coverage:**
- ✅ `src/core/types.ts` — `Feature`, `FeatureContext` (Spec §3)
- ✅ `src/core/router.ts` — `FeatureRouter` với `register`, `resolve`, `registeredChannelIds` (Spec §4)
- ✅ `src/bot.ts` slim — không import handler cụ thể (Spec §5)
- ✅ Feature module pattern — factory `createXxxFeature(config, db)` (Spec §6)
- ✅ `src/index.ts` — register pattern (Spec §7)
- ✅ `src/config.ts` — `imageGen`, `textChat` sections; xóa `allowedChannelIds`; `CHAT_CHANNEL_IDS` thay `TEXT_CHANNEL_IDS` (Spec §8)
- ✅ Migration map — tất cả file đã có task (Spec §9)
- ✅ Config UI, SQLite schema, graceful shutdown, single-instance guard — không thay đổi (Spec §11)

**Không có placeholder** — tất cả code block đã đầy đủ.

**Type consistency:**
- `createImageGenHandler(client)` → `(message, ctx) => Promise<void>` — Task 4 tạo, Task 8 dùng ✅
- `createTextChatHandler(client)` → `(message, ctx) => Promise<void>` — Task 5 tạo, Task 8 dùng ✅
- `FeatureRouter.resolve()` → `Feature | undefined` — Task 1 tạo, Task 7 dùng ✅
- `config.imageGen.model`, `config.imageGen.size` — Task 6 tạo, Task 4 handler dùng ✅
- `config.textChat.model`, `config.textChat.fallbackModel` — Task 6 tạo, Task 5 handler dùng ✅
