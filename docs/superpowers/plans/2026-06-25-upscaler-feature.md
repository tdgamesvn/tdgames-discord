# Upscaler Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `features/upscaler` Discord bot feature that auto-upscales images 4x when posted to a dedicated channel, using the `upscayl-bin` CLI bundled with Upscayl.app on macOS.

**Architecture:** Follows the existing Feature Registry pattern (`Feature { id, channelIds, handler }`). `UpscalerClient` wraps `child_process.spawn` to call `upscayl-bin`. The handler downloads Discord attachments to OS temp files, runs the binary, replies with the result image, and cleans up in a `finally` block. Config is env-driven; Config UI gets a new Upscaler section with channel list + settings dropdowns.

**Tech Stack:** TypeScript, discord.js v14, Node.js built-ins (`child_process`, `fs`, `os`, `path`), vitest — **no new npm packages needed**.

## Global Constraints

- Follow existing pattern exactly: `src/features/<name>/{client,handler,index}.ts`
- Test files live in `tests/` directory, named `<module>.test.ts`
- Run tests with `npm test` (vitest)
- No new npm packages — use Node.js built-ins only
- All Discord replies: send `⏳ ...` placeholder first, then edit to `✅ ...` or `❌ ...`
- Cleanup temp files in `finally` block; each `unlinkSync` wrapped in `try/catch` to ignore ENOENT
- TypeScript strict — no untyped `any` without comment
- Upscayl binary default path: `/Applications/Upscayl.app/Contents/Resources/bin/upscayl-bin`
- Upscayl models default path: `/Applications/Upscayl.app/Contents/Resources/models`
- Default model: `upscayl-standard-4x`, default scale: `4`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/features/upscaler/client.ts` | **Create** | `UpscalerClient` — wraps `child_process.spawn` to call `upscayl-bin` |
| `src/features/upscaler/handler.ts` | **Create** | `createUpscalerHandler` — downloads attachment, upscales, replies |
| `src/features/upscaler/index.ts` | **Create** | `createUpscalerFeature` — wires config + client + handler → `Feature` |
| `src/config.ts` | **Modify** | Add `upscaler` section to `Config` interface and `loadConfig()` |
| `.env.example` | **Modify** | Add `UPSCALE_*` vars with comments |
| `src/index.ts` | **Modify** | Register `createUpscalerFeature` in router |
| `tools/config-ui/server.ts` | **Modify** | Add Upscaler HTML section + JS channel manager |
| `tests/upscalerClient.test.ts` | **Create** | Unit tests for `UpscalerClient` |
| `tests/upscalerHandler.test.ts` | **Create** | Unit tests for `createUpscalerHandler` |

---

## Task 44: UpscalerClient

**Files:**
- Create: `src/features/upscaler/client.ts`
- Create: `tests/upscalerClient.test.ts`

**Interfaces:**
- Produces: `class UpscalerClient { constructor(opts: UpscalerOptions); upscale(inputPath: string, outputPath: string): Promise<void> }`
- Produces: `interface UpscalerOptions { binPath: string; modelsPath: string; model: string; scale: number; format?: 'png' | 'jpg' | 'webp' }`

- [ ] **Step 1: Write the failing test**

Create `tests/upscalerClient.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as childProcess from 'child_process';
import * as fs from 'fs';

vi.mock('child_process');
vi.mock('fs');

// Helper: build a mock spawn process with controllable close/error events
function makeProc() {
  const procCallbacks: Record<string, (...args: unknown[]) => void> = {};
  const proc = {
    stderr: { on: vi.fn() },
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      procCallbacks[event] = cb;
    }),
    simulateClose: (code: number) => procCallbacks['close']?.(code),
    simulateError: (err: Error) => procCallbacks['error']?.(err),
  };
  return proc;
}

const OPTS = {
  binPath: '/usr/local/bin/upscayl-bin',
  modelsPath: '/path/to/models',
  model: 'upscayl-standard-4x',
  scale: 4,
  format: 'png' as const,
};

describe('UpscalerClient', () => {
  beforeEach(() => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('throws immediately when binary is not found', async () => {
    const { UpscalerClient } = await import('../src/features/upscaler/client');
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const client = new UpscalerClient({ ...OPTS, binPath: '/nonexistent/upscayl-bin' });
    await expect(client.upscale('/tmp/in.png', '/tmp/out.png')).rejects.toThrow(
      'upscayl-bin not found at: /nonexistent/upscayl-bin',
    );
    expect(childProcess.spawn).not.toHaveBeenCalled();
  });

  it('spawns upscayl-bin with correct arguments', async () => {
    const { UpscalerClient } = await import('../src/features/upscaler/client');
    const proc = makeProc();
    vi.mocked(childProcess.spawn).mockReturnValue(proc as ReturnType<typeof childProcess.spawn>);

    const client = new UpscalerClient(OPTS);
    const promise = client.upscale('/tmp/input.png', '/tmp/output.png');
    proc.simulateClose(0);
    await promise;

    expect(childProcess.spawn).toHaveBeenCalledWith('/usr/local/bin/upscayl-bin', [
      '-i', '/tmp/input.png',
      '-o', '/tmp/output.png',
      '-m', '/path/to/models',
      '-n', 'upscayl-standard-4x',
      '-s', '4',
      '-f', 'png',
    ]);
  });

  it('resolves when process exits with code 0', async () => {
    const { UpscalerClient } = await import('../src/features/upscaler/client');
    const proc = makeProc();
    vi.mocked(childProcess.spawn).mockReturnValue(proc as ReturnType<typeof childProcess.spawn>);

    const client = new UpscalerClient(OPTS);
    const promise = client.upscale('/tmp/input.png', '/tmp/output.png');
    proc.simulateClose(0);

    await expect(promise).resolves.toBeUndefined();
  });

  it('rejects when process exits with non-zero code', async () => {
    const { UpscalerClient } = await import('../src/features/upscaler/client');
    const proc = makeProc();
    vi.mocked(childProcess.spawn).mockReturnValue(proc as ReturnType<typeof childProcess.spawn>);

    const client = new UpscalerClient(OPTS);
    const promise = client.upscale('/tmp/input.png', '/tmp/output.png');
    proc.simulateClose(1);

    await expect(promise).rejects.toThrow('upscayl-bin exited with code 1');
  });

  it('rejects when spawn emits an error event', async () => {
    const { UpscalerClient } = await import('../src/features/upscaler/client');
    const proc = makeProc();
    vi.mocked(childProcess.spawn).mockReturnValue(proc as ReturnType<typeof childProcess.spawn>);

    const client = new UpscalerClient(OPTS);
    const promise = client.upscale('/tmp/input.png', '/tmp/output.png');
    proc.simulateError(new Error('ENOENT binary missing'));

    await expect(promise).rejects.toThrow('ENOENT binary missing');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- upscalerClient
```

Expected: FAIL — `Cannot find module '../src/features/upscaler/client'`

- [ ] **Step 3: Implement `UpscalerClient`**

Create `src/features/upscaler/client.ts`:

```typescript
import { spawn } from 'child_process';
import * as fs from 'fs';

export interface UpscalerOptions {
  binPath: string;
  modelsPath: string;
  model: string;
  scale: number;
  format?: 'png' | 'jpg' | 'webp';
}

export class UpscalerClient {
  constructor(private readonly opts: UpscalerOptions) {}

  /**
   * Upscale the image at `inputPath`, writing the result to `outputPath`.
   * Resolves on success, rejects with a descriptive error on failure.
   */
  async upscale(inputPath: string, outputPath: string): Promise<void> {
    const { binPath, modelsPath, model, scale, format = 'png' } = this.opts;

    if (!fs.existsSync(binPath)) {
      throw new Error(`upscayl-bin not found at: ${binPath}`);
    }

    const args = [
      '-i', inputPath,
      '-o', outputPath,
      '-m', modelsPath,
      '-n', model,
      '-s', String(scale),
      '-f', format,
    ];

    return new Promise((resolve, reject) => {
      const proc = spawn(binPath, args);
      const stderrChunks: string[] = [];

      proc.stderr.on('data', (chunk: Buffer) => {
        stderrChunks.push(chunk.toString());
      });

      proc.on('error', (err: Error) => {
        reject(new Error(`Failed to spawn upscayl-bin: ${err.message}`));
      });

      proc.on('close', (code: number | null) => {
        if (code === 0) {
          resolve();
        } else {
          const detail = stderrChunks.join('').trim();
          reject(new Error(
            `upscayl-bin exited with code ${code}${detail ? `. stderr: ${detail}` : ''}`,
          ));
        }
      });
    });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- upscalerClient
```

Expected: 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/upscaler/client.ts tests/upscalerClient.test.ts
git commit -m "feat: add UpscalerClient wrapping upscayl-bin CLI"
```

---

## Task 45: UpscalerHandler

**Files:**
- Create: `src/features/upscaler/handler.ts`
- Create: `tests/upscalerHandler.test.ts`

**Interfaces:**
- Consumes: `UpscalerClient` from Task 44 — specifically `client.upscale(inputPath, outputPath): Promise<void>`
- Consumes: `FeatureContext` from `src/core/types.ts` — uses `ctx.errorReporter`, `ctx.config.upscaler.scale`, `ctx.config.upscaler.model`
- Produces: `createUpscalerHandler(client: UpscalerClient): (message: Message, ctx: FeatureContext) => Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `tests/upscalerHandler.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import type { UpscalerClient } from '../src/features/upscaler/client';
import type { FeatureContext } from '../src/core/types';

vi.mock('fs');

const FAKE_DOWNLOAD = Buffer.from('downloaded-image-data');
const FAKE_UPSCALED = Buffer.from('upscaled-image-data');

/** Build a fake Discord Message. Returns the message + the thinking reply stub. */
function makeMessage(hasImage = true) {
  const attachment = hasImage
    ? {
        contentType: 'image/png',
        url: 'https://cdn.discordapp.com/attachments/1/2/photo.png',
        name: 'photo.png',
      }
    : null;

  const thinkingMsg = { edit: vi.fn().mockResolvedValue({}) };

  const message = {
    attachments: { values: () => (hasImage ? [attachment] : []) },
    author: { id: 'user-123' },
    channelId: 'chan-456',
    reply: vi.fn().mockResolvedValue(thinkingMsg),
    _thinking: thinkingMsg,
  };
  return message;
}

function makeCtx(): FeatureContext {
  return {
    db: {} as never,
    config: {
      upscaler: {
        scale: 4,
        model: 'upscayl-standard-4x',
        channelIds: new Set(['chan-456']),
        binPath: '/Applications/Upscayl.app/Contents/Resources/bin/upscayl-bin',
        modelsPath: '/Applications/Upscayl.app/Contents/Resources/models',
      },
    } as never,
    errorReporter: { report: vi.fn().mockResolvedValue(undefined) } as never,
    statsStore: {} as never,
    sessionStore: {} as never,
    channelPromptStore: {} as never,
  };
}

describe('createUpscalerHandler', () => {
  beforeEach(() => {
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});
    vi.mocked(fs.readFileSync).mockReturnValue(FAKE_UPSCALED);
    vi.mocked(fs.unlinkSync).mockImplementation(() => {});
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('does nothing when message has no image attachment', async () => {
    const { createUpscalerHandler } = await import('../src/features/upscaler/handler');
    const client = { upscale: vi.fn() } as unknown as UpscalerClient;
    const handler = createUpscalerHandler(client);
    const message = makeMessage(false);

    await handler(message as never, makeCtx());

    expect(message.reply).not.toHaveBeenCalled();
    expect(client.upscale).not.toHaveBeenCalled();
  });

  it('sends ⏳ placeholder reply immediately', async () => {
    const { createUpscalerHandler } = await import('../src/features/upscaler/handler');
    const client = { upscale: vi.fn().mockResolvedValue(undefined) } as unknown as UpscalerClient;
    const handler = createUpscalerHandler(client);
    const message = makeMessage(true);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => FAKE_DOWNLOAD.buffer,
    }));

    await handler(message as never, makeCtx());

    expect(message.reply).toHaveBeenCalledWith('⏳ Đang upscale ảnh...');
  });

  it('edits reply with ✅ and attachment on success', async () => {
    const { createUpscalerHandler } = await import('../src/features/upscaler/handler');
    const client = { upscale: vi.fn().mockResolvedValue(undefined) } as unknown as UpscalerClient;
    const handler = createUpscalerHandler(client);
    const message = makeMessage(true);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => FAKE_DOWNLOAD.buffer,
    }));

    await handler(message as never, makeCtx());

    expect(message._thinking.edit).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('✅'),
        files: expect.any(Array),
      }),
    );
    // The content should mention scale and model
    const callArg = message._thinking.edit.mock.calls[0][0];
    expect(callArg.content).toContain('4x');
    expect(callArg.content).toContain('upscayl-standard-4x');
  });

  it('edits reply with ❌ when upscale fails', async () => {
    const { createUpscalerHandler } = await import('../src/features/upscaler/handler');
    const client = {
      upscale: vi.fn().mockRejectedValue(new Error('upscayl-bin exited with code 1')),
    } as unknown as UpscalerClient;
    const handler = createUpscalerHandler(client);
    const message = makeMessage(true);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => FAKE_DOWNLOAD.buffer,
    }));

    await handler(message as never, makeCtx());

    expect(message._thinking.edit).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('❌') }),
    );
  });

  it('reports error to errorReporter on failure', async () => {
    const { createUpscalerHandler } = await import('../src/features/upscaler/handler');
    const err = new Error('binary crashed');
    const client = { upscale: vi.fn().mockRejectedValue(err) } as unknown as UpscalerClient;
    const handler = createUpscalerHandler(client);
    const message = makeMessage(true);
    const ctx = makeCtx();

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => FAKE_DOWNLOAD.buffer,
    }));

    await handler(message as never, ctx);

    expect(ctx.errorReporter.report).toHaveBeenCalledWith(
      err,
      expect.objectContaining({ source: 'upscalerHandler' }),
    );
  });

  it('cleans up both temp files in finally — even on failure', async () => {
    const { createUpscalerHandler } = await import('../src/features/upscaler/handler');
    const client = {
      upscale: vi.fn().mockRejectedValue(new Error('crash')),
    } as unknown as UpscalerClient;
    const handler = createUpscalerHandler(client);
    const message = makeMessage(true);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => FAKE_DOWNLOAD.buffer,
    }));

    await handler(message as never, makeCtx());

    // unlinkSync called for input AND output paths
    expect(fs.unlinkSync).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- upscalerHandler
```

Expected: FAIL — `Cannot find module '../src/features/upscaler/handler'`

- [ ] **Step 3: Implement `createUpscalerHandler`**

Create `src/features/upscaler/handler.ts`:

```typescript
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AttachmentBuilder, type Message } from 'discord.js';
import type { UpscalerClient } from './client';
import type { FeatureContext } from '../../core/types';

export function createUpscalerHandler(
  client: UpscalerClient,
): (message: Message, ctx: FeatureContext) => Promise<void> {
  return async (message, ctx) => {
    const { errorReporter, config } = ctx;

    // Only process messages that contain at least one image attachment
    const imageAttachment = [...message.attachments.values()].find(
      (a) => a.contentType?.startsWith('image/') ?? false,
    );
    if (!imageAttachment) return;

    // Send "working" placeholder so the user sees immediate feedback
    const thinkingMsg = await message.reply('⏳ Đang upscale ảnh...');

    // Build unique temp file paths — avoids collisions under concurrent requests
    const uid = `upscayl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const ext = path.extname(imageAttachment.name ?? 'image.png') || '.png';
    const inputPath = path.join(os.tmpdir(), `${uid}-input${ext}`);
    const outputPath = path.join(os.tmpdir(), `${uid}-output.png`);

    try {
      // ── 1. Download the Discord attachment ──────────────────────────────────
      const resp = await fetch(imageAttachment.url);
      if (!resp.ok) throw new Error(`Failed to download image: HTTP ${resp.status}`);
      const buffer = Buffer.from(await resp.arrayBuffer());
      fs.writeFileSync(inputPath, buffer);

      // ── 2. Run upscayl-bin ─────────────────────────────────────────────────
      await client.upscale(inputPath, outputPath);

      // ── 3. Upload result ────────────────────────────────────────────────────
      const resultBuffer = fs.readFileSync(outputPath);
      const attachment = new AttachmentBuilder(resultBuffer, { name: 'upscaled.png' });

      const { scale, model } = config.upscaler;
      await thinkingMsg.edit({
        content: `✅ Xong! (${scale}x · ${model})`,
        files: [attachment],
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      await thinkingMsg.edit({ content: `❌ Upscale thất bại: ${msg}` });
      await errorReporter?.report(err, {
        source: 'upscalerHandler',
        userId: message.author.id,
        channelId: message.channelId,
      });
    } finally {
      // ── 4. Cleanup temp files (ignore ENOENT — file may not have been written) ──
      for (const p of [inputPath, outputPath]) {
        try { fs.unlinkSync(p); } catch { /* ignore */ }
      }
    }
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- upscalerHandler
```

Expected: 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/upscaler/handler.ts tests/upscalerHandler.test.ts
git commit -m "feat: add UpscalerHandler — download attachment, upscale, reply"
```

---

## Task 46: Config + Feature Registration

**Files:**
- Modify: `src/config.ts`
- Modify: `.env.example`
- Create: `src/features/upscaler/index.ts`
- Modify: `src/index.ts`

**Interfaces:**
- Consumes: `UpscalerClient` (Task 44), `createUpscalerHandler` (Task 45)
- Produces: `createUpscalerFeature(config: Config, db: Database): Feature`
- Adds to `Config`: `upscaler: { channelIds: Set<string>; binPath: string; modelsPath: string; scale: number; model: string }`

- [ ] **Step 1: Extend `Config` interface in `src/config.ts`**

Add the `upscaler` section to the `Config` interface (after `textChat`):

```typescript
// In the Config interface, after the textChat block:
  upscaler: {
    channelIds: Set<string>;
    binPath: string;
    modelsPath: string;
    scale: number;
    model: string;
  };
```

Add the `upscaler` block inside `loadConfig()` return value (after `textChat`):

```typescript
    upscaler: {
      channelIds: parseChannelIds('UPSCALE_CHANNEL_IDS'),
      binPath: process.env.UPSCAYL_BIN_PATH
        ?? '/Applications/Upscayl.app/Contents/Resources/bin/upscayl-bin',
      modelsPath: process.env.UPSCAYL_MODELS_PATH
        ?? '/Applications/Upscayl.app/Contents/Resources/models',
      scale: parseInt(process.env.UPSCALE_SCALE ?? '4', 10) || 4,
      model: process.env.UPSCALE_MODEL ?? 'upscayl-standard-4x',
    },
```

- [ ] **Step 2: Add env vars to `.env.example`**

Append after the `# ─── Feature: Text Chat` block:

```bash
# ─── Feature: Upscaler ───────────────────────────────────────────────────────
UPSCALE_CHANNEL_IDS=
UPSCAYL_BIN_PATH=/Applications/Upscayl.app/Contents/Resources/bin/upscayl-bin
UPSCAYL_MODELS_PATH=/Applications/Upscayl.app/Contents/Resources/models
UPSCALE_SCALE=4
UPSCALE_MODEL=upscayl-standard-4x
```

- [ ] **Step 3: Create `src/features/upscaler/index.ts`**

```typescript
import type Database from 'better-sqlite3';
import type { Config } from '../../config';
import type { Feature } from '../../core/types';
import { UpscalerClient } from './client';
import { createUpscalerHandler } from './handler';

export function createUpscalerFeature(config: Config, _db: Database.Database): Feature {
  const client = new UpscalerClient({
    binPath: config.upscaler.binPath,
    modelsPath: config.upscaler.modelsPath,
    model: config.upscaler.model,
    scale: config.upscaler.scale,
    format: 'png',
  });
  return {
    id: 'upscaler',
    channelIds: config.upscaler.channelIds,
    handler: createUpscalerHandler(client),
  };
}
```

- [ ] **Step 4: Register the feature in `src/index.ts`**

Add import after the `createTextChatFeature` import line:

```typescript
import { createUpscalerFeature } from './features/upscaler';
```

Add registration after `router.register(createTextChatFeature(config, db))`:

```typescript
  router.register(createUpscalerFeature(config, db));
```

- [ ] **Step 5: Run full test suite to verify no regressions**

```bash
npm test
```

Expected: all existing tests + new tests PASS, zero failures.

- [ ] **Step 6: Commit**

```bash
git add src/config.ts .env.example src/features/upscaler/index.ts src/index.ts
git commit -m "feat: wire upscaler feature — config, index, router registration"
```

---

## Task 47: Config UI — Upscaler Section

**Files:**
- Modify: `tools/config-ui/server.ts`

**What to add:**
1. Hidden input `UPSCALE_CHANNEL_IDS` (alongside existing hidden inputs at line ~545)
2. Upscaler section HTML (channels + settings) between Chat and Session sections
3. `UPSCALE_CHANNEL_IDS`, `UPSCAYL_BIN_PATH`, `UPSCAYL_MODELS_PATH`, `UPSCALE_SCALE`, `UPSCALE_MODEL` added to the `KEYS` array
4. JS functions: `syncUpscalerChannelIds()`, `renderUpscalerChannelCard()`, `loadUpscalerChannels()`
5. `loadUpscalerChannels()` called in the init chain

- [ ] **Step 1: Add hidden input for `UPSCALE_CHANNEL_IDS`**

Find the two existing hidden inputs (around line 545) and add a third:

```html
        <input type="hidden" id="ALLOWED_CHANNEL_IDS" name="ALLOWED_CHANNEL_IDS" />
        <input type="hidden" id="TEXT_CHANNEL_IDS" name="TEXT_CHANNEL_IDS" />
        <input type="hidden" id="UPSCALE_CHANNEL_IDS" name="UPSCALE_CHANNEL_IDS" />
```

- [ ] **Step 2: Add Upscaler HTML section**

Insert after the closing `</div>` of the `<!-- CHAT -->` section (around line 638) and before `<!-- SESSION -->`:

```html
      <!-- UPSCALER -->
      <div class="section">
        <div class="section-title">Upscaler</div>

        <div id="upscaler-channel-list"></div>
        <button type="button" id="btn-add-upscaler-channel" class="btn" style="margin-bottom:16px;">+ Thêm channel</button>

        <div class="field">
          <label for="UPSCAYL_BIN_PATH">Bin Path</label>
          <div class="field-input-wrap">
            <input type="text" id="UPSCAYL_BIN_PATH" name="UPSCAYL_BIN_PATH"
              placeholder="/Applications/Upscayl.app/Contents/Resources/bin/upscayl-bin"
              autocomplete="off" />
          </div>
        </div>
        <p class="field-hint">Đường dẫn tới binary <code style="color:#a78bfa">upscayl-bin</code>. Mặc định: trong <strong style="color:#a78bfa">Upscayl.app</strong>. Cài Upscayl tại <code>brew install --cask upscayl</code> nếu chưa có.</p>

        <div class="field">
          <label for="UPSCAYL_MODELS_PATH">Models Path</label>
          <div class="field-input-wrap">
            <input type="text" id="UPSCAYL_MODELS_PATH" name="UPSCAYL_MODELS_PATH"
              placeholder="/Applications/Upscayl.app/Contents/Resources/models"
              autocomplete="off" />
          </div>
        </div>
        <p class="field-hint">Thư mục chứa các AI model của Upscayl. Thường nằm cùng thư mục với binary.</p>

        <div class="field">
          <label for="UPSCALE_SCALE">Scale</label>
          <div class="field-input-wrap">
            <select id="UPSCALE_SCALE" name="UPSCALE_SCALE">
              <option value="2">2x — Nhanh, file nhỏ hơn</option>
              <option value="4">4x — Mặc định, cân bằng chất lượng</option>
              <option value="8">8x — Chậm, file rất lớn</option>
            </select>
          </div>
        </div>
        <p class="field-hint">Hệ số phóng to ảnh. <strong style="color:#a78bfa">4x</strong> là lựa chọn tốt nhất cho hầu hết trường hợp.</p>

        <div class="field">
          <label for="UPSCALE_MODEL">Model</label>
          <div class="field-input-wrap">
            <select id="UPSCALE_MODEL" name="UPSCALE_MODEL">
              <option value="upscayl-standard-4x">upscayl-standard-4x — Đa năng (mặc định)</option>
              <option value="upscayl-lite-4x">upscayl-lite-4x — Nhẹ, nhanh hơn</option>
              <option value="high-fidelity-4x">high-fidelity-4x — Giữ chi tiết cao</option>
              <option value="remacri-4x">remacri-4x — Ảnh thực tế</option>
              <option value="ultramix-balanced-4x">ultramix-balanced-4x — Cân bằng</option>
              <option value="ultrasharp-4x">ultrasharp-4x — Sắc nét</option>
              <option value="digital-art-4x">digital-art-4x — Anime / Digital art</option>
            </select>
          </div>
        </div>
        <p class="field-hint">AI model dùng để upscale. Với game art / anime chọn <strong style="color:#a78bfa">digital-art-4x</strong>. Với ảnh chụp thực tế chọn <strong style="color:#a78bfa">remacri-4x</strong> hoặc <strong style="color:#a78bfa">high-fidelity-4x</strong>.</p>
      </div>
```

- [ ] **Step 3: Add upscaler keys to the `KEYS` array**

Find the `KEYS` constant (around line 726) and add the five new keys:

```javascript
    const KEYS = [
      'DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'ALLOWED_CHANNEL_IDS', 'TEXT_CHANNEL_IDS',
      'UPSCALE_CHANNEL_IDS', 'ERROR_CHANNEL_ID',
      'CLIPROXY_API_URL', 'CLIPROXY_API_KEY',
      'IMAGE_MODEL', 'IMAGE_SIZE',
      'CHAT_MODEL',
      'UPSCAYL_BIN_PATH', 'UPSCAYL_MODELS_PATH', 'UPSCALE_SCALE', 'UPSCALE_MODEL',
      'SESSION_HISTORY_LIMIT', 'SESSION_EXPIRE_MINUTES',
      'CHANNEL_QUEUE_MAX_PENDING',
      'OPENAI_API_KEY',
    ];
```

- [ ] **Step 4: Add JS channel manager functions for Upscaler**

Insert after the Text Channel Manager block (after line ~1254, before the `// Sequential to avoid race condition` comment):

```javascript
    // ── Upscaler Channel Manager ───────────────────────────────────────────────

    /** Rebuild UPSCALE_CHANNEL_IDS hidden input from current upscaler channel cards. */
    function syncUpscalerChannelIds() {
      const ids = [];
      document.querySelectorAll('#upscaler-channel-list .channel-card').forEach(card => {
        const id = card.querySelector('.channel-id-input')?.value.trim();
        if (id) ids.push(id);
      });
      document.getElementById('UPSCALE_CHANNEL_IDS').value = ids.join(',');
    }

    function renderUpscalerChannelCard(channelId = '') {
      const card = document.createElement('div');
      card.className = 'channel-card';
      card.style.borderColor = '#7c3aed';
      const cachedName = channelId && channelNameCache[channelId]
        ? '#' + channelNameCache[channelId] : '';
      card.innerHTML = \`
        <div class="channel-id-row">
          <input type="text" placeholder="Channel ID (e.g. 123456789012345678)"
                 value="\${channelId}"
                 class="channel-id-input" />
          <button class="btn btn-sm btn-danger btn-delete-channel">🗑️</button>
        </div>
        <div class="channel-name-label">\${cachedName}</div>
        <div class="card-actions">
          <button class="btn btn-sm btn-save btn-save-channel" style="background:#7c3aed;">💾 Save</button>
        </div>
      \`;

      card.querySelector('.btn-save-channel').addEventListener('click', async () => {
        const id = card.querySelector('.channel-id-input').value.trim();
        if (!id) { showToast('Channel ID is required', 'error'); return; }
        syncUpscalerChannelIds();
        try {
          await fetch('/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(collectFormData()),
          });
          await resolveAndApplyNames();
          showToast('Upscaler channel saved!', 'success');
        } catch (err) {
          showToast('Error: ' + err.message, 'error');
        }
      });

      card.querySelector('.btn-delete-channel').addEventListener('click', async () => {
        card.remove();
        syncUpscalerChannelIds();
        try {
          await fetch('/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(collectFormData()),
          });
          showToast('Upscaler channel removed', 'success');
        } catch (err) {
          showToast('Error: ' + err.message, 'error');
        }
      });

      return card;
    }

    async function loadUpscalerChannels() {
      try {
        const r = await fetch('/api/config');
        const config = await r.json();
        const ids = (config.UPSCALE_CHANNEL_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
        const container = document.getElementById('upscaler-channel-list');
        container.innerHTML = '';
        for (const id of ids) {
          container.appendChild(renderUpscalerChannelCard(id));
        }
        document.getElementById('UPSCALE_CHANNEL_IDS').value = ids.join(',');
        await resolveAndApplyNames();
      } catch (err) {
        showToast('Failed to load upscaler channels: ' + err.message, 'error');
      }
    }

    document.getElementById('btn-add-upscaler-channel').addEventListener('click', () => {
      document.getElementById('upscaler-channel-list')
        .appendChild(renderUpscalerChannelCard(''));
    });
```

- [ ] **Step 5: Add `loadUpscalerChannels()` to the init chain**

Find the line (around line 1257):

```javascript
    loadUnifiedChannels().then(() => loadTextChannels());
```

Replace with:

```javascript
    loadUnifiedChannels().then(() => loadTextChannels()).then(() => loadUpscalerChannels());
```

- [ ] **Step 6: Manual smoke test of Config UI**

```bash
npm run config-ui
# Open http://localhost:3456 in browser
```

Verify:
- Upscaler section is visible with purple channel cards
- Scale dropdown defaults to 4x
- Model dropdown shows all 7 options
- Can add a channel ID, click Save → UPSCALE_CHANNEL_IDS appears in `.env`
- Can delete a channel → removed from `.env`
- Bin Path / Models Path fields load from `.env` and save correctly

- [ ] **Step 7: Commit**

```bash
git add tools/config-ui/server.ts
git commit -m "feat: add Upscaler section to Config UI (channels + settings)"
```

---

## Self-Review Checklist

**Spec coverage:**
- [x] User posts image → bot auto-detects in dedicated channel ✓ (handler checks attachment)
- [x] Bot replies ⏳ immediately ✓
- [x] Downloads to temp file → runs upscayl-bin → uploads result ✓
- [x] Preset 4x ✓ (default, configurable via Config UI)
- [x] Configurable via Config UI ✓ (Task 47)
- [x] Binary not found → error message + ErrorReporter ✓
- [x] Non-image attachment → ignored ✓
- [x] Temp file cleanup in finally ✓
- [x] No new npm packages ✓ (child_process, fs, os, path are built-ins)
- [x] Feature Registry pattern ✓ (createUpscalerFeature returns Feature)

**Type consistency:**
- `UpscalerOptions` defined in `client.ts`, consumed in `index.ts` ✓
- `createUpscalerHandler(client: UpscalerClient)` — `UpscalerClient` is the same class in both files ✓
- `config.upscaler.scale` / `.model` / `.channelIds` — same field names in `Config` interface and `loadConfig()` ✓
- `ctx.config.upscaler` accessible because `FeatureContext.config` is type `Config` ✓

**No placeholders scan:** All steps contain actual code. ✓
