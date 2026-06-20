import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ImageClient } from '../src/services/imageClient';

function mockFetch(response: object) {
  return vi.fn().mockResolvedValue({
    ok: true,
    ...response,
  });
}

function mockFetchError(status: number, statusText: string) {
  return vi.fn().mockResolvedValue({ ok: false, status, statusText });
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
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

  it('throws on non-2xx response', async () => {
    vi.stubGlobal('fetch', mockFetchError(429, 'Too Many Requests'));

    const client = new ImageClient(API_URL, API_KEY);
    await expect(
      client.generate({ prompt: 'test', model: 'gpt-image-1', size: '1024x1024' })
    ).rejects.toThrow('429');
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
});
