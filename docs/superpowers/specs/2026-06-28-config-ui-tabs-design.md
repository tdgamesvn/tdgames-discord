# Spec: Config UI — Tab Layout Redesign

_Date: 2026-06-28_
_Status: Approved by user_

---

## Bối cảnh

`tools/config-ui/server.ts` hiện là 1 file 1888 dòng với HTML/CSS/JS nhúng thẳng vào TypeScript template literal. Khi UI mở rộng (Chat Storage admin, nhiều feature), mọi thứ cuộn theo chiều dọc không có navigation. Cần chia thành tabs để:
- Dễ navigate khi cài đặt
- Tách biệt config của từng feature
- Giảm cognitive load khi mở UI

---

## Phạm vi (Scope)

**In scope:**
- Chuyển layout hiện tại từ dọc → 7-tab
- Giữ nguyên toàn bộ API endpoints (không thêm/xóa backend)
- Giữ dark theme hiện tại
- Responsive tab header (wrap khi hẹp)

**Out of scope:**
- Tách server.ts thành nhiều file (chỉ refactor HTML/JS bên trong)
- Thêm tính năng mới
- Authentication / access control

---

## Tab Structure

### Tab 1 — 📊 Overview
**Nội dung:**
- Stats bar: "Hôm nay" + "7 ngày qua" (dùng `/api/stats`)
- Bot status dot (green/red) + label (`/api/bot-status`, poll 10s)
- Nút 🔄 Restart Bot (`/api/restart`)
- Read-only — không có nút Save

**Mapping env keys:** không có (read-only dashboard)

---

### Tab 2 — 🖼 Image Gen
**Nội dung:**
- Image Channels — danh sách card (channel ID + system prompt), Add/Delete
- IMAGE_MODEL — text input
- IMAGE_SIZE — select (auto / 1024x1024 / 1536x1024 / 1024x1536)
- IMAGE_FALLBACK_MODEL — text input (OpenAI fallback model)
- OPENAI_API_KEY — password field
- Nút 💾 **Save Image Gen**

**Env keys saved:**
`IMAGE_CHANNEL_IDS`, `IMAGE_MODEL`, `IMAGE_SIZE`, `IMAGE_FALLBACK_MODEL`, `OPENAI_API_KEY`

**Channel prompts:** lưu qua `/api/channel-prompts` (endpoint riêng, không phải `.env`)

---

### Tab 3 — 💬 Text Chat
**Nội dung:**
- Text Channels — danh sách card (channel ID + system prompt), Add/Delete
- CHAT_MODEL — text input
- CHAT_FALLBACK_MODEL — text input
- Nút 💾 **Save Text Chat**

**Env keys saved:**
`TEXT_CHANNEL_IDS`, `CHAT_MODEL`, `CHAT_FALLBACK_MODEL`

---

### Tab 4 — ⬆️ Upscaler
**Nội dung:**
- Upscaler Channels — danh sách card (channel ID only), Add/Delete
- UPSCAYL_BIN_PATH — text input
- UPSCAYL_MODELS_PATH — text input
- UPSCALE_SCALE — select (2x / 4x / 8x)
- UPSCALE_MODEL — select (digital-art-4x / realesrgan-x4plus / ...)
- Nút 💾 **Save Upscaler**

**Env keys saved:**
`UPSCALER_CHANNEL_IDS`, `UPSCAYL_BIN_PATH`, `UPSCAYL_MODELS_PATH`, `UPSCALE_SCALE`, `UPSCALE_MODEL`

---

### Tab 5 — 🧠 Intelligence
**Nội dung:**
- Summary stats bar: Messages indexed / 24h / Channels indexed / Backfill status (từ `/api/chat-storage/summary`)
- Agent Groups editor: CRUD groups (group_key, display_name, agent_key, description)
- Indexed Channels list: checkbox assign vào group
- Nút 🔁 Sync Agent Access (gọi `/api/chat-storage/agent-access/sync`)
- Nút ↻ Refresh (reload summary + channels + groups)

**API endpoints dùng:** `/api/chat-storage/*` (không dùng `.env`)

---

### Tab 6 — ⚙️ Settings
**Nội dung — 4 sub-sections:**

**Discord:**
- DISCORD_TOKEN — password field
- DISCORD_CLIENT_ID — text input
- ERROR_CHANNEL_ID — text input (+ resolve channel name)

**CLIProxy:**
- CLIPROXY_API_URL — text input
- CLIPROXY_API_KEY — password field
- Nút 🔌 Test Connection (gọi `/api/test/cliproxy`, hiện status inline)

**Session:**
- SESSION_HISTORY_LIMIT — number input
- SESSION_EXPIRE_MINUTES — number input

**Queue:**
- QUEUE_MAX_PENDING — number input

**Nút 💾 Save Settings** — save tất cả các key trên

---

### Tab 7 — 📋 Logs
**Nội dung:**
- Log file selector: dropdown (bot.log, bot-error.log, config-ui.log, ...)
- Nút ↻ Refresh
- Log content viewer: `<pre>` với overflow-y scroll, monospace font
- Read-only

**API endpoint:** `/api/logs?file=<name>` (đã có)

---

## UI Architecture

### HTML Structure

```html
<div class="tabs-nav">
  <button class="tab-btn active" data-tab="overview">📊 Overview</button>
  <button class="tab-btn" data-tab="image-gen">🖼 Image Gen</button>
  ...
</div>
<div id="tab-overview" class="tab-panel active">...</div>
<div id="tab-image-gen" class="tab-panel">...</div>
...
```

### Tab switching (pure JS, no library)
```js
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
  });
});
```

### CSS
- Tab nav: `display:flex; flex-wrap:wrap; gap:4px; border-bottom:1px solid #2d2d4e`
- Tab btn active: `background:#7c3aed; color:#fff`
- Tab btn inactive: `background:#1a1a2e; color:#7c7ca8; hover:#2d2d4e`
- Tab panel: `display:none` default, `.active { display:block }`

---

## File Structure (sau refactor)

**Không tách file** — vẫn giữ `tools/config-ui/server.ts` là 1 file.

Lý do: tách file sẽ cần build step hoặc module bundler. Hiện tại file chạy trực tiếp với `tsx`. Refactor nội bộ (tách functions `renderOverviewTab()`, `renderImageGenTab()`, ...) đủ để quản lý.

Cấu trúc internal:

```
server.ts
├── imports & setup
├── getDb()
├── parseEnv() / writeEnv()
├── renderHtml()
│   ├── renderTabNav()
│   ├── renderOverviewTab()
│   ├── renderImageGenTab()
│   ├── renderTextChatTab()
│   ├── renderUpscalerTab()
│   ├── renderIntelligenceTab()
│   ├── renderSettingsTab()
│   └── renderLogsTab()
├── renderClientJS()          ← toàn bộ JS frontend (tab switching + per-tab logic)
└── app.get/post routes
```

---

## Save Behavior

| Tab | Save action | Restart bot? |
|-----|-------------|--------------|
| Overview | — | Nút riêng: Restart |
| Image Gen | Save image env + channel prompts | Không tự động |
| Text Chat | Save text env + channel prompts | Không tự động |
| Upscaler | Save upscaler env | Không tự động |
| Intelligence | API calls riêng | Không |
| Settings | Save global env | Không tự động |
| Logs | — | — |

> **Note:** Loại bỏ pattern "Save & Restart Bot" hiện tại. User tự bấm Restart trên tab Overview nếu muốn. Đơn giản hơn, tránh restart nhầm khi chỉ muốn save.

---

## Migration

Không cần migration data. Tất cả dữ liệu hiện tại (`.env`, `channel_prompts`, SQLite) giữ nguyên. Chỉ là UI refactor thuần.

---

## Verification

- [ ] Tất cả 7 tab render không lỗi
- [ ] Tab switching không reload trang
- [ ] Save từng tab chỉ ghi đúng env keys của tab đó
- [ ] Bot status poll vẫn hoạt động
- [ ] Channels load đúng từ Discord API
- [ ] CLIProxy Test Connection hiển thị kết quả
- [ ] Intelligence tab: groups CRUD + channel assign + sync
- [ ] Logs tab: load file + refresh
- [ ] `npm run build` clean (không có TypeScript errors)
- [ ] `npm test` vẫn 72 tests passed (server.ts không có unit test riêng)
