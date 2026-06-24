import PQueue from 'p-queue';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionParams {
  model: string;
  messages: ChatMessage[];
  maxTokens?: number;
}

export interface ChatCompletionResult {
  content: string;
}

interface ApiChatResponse {
  choices: Array<{
    message: { role: string; content: string };
    finish_reason: string;
  }>;
}

// Fallback delays (ms) when Retry-After header is not available: 5s → 10s → 20s
const FALLBACK_RETRY_DELAYS_MS = [5_000, 10_000, 20_000];

// Max retry-after we'll honour from the API (2 minutes)
const MAX_RETRY_AFTER_MS = 120_000;

// HTTP status codes that should be retried (transient errors)
const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Parse the Retry-After header (seconds) into milliseconds. */
function parseRetryAfter(response: Response): number | null {
  const header = response.headers.get('retry-after');
  if (!header) return null;

  const seconds = parseFloat(header);
  if (isNaN(seconds) || seconds <= 0) return null;

  const ms = Math.ceil(seconds * 1000);
  return Math.min(ms, MAX_RETRY_AFTER_MS);
}

// ─── ChatClient ─────────────────────────────────────────────────────────────

export class ChatClient {
  /** Global queue — serialises all outgoing API calls to respect rate limits. */
  private readonly globalQueue: PQueue;

  constructor(
    private readonly apiUrl: string,
    private readonly apiKey: string,
    private readonly fallbackApiKey?: string,
    private readonly fallbackApiUrl: string = 'https://api.openai.com',
    private readonly fallbackModel: string = 'gpt-4o-mini',
    maxConcurrent: number = 1,
  ) {
    this.globalQueue = new PQueue({ concurrency: maxConcurrent });
  }

  async complete(params: ChatCompletionParams): Promise<ChatCompletionResult> {
    const result = await this.globalQueue.add(async () => {
      try {
        return await this._withRetry(() => this._completeRaw(this.apiUrl, this.apiKey, params));
      } catch (err) {
        if (this.fallbackApiKey && this._isFallbackable(err)) {
          console.warn('[ChatClient] CLIProxy failed, falling back to OpenAI:', (err as Error).message);
          // Use fallback model since CLIProxy models aren't available on OpenAI
          const fallbackParams = { ...params, model: this.fallbackModel };
          return await this._completeRaw(this.fallbackApiUrl, this.fallbackApiKey, fallbackParams);
        }
        throw err;
      }
    });
    return result!;
  }

  // ─── Retry with Retry-After awareness ───────────────────────────────────────

  private async _withRetry<T>(fn: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await fn();
      } catch (err) {
        const status = this._extractStatus(err);

        if (status !== null && RETRYABLE_STATUSES.has(status) && attempt < FALLBACK_RETRY_DELAYS_MS.length) {
          let delay = FALLBACK_RETRY_DELAYS_MS[attempt];

          // Check for Retry-After in error message (from 429 responses)
          if (err instanceof ChatApiError && err.retryAfterMs) {
            delay = err.retryAfterMs;
          }

          console.warn(
            `[ChatClient] ${status} — retrying in ${(delay / 1000).toFixed(1)}s ` +
            `(attempt ${attempt + 1}/${FALLBACK_RETRY_DELAYS_MS.length})`
          );
          await sleep(delay);
          continue;
        }

        throw err;
      }
    }
  }

  // ─── Raw implementation ────────────────────────────────────────────────────

  private async _completeRaw(
    apiUrl: string,
    apiKey: string,
    params: ChatCompletionParams,
  ): Promise<ChatCompletionResult> {
    const response = await fetch(`${apiUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: params.model,
        messages: params.messages,
        max_tokens: params.maxTokens ?? 2000,
      }),
    });

    if (!response.ok) {
      throw await this._buildApiError(response);
    }

    const data = (await response.json()) as ApiChatResponse;
    const choice = data.choices?.[0];
    if (!choice?.message?.content) {
      throw new Error('No content returned from chat API');
    }

    return { content: choice.message.content };
  }

  // ─── Error handling ─────────────────────────────────────────────────────────

  private async _buildApiError(response: Response): Promise<ChatApiError> {
    let retryAfterMs = parseRetryAfter(response);

    if (response.status === 429 && !retryAfterMs) {
      try {
        const body = (await response.json()) as { retry_after?: number };
        if (typeof body.retry_after === 'number' && body.retry_after > 0) {
          retryAfterMs = Math.min(
            Math.ceil(body.retry_after * 1000),
            MAX_RETRY_AFTER_MS,
          );
        }
      } catch {
        // Body not JSON — ignore
      }
    }

    return new ChatApiError(
      `Chat API error ${response.status}: ${response.statusText}`,
      response.status,
      retryAfterMs,
    );
  }

  private _extractStatus(err: unknown): number | null {
    if (err instanceof ChatApiError) return err.status;
    if (err instanceof Error) {
      const match = err.message.match(/error (\d+):/i);
      return match ? parseInt(match[1], 10) : null;
    }
    return null;
  }

  /** True when we should fall back to OpenAI: 5xx, 429-exhausted, or network errors. */
  private _isFallbackable(err: unknown): boolean {
    const status = this._extractStatus(err);
    if (status !== null) {
      return status === 429 || status >= 500;
    }
    return err instanceof Error;
  }
}

export class ChatApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = 'ChatApiError';
  }
}
