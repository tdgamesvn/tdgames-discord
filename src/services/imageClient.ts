import FormData from 'form-data';
import PQueue from 'p-queue';

export interface ImageGenerationParams {
  prompt: string;
  model: string;
  size: string;
}

export interface ImageEditItem {
  buffer: Buffer;
  name: string;
}

export interface ImageEditParams {
  /** One or more reference images (multi-image edit supported by gpt-image-1). */
  images: ImageEditItem[];
  prompt: string;
  model: string;
  size: string;
}

export interface ImageGenerationResult {
  buffer: Buffer;
  usedFallback: boolean;
}

interface ApiResponse {
  data: Array<{ url?: string; b64_json?: string }>;
}

// Fallback delays (ms) when Retry-After header is not available: 5s → 10s → 20s
const FALLBACK_RETRY_DELAYS_MS = [5_000, 10_000, 20_000];

// Max retry-after we'll honour from the API (2 minutes) — cap to avoid indefinite waits
const MAX_RETRY_AFTER_MS = 120_000;

// HTTP status codes that should be retried (transient errors)
const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Custom error carrying HTTP context ──────────────────────────────────────

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    /** Delay the API asked us to wait (ms), or null if not provided. */
    public readonly retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
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

/** Build an ApiError from a non-ok response, extracting Retry-After when present. */
async function buildApiError(response: Response): Promise<ApiError> {
  let retryAfterMs = parseRetryAfter(response);

  // Also check response body for retry_after (OpenAI / CLIProxy style)
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

  return new ApiError(
    `CLIProxy API error ${response.status}: ${response.statusText}`,
    response.status,
    retryAfterMs,
  );
}

// ─── ImageClient ─────────────────────────────────────────────────────────────

export class ImageClient {
  /** Global queue — serialises all outgoing API calls to respect rate limits. */
  private readonly globalQueue: PQueue;

  constructor(
    private readonly apiUrl: string,
    private readonly apiKey: string,
    private readonly fallbackApiKey?: string,
    private readonly fallbackApiUrl: string = 'https://api.openai.com',
    maxConcurrent: number = 1,
  ) {
    this.globalQueue = new PQueue({ concurrency: maxConcurrent });
  }

  // ─── Text-to-image ──────────────────────────────────────────────────────────

  async generate(params: ImageGenerationParams): Promise<ImageGenerationResult> {
    const result = await this.globalQueue.add(async () => {
      try {
        const r = await this._withRetry(() => this._generateRaw(this.apiUrl, this.apiKey, params));
        return { ...r, usedFallback: false };
      } catch (err) {
        if (this.fallbackApiKey && this._isFallbackable(err)) {
          console.warn('[ImageClient] CLIProxy failed, falling back to OpenAI:', (err as Error).message);
          const r = await this._generateRaw(this.fallbackApiUrl, this.fallbackApiKey, params);
          return { ...r, usedFallback: true };
        }
        throw err;
      }
    });
    return result!;
  }

  // ─── Image-to-image (edit) ──────────────────────────────────────────────────

  async edit(params: ImageEditParams): Promise<ImageGenerationResult> {
    const result = await this.globalQueue.add(async () => {
      try {
        const r = await this._withRetry(() => this._editRaw(this.apiUrl, this.apiKey, params));
        return { ...r, usedFallback: false };
      } catch (err) {
        if (this.fallbackApiKey && this._isFallbackable(err)) {
          console.warn('[ImageClient] CLIProxy failed, falling back to OpenAI:', (err as Error).message);
          const r = await this._editRaw(this.fallbackApiUrl, this.fallbackApiKey, params);
          return { ...r, usedFallback: true };
        }
        throw err;
      }
    });
    return result!;
  }

  // ─── Retry with Retry-After awareness ───────────────────────────────────────

  /**
   * Retries `fn` up to FALLBACK_RETRY_DELAYS_MS.length times on transient errors.
   *
   * For 429 responses: uses the Retry-After delay from the API when available,
   * falling back to the fixed delay schedule otherwise.
   * For 502/503/504: always uses the fixed delay schedule.
   */
  private async _withRetry<T>(fn: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await fn();
      } catch (err) {
        const status = err instanceof ApiError ? err.status : this._extractStatus(err);

        if (status !== null && RETRYABLE_STATUSES.has(status) && attempt < FALLBACK_RETRY_DELAYS_MS.length) {
          // Prefer Retry-After from the API (429 only); fall back to fixed schedule
          let delay: number;
          if (err instanceof ApiError && err.retryAfterMs) {
            delay = err.retryAfterMs;
          } else {
            delay = FALLBACK_RETRY_DELAYS_MS[attempt];
          }

          console.warn(
            `[ImageClient] ${status} — retrying in ${(delay / 1000).toFixed(1)}s ` +
            `(attempt ${attempt + 1}/${FALLBACK_RETRY_DELAYS_MS.length}` +
            `${err instanceof ApiError && err.retryAfterMs ? ', from Retry-After' : ''})`
          );
          await sleep(delay);
          continue;
        }

        throw err; // exhausted retries or non-retryable error
      }
    }
  }

  // ─── Raw implementations ────────────────────────────────────────────────────

  private async _generateRaw(
    apiUrl: string,
    apiKey: string,
    params: ImageGenerationParams,
  ): Promise<{ buffer: Buffer }> {
    const response = await fetch(`${apiUrl}/v1/images/generations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: params.model,
        prompt: params.prompt,
        size: params.size,
        n: 1,
      }),
    });

    if (!response.ok) {
      throw await buildApiError(response);
    }

    return this._parseApiResponse(await response.json() as ApiResponse);
  }

  private async _editRaw(
    apiUrl: string,
    apiKey: string,
    params: ImageEditParams,
  ): Promise<{ buffer: Buffer }> {
    const form = new FormData();
    // Append each image as image[] — gpt-image-1 supports multi-image edits
    for (const img of params.images) {
      form.append('image[]', img.buffer, {
        filename: img.name,
        contentType: 'image/png',
      });
    }
    form.append('prompt', params.prompt);
    form.append('model', params.model);
    form.append('size', params.size);
    form.append('n', '1');

    const response = await fetch(`${apiUrl}/v1/images/edits`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...form.getHeaders(),
      },
      body: form.getBuffer(),
    });

    if (!response.ok) {
      throw await buildApiError(response);
    }

    return this._parseApiResponse(await response.json() as ApiResponse);
  }

  // ─── Error classification ────────────────────────────────────────────────────

  /** Extract HTTP status code from error, or null if not found. */
  private _extractStatus(err: unknown): number | null {
    if (err instanceof ApiError) return err.status;
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
      // Fall back on 429 (after retries exhausted) and any 5xx
      return status === 429 || status >= 500;
    }
    // No status code → network/unknown error → fallback
    return err instanceof Error;
  }

  // ─── Shared response parser ─────────────────────────────────────────────────

  private async _parseApiResponse(data: ApiResponse): Promise<{ buffer: Buffer }> {
    const item = data.data?.[0];
    if (!item) throw new Error('No image data returned from API');

    if (item.b64_json) {
      return { buffer: Buffer.from(item.b64_json, 'base64') };
    }

    if (item.url) {
      const imgResp = await fetch(item.url);
      if (!imgResp.ok) throw new Error(`Failed to fetch image from URL: ${imgResp.status}`);
      return { buffer: Buffer.from(await imgResp.arrayBuffer()) };
    }

    throw new Error('API response contains neither b64_json nor url');
  }
}
