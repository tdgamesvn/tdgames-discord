import Database from 'better-sqlite3';

/**
 * Stat categories:
 * - generate / edit: image via CLIProxy (backward-compat columns)
 * - image_openai:    image via OpenAI fallback
 * - text_cliproxy:   text chat via CLIProxy
 * - text_openai:     text chat via OpenAI fallback
 */
export type StatType = 'generate' | 'edit' | 'image_openai' | 'text_cliproxy' | 'text_openai';

const COL_MAP: Record<StatType, string> = {
  generate: 'generates',
  edit: 'edits',
  image_openai: 'image_openai',
  text_cliproxy: 'text_cliproxy',
  text_openai: 'text_openai',
};

export interface DayStats {
  generates: number;
  edits: number;
  image_openai: number;
  text_cliproxy: number;
  text_openai: number;
}

function localDate(): string {
  return new Date().toLocaleDateString('sv'); // YYYY-MM-DD in local time
}

const EMPTY: DayStats = { generates: 0, edits: 0, image_openai: 0, text_cliproxy: 0, text_openai: 0 };

export class StatsStore {
  constructor(private readonly db: Database.Database) {}

  /** Increment counter for today. Safe to call fire-and-forget. */
  increment(type: StatType): void {
    const date = localDate();
    const col = COL_MAP[type];
    // Upsert today's row
    this.db.prepare(`
      INSERT INTO image_stats (date, generates, edits, image_openai, text_cliproxy, text_openai)
      VALUES (?, 0, 0, 0, 0, 0)
      ON CONFLICT(date) DO NOTHING
    `).run(date);
    this.db.prepare(`UPDATE image_stats SET ${col} = ${col} + 1 WHERE date = ?`).run(date);
  }

  /** Stats for today. */
  getToday(): DayStats {
    const row = this.db.prepare(
      'SELECT generates, edits, image_openai, text_cliproxy, text_openai FROM image_stats WHERE date = ?'
    ).get(localDate()) as DayStats | undefined;
    return row ?? { ...EMPTY };
  }

  /** Stats aggregated over the last N days (including today). */
  getLastDays(days: number): DayStats {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days + 1);
    const cutoffDate = cutoff.toLocaleDateString('sv');
    const row = this.db.prepare(`
      SELECT COALESCE(SUM(generates), 0)     AS generates,
             COALESCE(SUM(edits), 0)          AS edits,
             COALESCE(SUM(image_openai), 0)   AS image_openai,
             COALESCE(SUM(text_cliproxy), 0)  AS text_cliproxy,
             COALESCE(SUM(text_openai), 0)    AS text_openai
      FROM image_stats WHERE date >= ?
    `).get(cutoffDate) as DayStats;
    return row;
  }
}
