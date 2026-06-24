import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ImageClient, ApiError } from '../src/features/image-gen/client';

function mockFetch(response: object) {
  return vi.fn().mockResolvedValue({
    ok: true,
    ...response,
  });
}

/** Mock a failed fetch response with optional Retry-After header. */
function mockFetchError(status: number, statusText: string, retryAfter?: string) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    statusText,
    headers: {
      get: (name: string) => (name.toLowerCase() === 'retry-after' ? (retryAfter ?? null) : null),
    },
    json: async () => ({}),
  });
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers(); // restore in case a test activated fake timers
});

describe('ImageClient', () => {
  const API_URL = 'https://cliproxy.example.com';
  const API_KEY = 'test-key';

  it('calls the correct endpoint with auth header', async () => {
    const fetchMock = mockFetch({
      json: async () => ({ data: [{ b64_json: Buffer.from('fake-image').toString('base64') }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new ImageClient(API_URL, API_KEY);
    await client.generate({ prompt: 'a cat', model: 'gpt-image-1', size: '1024x1024' });

    expect(fetchMock).toHaveBeenCalledWith(
      `${API_URL}/v1/images/generations`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: `Bearer ${API_KEY}`,
          'Content-Type': 'application/json',
        }),
      })
    );
  });

  it('sends correct body params', async () => {
    const fetchMock = mockFetch({
      json: async () => ({ data: [{ b64_json: 'aGVsbG8=' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new ImageClient(API_URL, API_KEY);
    await client.generate({ prompt: 'a dragon', model: 'gpt-image-1', size: '1792x1024' });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ model: 'gpt-image-1', prompt: 'a dragon', size: '1792x1024', n: 1 });
  });

  it('returns a Buffer from b64_json response', async () => {
    const original = Buffer.from('fake-image-bytes');
    vi.stubGlobal('fetch', mockFetch({
      json: async () => ({ data: [{ b64_json: original.toString('base64') }] }),
    }));

    const client = new ImageClient(API_URL, API_KEY);
    const result = await client.generate({ prompt: 'test', model: 'gpt-image-1', size: '1024x1024' });

    expect(Buffer.isBuffer(result.buffer)).toBe(true);
    expect(result.buffer.equals(original)).toBe(true);
  });

  it('fetches and returns a Buffer when API returns URL', async () => {
    const imgBytes = Buffer.from('img-data');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ url: 'https://cdn.example.com/img.png' }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => imgBytes.buffer,
      });
    vi.stubGlobal('fetch', fetchMock);

    const client = new ImageClient(API_URL, API_KEY);
    const result = await client.generate({ prompt: 'test', model: 'dall-e-3', size: '1024x1024' });

    expect(Buffer.isBuffer(result.buffer)).toBe(true);
  });

  it('throws ApiError on non-2xx response', async () => {
    // The retry logic sleeps on 429 — use fake timers so the test doesn't actually wait.
    vi.useFakeTimers();
    vi.stubGlobal('fetch', mockFetchError(429, 'Too Many Requests'));

    const client = new ImageClient(API_URL, API_KEY);
    const promise = client.generate({ prompt: 'test', model: 'gpt-image-1', size: '1024x1024' });

    // Attach the rejection handler BEFORE advancing timers.
    const assertion = expect(promise).rejects.toThrow('429');

    // Drain all retry sleeps instantly
    await vi.runAllTimersAsync();

    await assertion;
  });

  it('uses Retry-After header delay when provided', async () => {
    vi.useFakeTimers();

    // Return 429 with Retry-After: 30 (seconds) on every call
    vi.stubGlobal('fetch', mockFetchError(429, 'Too Many Requests', '30'));

    const client = new ImageClient(API_URL, API_KEY);
    const promise = client.generate({ prompt: 'test', model: 'gpt-image-1', size: '1024x1024' });

    const assertion = expect(promise).rejects.toThrow('429');

    await vi.runAllTimersAsync();
    await assertion;
  });

  it('respects retry_after in response body for 429', async () => {
    vi.useFakeTimers();

    // 429 with no Retry-After header, but retry_after in body
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      headers: { get: () => null },
      json: async () => ({ retry_after: 15.5 }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new ImageClient(API_URL, API_KEY);
    const promise = client.generate({ prompt: 'test', model: 'gpt-image-1', size: '1024x1024' });

    const assertion = expect(promise).rejects.toThrow('429');

    await vi.runAllTimersAsync();
    await assertion;
  });

  it('throws when API returns no image data', async () => {
    vi.stubGlobal('fetch', mockFetch({
      json: async () => ({ data: [] }),
    }));

    const client = new ImageClient(API_URL, API_KEY);
    await expect(
      client.generate({ prompt: 'test', model: 'gpt-image-1', size: '1024x1024' })
    ).rejects.toThrow();
  });

  it('falls back to OpenAI when CLIProxy returns 5xx', async () => {
    const FALLBACK_KEY = 'openai-fallback-key';
    const FALLBACK_URL = 'https://api.openai.com';
    const successData = { data: [{ b64_json: Buffer.from('fallback-image').toString('base64') }] };

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        headers: { get: () => null },
        json: async () => ({}),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => successData });
    vi.stubGlobal('fetch', fetchMock);

    const client = new ImageClient(API_URL, API_KEY, FALLBACK_KEY, FALLBACK_URL);
    const result = await client.generate({ prompt: 'test', model: 'gpt-image-1', size: '1024x1024' });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe(`${FALLBACK_URL}/v1/images/generations`);
    expect((fetchMock.mock.calls[1][1] as RequestInit).headers).toMatchObject({
      Authorization: `Bearer ${FALLBACK_KEY}`,
    });
    expect(Buffer.isBuffer(result.buffer)).toBe(true);
  });

  it('does NOT fallback on 4xx errors (except 429)', async () => {
    const FALLBACK_KEY = 'openai-fallback-key';

    vi.stubGlobal('fetch', mockFetchError(400, 'Bad Request'));

    const client = new ImageClient(API_URL, API_KEY, FALLBACK_KEY);
    await expect(
      client.generate({ prompt: 'test', model: 'gpt-image-1', size: '1024x1024' })
    ).rejects.toThrow('400');

    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });
});
