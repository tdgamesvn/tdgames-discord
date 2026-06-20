import FormData from 'form-data';

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
}

interface ApiResponse {
  data: Array<{ url?: string; b64_json?: string }>;
}

export class ImageClient {
  constructor(
    private readonly apiUrl: string,
    private readonly apiKey: string,
    private readonly fallbackApiKey?: string,
    private readonly fallbackApiUrl: string = 'https://api.openai.com',
  ) {}

  // ─── Text-to-image ──────────────────────────────────────────────────────────

  async generate(params: ImageGenerationParams): Promise<ImageGenerationResult> {
    try {
      return await this._generateRaw(this.apiUrl, this.apiKey, params);
    } catch (err) {
      if (this.fallbackApiKey && this._isRetryable(err)) {
        console.warn('[ImageClient] CLIProxy failed, falling back to OpenAI:', (err as Error).message);
        return await this._generateRaw(this.fallbackApiUrl, this.fallbackApiKey, params);
      }
      throw err;
    }
  }

  // ─── Image-to-image (edit) ──────────────────────────────────────────────────

  async edit(params: ImageEditParams): Promise<ImageGenerationResult> {
    try {
      return await this._editRaw(this.apiUrl, this.apiKey, params);
    } catch (err) {
      if (this.fallbackApiKey && this._isRetryable(err)) {
        console.warn('[ImageClient] CLIProxy failed, falling back to OpenAI:', (err as Error).message);
        return await this._editRaw(this.fallbackApiUrl, this.fallbackApiKey, params);
      }
      throw err;
    }
  }

  // ─── Raw implementations ────────────────────────────────────────────────────

  private async _generateRaw(
    apiUrl: string,
    apiKey: string,
    params: ImageGenerationParams,
  ): Promise<ImageGenerationResult> {
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
      throw new Error(`CLIProxy API error ${response.status}: ${response.statusText}`);
    }

    return this._parseApiResponse(await response.json() as ApiResponse);
  }

  private async _editRaw(
    apiUrl: string,
    apiKey: string,
    params: ImageEditParams,
  ): Promise<ImageGenerationResult> {
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
      throw new Error(`CLIProxy API error ${response.status}: ${response.statusText}`);
    }

    return this._parseApiResponse(await response.json() as ApiResponse);
  }

  // ─── Retryable error detection ──────────────────────────────────────────────

  private _isRetryable(err: unknown): boolean {
    // Retry on network errors or 5xx; NOT on 4xx (bad prompt, auth)
    if (err instanceof Error) {
      const match = err.message.match(/error (\d+):/i);
      if (match) {
        const status = parseInt(match[1], 10);
        return status >= 500; // 5xx only
      }
      return true; // network/unknown errors → retry
    }
    return false;
  }

  // ─── Shared response parser ─────────────────────────────────────────────────

  private async _parseApiResponse(data: ApiResponse): Promise<ImageGenerationResult> {
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
