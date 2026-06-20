import Database from 'better-sqlite3';

export type ImageStatType = 'generate' | 'edit';

function localDate(): string {
  return new Date().toLocaleDateString('sv'); // YYYY-MM-DD in local time
}

export class StatsStore {
  constructor(private readonly db: Database.Database) {}

  /** Increment counter for today. Safe to call fire-and-forget. */
  increment(type: ImageStatType): void {
    const date = localDate();
    const col = type === 'generate' ? 'generates' : 'edits';
    // Upsert today's row
    this.db.prepare(`
      INSERT INTO image_stats (date, generates, edits) VALUES (?, 0, 0)
      ON CONFLICT(date) DO NOTHING
    `).run(date);
    this.db.prepare(`UPDATE image_stats SET ${col} = ${col} + 1 WHERE date = ?`).run(date);
  }

  /** Stats for today. */
  getToday(): { generates: number; edits: number } {
    const row = this.db.prepare(
      'SELECT generates, edits FROM image_stats WHERE date = ?'
    ).get(localDate()) as { generates: number; edits: number } | undefined;
    return row ?? { generates: 0, edits: 0 };
  }

  /** Stats aggregated over the last N days (including today). */
  getLastDays(days: number): { generates: number; edits: number } {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days + 1);
    const cutoffDate = cutoff.toLocaleDateString('sv');
    const row = this.db.prepare(`
      SELECT COALESCE(SUM(generates), 0) AS generates,
             COALESCE(SUM(edits), 0)     AS edits
      FROM image_stats WHERE date >= ?
    `).get(cutoffDate) as { generates: number; edits: number };
    return row;
  }
}
