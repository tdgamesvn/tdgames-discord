# Cài đặt Discord Bot qua launchd (macOS)

## Yêu cầu

- macOS (dùng launchd thay vì systemd)
- Node.js đã cài tại `/usr/local/bin/node` (hoặc chỉnh lại path trong plist)
- File `.env` đã có đủ biến môi trường tại thư mục gốc project

---

## Cài lần đầu

### 1. Copy plist vào LaunchAgents

```bash
cp deploy/com.tdgames.discord-bot.plist ~/Library/LaunchAgents/
```

### 2. Load service

```bash
launchctl load ~/Library/LaunchAgents/com.tdgames.discord-bot.plist
```

### 3. Start service

```bash
launchctl start com.tdgames.discord-bot
```

Bot sẽ tự khởi động lại khi máy restart (do `RunAtLoad` và `KeepAlive` = true).

---

## Quản lý service

### Xem trạng thái

```bash
launchctl list | grep tdgames
```

Cột đầu là PID (nếu đang chạy), cột cuối là exit code lần trước (0 = OK).

Xem log realtime:
```bash
tail -f logs/bot.log
tail -f logs/bot.error.log
```

### Stop service

```bash
launchctl stop com.tdgames.discord-bot
```

### Restart service

```bash
launchctl stop com.tdgames.discord-bot && launchctl start com.tdgames.discord-bot
```

### Gỡ cài đặt (unload)

```bash
launchctl unload ~/Library/LaunchAgents/com.tdgames.discord-bot.plist
```

---

## Cập nhật plist (sau khi chỉnh sửa file)

```bash
launchctl unload ~/Library/LaunchAgents/com.tdgames.discord-bot.plist
cp deploy/com.tdgames.discord-bot.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.tdgames.discord-bot.plist
launchctl start com.tdgames.discord-bot
```

---

## Ghi chú

- PID file được ghi tại `data/bot.pid` khi bot khởi động, và bị xóa khi shutdown.
- Log được lưu tại `logs/bot.log` và `logs/bot.error.log` (không được commit vào git).
- Nếu Node.js cài qua Homebrew (Apple Silicon), đổi path thành `/opt/homebrew/bin/node`.
