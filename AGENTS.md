# AGENTS.md — tdgames-discord

## Scope

Agent làm việc trong project này chỉ được phép:
- Đọc/ghi file trong `/Users/tdgames_mac01/Work/apps/tdgames-discord/`
- Chạy lệnh dev/build/test liên quan đến project này
- Cập nhật `.agent/meta/` sau mỗi session

## Off-limits

- Không thay đổi config VPS/production mà không có approval
- Không commit token, secret, .env lên git
- Không sửa file ngoài scope project này

## Memory Files

| File | Mục đích |
|------|---------|
| `.agent/meta/PROJECT.md` | Tổng quan project, tech stack, cấu trúc |
| `.agent/meta/TASKS.md` | Task tracking (To do / Doing / Done) |
| `.agent/meta/LOG.md` | Nhật ký session theo ngày |
| `.agent/meta/DECISIONS.md` | Quyết định kỹ thuật quan trọng |
| `.agent/WORKFLOW.md` | Quy trình làm việc của agent |
