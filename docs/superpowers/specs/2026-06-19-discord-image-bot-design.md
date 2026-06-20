# Design Spec — Discord Image Generation Bot

_Ngày: 2026-06-19_  
_Project: tdgames-discord_  
_Trạng thái: Approved_

---

## 1. Tổng quan

Bot Discord cho TDGames Studio hỗ trợ tạo ảnh bằng AI. User mention bot trong các channel được phép, bot gọi CliproxyAPI (selfhost trên Mac, OpenAI-compatible) để generate ảnh và trả về channel.

Bot hỗ trợ:
- **Text-to-image**: Tạo ảnh từ prompt văn bản
- **Image-to-image**: Edit ảnh dựa trên ảnh user upload hoặc ảnh vừa tạo
- **Session/Context**: Mỗi user có lịch sử 10 lượt, có thể refine ảnh liên tục
- **Per-channel queue**: Tránh overload, các channel xử lý song song

---

## 2. Tech Stack

| Layer | Công nghệ |
|-------|-----------|
| Runtime | Node.js 20 (LTS) |
| Language | TypeScript |
| Discord library | discord.js v14 |
| HTTP client | Native `fetch` (built-in Node 20) |
| Database | SQLite (`better-sqlite3`) |
| Queue | `p-queue` |
| Multipart upload | `form-data` |

---

## 3. Cấu trúc thư mục

```
tdgames-discord/
├── src/
│   ├── index.ts                  # Entry point: load env, start bot
│   ├── bot.ts                    # Discord client setup, register event handlers
│   ├── config.ts                 # Load & validate .env, export typed config
│   ├── handlers/
│   │   └── messageCreate.ts      # Handle mention events, route to queue
│   ├── services/
│   │   ├── imageService.ts       # generate(prompt) | edit(imageBuffer, prompt)
│   │   ├── sessionStore.ts       # SQLite CRUD for user sessions
│   │   └── queueManager.ts      # Per-channel p-queue instances
│   └── db/
│       └── schema.ts             # Init SQLite DB, create tables
├── data/
│   └── sessions.db               # SQLite file (gitignored)
├── .env                          # Secrets (gitignored)
├── .env.example                  # Template
├── package.json
├── tsconfig.json
└── .gitignore
```

---

## 4. Configuration (`.env`)

```env
# Discord
DISCORD_TOKEN=                        # Bot token từ Discord Developer Portal
DISCORD_CLIENT_ID=                    # Application ID

# Channel whitelist (comma-separated channel IDs)
ALLOWED_CHANNEL_IDS=123456789,987654321

# CliproxyAPI
CLIPROXY_API_URL=http://localhost:8317
CLIPROXY_API_KEY=                     # Bearer token

# Image settings
IMAGE_MODEL=gpt-image-1
IMAGE_SIZE=1024x1024

# Session
SESSION_HISTORY_LIMIT=10              # Max entries per user per channel
SESSION_EXPIRE_MINUTES=30             # Auto-expire sau X phút không dùng

# Queue
CHANNEL_QUEUE_MAX_PENDING=5           # Max pending requests per channel
```

---

## 5. Data Flow

### 5.1 Text-to-image (lần đầu hoặc sau reset)

```
User: "@TDBot vẽ con rồng bay trên Hà Nội"
  ↓
[messageCreate handler]
  → Kiểm tra channel trong ALLOWED_CHANNEL_IDS? (không → ignore)
  → Parse mention, tách prompt
  → Prompt rỗng? → reply hướng dẫn, stop
  → Prompt = "reset"? → xóa session, reply xác nhận, stop
  ↓
[queueManager] — enqueue vào channel queue
  → Queue đầy (> MAX_PENDING)? → reply "Channel đang bận", stop
  → Reply: "⏳ Đang tạo ảnh... (vị trí #N)"
  ↓
[sessionStore] — load history của (userId, channelId)
  ↓
[imageService.generate(prompt, history)]
  → POST http://localhost:8317/v1/images/generations
  → Body: { model, prompt, n: 1, size, response_format: "b64_json" }
  ↓
  ← { data: [{ b64_json: "..." }] }
  ↓
[sessionStore] — append entry vào history, trim về limit 10
  ↓
Bot reply: gửi ảnh (Buffer từ b64) về channel
```

### 5.2 Image-to-image (refine ảnh trước)

```
User: "@TDBot làm tối hơn, thêm hiệu ứng sương mù"
  ↓
[messageCreate handler]
  → Không có attachment → kiểm tra session có lastImageUrl?
  → Có lastImageUrl → chế độ edit
  ↓
[imageService.edit(lastImageBuffer, newPrompt)]
  → Download ảnh từ lastImageUrl về Buffer
  → POST http://localhost:8317/v1/images/edits (multipart/form-data)
  → Fields: { image: Buffer, prompt, model, size }
  ↓
  ← { data: [{ b64_json: "..." }] }
  ↓
[sessionStore] — update lastImageUrl, append history
  ↓
Bot reply: gửi ảnh mới về channel
```

### 5.3 Image-to-image (user upload ảnh)

```
User: [đính kèm file ảnh] + "@TDBot tạo lại theo style anime"
  ↓
[messageCreate handler]
  → Phát hiện attachment (image/*)
  → Download attachment từ Discord CDN về Buffer
  ↓
[imageService.edit(attachmentBuffer, prompt)]
  → POST /v1/images/edits (multipart)
  ↓
Bot reply: gửi ảnh mới về channel
```

---

## 6. Session Storage (SQLite)

### Schema

```sql
CREATE TABLE IF NOT EXISTS sessions (
  user_id     TEXT NOT NULL,
  channel_id  TEXT NOT NULL,
  history     TEXT NOT NULL DEFAULT '[]',  -- JSON array
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, channel_id)
);
```

### History entry format

```typescript
type HistoryEntry =
  | { role: 'user';  prompt: string }
  | { role: 'bot';   prompt: string; imageUrl: string };
```

### Session rules
- Max `SESSION_HISTORY_LIMIT` (10) entries — FIFO, trim oldest khi vượt
- Expire: khi đọc session, nếu `updated_at` cũ hơn `SESSION_EXPIRE_MINUTES` → treat như session mới (không xóa ngay). Cleanup thật sự chạy khi bot khởi động (xóa tất cả rows có `updated_at` quá hạn).
- `@TDBot reset` → xóa hẳn session của (userId, channelId)
- `lastImageUrl`: derive từ history — tìm entry cuối cùng có `role: 'bot'` và lấy `imageUrl` của nó. Không có cột riêng trong DB. Lưu ý: Discord CDN URL của ảnh bot gửi không expire (attachment URL), nên an toàn để download lại khi edit.

---

## 7. Queue Management

```typescript
// queueManager.ts
const queues = new Map<string, PQueue>(); // key = channelId

function getQueue(channelId: string): PQueue {
  if (!queues.has(channelId)) {
    queues.set(channelId, new PQueue({ concurrency: 1 }));
  }
  return queues.get(channelId)!;
}
```

- **Concurrency per channel**: 1 (sequential)
- **Channels**: xử lý parallel với nhau (mỗi channel có queue riêng)
- **Max pending**: `CHANNEL_QUEUE_MAX_PENDING` (5) — nếu đầy → reject với message thân thiện
- **Timeout per job**: 90 giây (60s API + 30s buffer) — nếu quá → reply lỗi timeout

---

## 8. Error Handling

| Tình huống | Phản hồi bot |
|-----------|-------------|
| Channel không trong whitelist | Ignore hoàn toàn |
| Mention không có prompt | `"💡 Nhập mô tả ảnh sau @mention. VD: @TDBot vẽ con rồng bay trên Hà Nội"` |
| Prompt > 4000 ký tự | `"⚠️ Prompt quá dài, vui lòng rút ngắn lại."` |
| Channel queue đầy (> 5 pending) | `"⏳ Channel đang bận, vui lòng thử lại sau ít phút."` |
| CliproxyAPI timeout (> 60s) | `"⏱️ API quá tải, thử lại sau ít phút."` |
| CliproxyAPI lỗi 4xx/5xx | `"❌ Không tạo được ảnh: [message từ API]"` |
| Bot thiếu quyền gửi file trong channel | Log lỗi, silent fail |
| Attachment không phải ảnh | `"⚠️ Chỉ hỗ trợ file ảnh (jpg, png, webp)."` |

---

## 9. Logging

Format mỗi request:
```
[2026-06-19 10:30:15] #ai-art | user#1234 | mode: generate | prompt: "vẽ con rồng..." | status: OK | 12.3s
[2026-06-19 10:31:02] #image-gen | user#5678 | mode: edit | prompt: "làm tối hơn" | status: ERROR | API 500
```

Log to stdout (console). Không cần file log hay database logging ở scale hiện tại.

---

## 10. Discord Bot Permissions cần thiết

- `Read Messages / View Channels`
- `Send Messages`
- `Attach Files`
- `Read Message History`
- `Add Reactions` (optional, cho ⏳ reaction khi đang xử lý)

**Intents cần bật:**
- `GatewayIntentBits.Guilds`
- `GatewayIntentBits.GuildMessages`
- `GatewayIntentBits.MessageContent` (Privileged — phải bật trong Developer Portal)

---

## 11. Không có trong scope (YAGNI)

- ❌ Web dashboard
- ❌ Admin commands
- ❌ Rate limit per user (scale 5–10 không cần)
- ❌ Image gallery / history browsing
- ❌ Slash commands (mention là đủ)
- ❌ Multi-guild support phức tạp
- ❌ Redis / message broker

---

## 12. Các quyết định kiến trúc

| Quyết định | Lý do |
|-----------|-------|
| SQLite thay vì in-memory | Session persist khi bot restart |
| p-queue thay vì Bull/BullMQ | Không cần Redis, đủ cho scale nhỏ |
| `response_format: "b64_json"` | Không cần lưu file tạm, gửi trực tiếp từ memory |
| Sequential queue per channel | Tránh spam API, UX rõ ràng (biết thứ tự chờ) |
| Mention thay vì slash command | Đơn giản hơn, không cần register command |
