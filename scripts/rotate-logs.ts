/**
 * rotate-logs.ts
 *
 * Log rotation script — chạy daily qua launchd (3:00 AM).
 *
 * Hành vi:
 *  1. Với mỗi file log hiện tại (bot.log, config-ui.log, ...):
 *     - Copy nội dung vào logs/archive/YYYY-MM-DD_filename
 *     - Truncate file gốc về 0 byte (an toàn vì launchd dùng O_APPEND)
 *  2. Xoá các file archive có mtime > MAX_AGE_DAYS
 */

import * as fs from 'fs';
import * as path from 'path';

const LOGS_DIR   = path.resolve(__dirname, '../logs');
const ARCHIVE_DIR = path.join(LOGS_DIR, 'archive');
const MAX_AGE_DAYS = 7;

const LOG_FILES = [
  'bot.log',
  'bot.error.log',
  'config-ui.log',
  'config-ui.error.log',
];

// ── Helpers ────────────────────────────────────────────────────────────────

function isoDate(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function log(msg: string) {
  console.log(`[rotate-logs ${new Date().toISOString()}] ${msg}`);
}

// ── Main ───────────────────────────────────────────────────────────────────

// Ensure archive directory exists
fs.mkdirSync(ARCHIVE_DIR, { recursive: true });

const today = isoDate();
let rotated = 0;
let deleted  = 0;

// Step 1 — Rotate current log files
for (const filename of LOG_FILES) {
  const filePath = path.join(LOGS_DIR, filename);
  if (!fs.existsSync(filePath)) continue;

  const stat = fs.statSync(filePath);
  if (stat.size === 0) {
    log(`Skip (empty): ${filename}`);
    continue;
  }

  const archiveName = `${today}_${filename}`;
  const archivePath = path.join(ARCHIVE_DIR, archiveName);

  // Copy content to archive (keep original inode so launchd O_APPEND still works)
  fs.copyFileSync(filePath, archivePath);
  // Truncate original in-place — launchd's O_APPEND will seek to new EOF (0) on next write
  fs.truncateSync(filePath, 0);

  log(`Rotated: ${filename} → archive/${archiveName} (${(stat.size / 1024).toFixed(1)} KB)`);
  rotated++;
}

// Step 2 — Delete archives older than MAX_AGE_DAYS
const cutoffMs = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

for (const file of fs.readdirSync(ARCHIVE_DIR)) {
  const filePath = path.join(ARCHIVE_DIR, file);
  try {
    const stat = fs.statSync(filePath);
    if (stat.mtimeMs < cutoffMs) {
      fs.unlinkSync(filePath);
      log(`Deleted old archive: ${file}`);
      deleted++;
    }
  } catch {
    // ignore stale entries
  }
}

log(`Done. Rotated: ${rotated} files, Deleted: ${deleted} old archives.`);
