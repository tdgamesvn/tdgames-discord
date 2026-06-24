import Database from 'better-sqlite3';

export interface ChannelPrompt {
  channelId: string;
  systemPrompt: string;
  updatedAt: number;
}

export class ChannelPromptStore {
  constructor(private readonly db: Database.Database) {}

  get(channelId: string): string | null {
    const row = this.db
      .prepare('SELECT system_prompt FROM channel_prompts WHERE channel_id = ?')
      .get(channelId) as { system_prompt: string } | undefined;
    return row?.system_prompt ?? null;
  }

  set(channelId: string, systemPrompt: string): void {
    this.db
      .prepare(`INSERT INTO channel_prompts (channel_id, system_prompt, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(channel_id) DO UPDATE SET
          system_prompt = excluded.system_prompt,
          updated_at = excluded.updated_at`)
      .run(channelId, systemPrompt, Date.now());
  }

  delete(channelId: string): void {
    this.db.prepare('DELETE FROM channel_prompts WHERE channel_id = ?').run(channelId);
  }

  list(): ChannelPrompt[] {
    const rows = this.db
      .prepare('SELECT channel_id, system_prompt, updated_at FROM channel_prompts ORDER BY channel_id')
      .all() as Array<{ channel_id: string; system_prompt: string; updated_at: number }>;
    return rows.map((r) => ({
      channelId: r.channel_id,
      systemPrompt: r.system_prompt,
      updatedAt: r.updated_at,
    }));
  }
}
