export interface ImageGenerationParams {
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
      throw new Error(
        `Cliproxy API error: ${response.status} ${response.statusText}`
      );
    }

    const data = (await response.json()) as ApiResponse;
    const item = data.data?.[0];

    if (!item) {
      throw new Error('No image data returned from API');
    }

    // Prefer b64_json (gpt-image-1 always returns this)
    if (item.b64_json) {
      return { buffer: Buffer.from(item.b64_json, 'base64') };
    }

    // Fallback: fetch from URL (dall-e-2/3 style)
    if (item.url) {
      const imgResp = await fetch(item.url);
      if (!imgResp.ok) {
        throw new Error(`Failed to fetch image from URL: ${imgResp.status}`);
      }
      const arrayBuffer = await imgResp.arrayBuffer();
      return { buffer: Buffer.from(arrayBuffer) };
    }

    throw new Error('API response contains neither b64_json nor url');
  }
}
