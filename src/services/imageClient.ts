import FormData from 'form-data';

export interface ImageGenerationParams {
  prompt: string;
  model: string;
  size: string;
}

export interface ImageEditParams {
  imageBuffer: Buffer;
  imageName: string;
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
    private readonly apiKey: string
  ) {}

  // ─── Text-to-image ──────────────────────────────────────────────────────────

  async generate(params: ImageGenerationParams): Promise<ImageGenerationResult> {
    const response = await fetch(`${this.apiUrl}/v1/images/generations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
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

  // ─── Image-to-image (edit) ──────────────────────────────────────────────────

  async edit(params: ImageEditParams): Promise<ImageGenerationResult> {
    const form = new FormData();
    form.append('image', params.imageBuffer, {
      filename: params.imageName,
      contentType: 'image/png',
    });
    form.append('prompt', params.prompt);
    form.append('model', params.model);
    form.append('size', params.size);
    form.append('n', '1');

    const response = await fetch(`${this.apiUrl}/v1/images/edits`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        ...form.getHeaders(),
      },
      body: form.getBuffer(),
    });

    if (!response.ok) {
      throw new Error(`CLIProxy API error ${response.status}: ${response.statusText}`);
    }

    return this._parseApiResponse(await response.json() as ApiResponse);
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
