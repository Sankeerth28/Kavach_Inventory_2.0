import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient } from './index';

const json = (status: number, body: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status });

const auth = (accessToken: string, refreshToken?: string) => ({
  accessToken,
  refreshToken,
  expiresIn: 900,
  user: { id: 'u1', name: 'A', email: 'a@b.c', phone: null, mustChangePassword: false },
  memberships: [],
});

const expired = () =>
  json(401, { error: { code: 'UNAUTHENTICATED', message: 'Your session has expired.' } });

function setup(mode: 'web' | 'mobile', handler: (url: URL, init: RequestInit) => Response) {
  const calls: { path: string; init: RequestInit }[] = [];
  let stored: string | null = null;
  const onSessionExpired = vi.fn();
  const client = createApiClient({
    baseUrl: 'http://api.test/',
    mode,
    getProjectId: () => 'project-1',
    tokenStore: {
      get: async () => stored,
      set: async (t) => {
        stored = t;
      },
    },
    onSessionExpired,
    fetch: (async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = new URL(String(input));
      calls.push({ path: url.pathname + url.search, init: init ?? {} });
      return handler(url, init ?? {});
    }) as typeof fetch,
  });
  return { client, calls, onSessionExpired, stored: () => stored };
}

const header = (init: RequestInit, name: string) =>
  (init.headers as Record<string, string> | undefined)?.[name];

describe('api client', () => {
  it('sends the bearer token and the project header after login', async () => {
    const t = setup('web', (url) =>
      url.pathname === '/auth/login' ? json(200, auth('access-1')) : json(200, []),
    );
    await t.client.auth.login('a@b.c', 'pw');
    await t.client.stores.list();

    expect(header(t.calls[0]!.init, 'Authorization')).toBeUndefined();
    expect(JSON.parse(t.calls[0]!.init.body as string)).toMatchObject({ client: 'web' });
    expect(t.calls[0]!.init.credentials).toBe('include');
    expect(header(t.calls[1]!.init, 'Authorization')).toBe('Bearer access-1');
    expect(header(t.calls[1]!.init, 'X-Project-Id')).toBe('project-1');
  });

  it('refreshes once on 401 and retries; parallel requests share the refresh', async () => {
    let refreshes = 0;
    const t = setup('mobile', (url, init) => {
      if (url.pathname === '/auth/login') return json(200, auth('old', 'refresh-1'));
      if (url.pathname === '/auth/refresh') {
        refreshes += 1;
        expect(JSON.parse(init.body as string)).toEqual({ refreshToken: 'refresh-1' });
        return json(200, auth('new', 'refresh-2'));
      }
      return header(init, 'Authorization') === 'Bearer new' ? json(200, []) : expired();
    });
    await t.client.auth.login('a@b.c', 'pw');
    const [a, b] = await Promise.all([t.client.stores.list(), t.client.units.list()]);
    expect([a, b]).toEqual([[], []]);
    expect(refreshes).toBe(1);
    expect(t.stored()).toBe('refresh-2');
    expect(t.onSessionExpired).not.toHaveBeenCalled();
  });

  it('reports an expired session when the refresh fails, and forgets the tokens', async () => {
    const t = setup('mobile', (url) =>
      url.pathname === '/auth/login' ? json(200, auth('old', 'refresh-1')) : expired(),
    );
    await t.client.auth.login('a@b.c', 'pw');
    await expect(t.client.stores.list()).rejects.toMatchObject({ status: 401 });
    expect(t.onSessionExpired).toHaveBeenCalledTimes(1);
    expect(t.stored()).toBeNull();
    expect(t.client.auth.isSignedIn()).toBe(false);
  });

  it('does not try to refresh after a wrong password', async () => {
    const t = setup('web', () =>
      json(401, { error: { code: 'INVALID_CREDENTIALS', message: 'Wrong login or password.' } }),
    );
    await expect(t.client.auth.login('a@b.c', 'bad')).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
      message: 'Wrong login or password.',
    });
    expect(t.calls).toHaveLength(1);
  });

  it('turns API errors into ApiError with code and details, and never retries a 403 or 409', async () => {
    const t = setup('web', () =>
      json(409, {
        error: { code: 'POSSIBLE_DUPLICATE', message: 'Similar material.', details: { x: 1 } },
      }),
    );
    const error = await t.client.materials
      .create({ name: 'x', categoryId: 'c', stockUnitId: 'u' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, code: 'POSSIBLE_DUPLICATE', details: { x: 1 } });
    expect(t.calls).toHaveLength(1);
  });

  it('a network failure is not a logout: the stored refresh token survives', async () => {
    let online = true;
    const t = setup('mobile', (url) => {
      if (!online) throw new TypeError('Network request failed');
      return url.pathname === '/auth/login' ? json(200, auth('old', 'refresh-1')) : expired();
    });
    await t.client.auth.login('a@b.c', 'pw');
    online = false;
    await expect(t.client.stores.list()).rejects.toMatchObject({ code: 'NETWORK' });
    expect(t.stored()).toBe('refresh-1');
    expect(t.onSessionExpired).not.toHaveBeenCalled();
  });

  it('builds query strings without empty values', async () => {
    const t = setup('web', () => json(200, { items: [], total: 0, page: 1, pageSize: 25 }));
    await t.client.materials.list({ q: 'tmt 12', status: undefined, page: 2 });
    expect(t.calls[0]!.path).toBe('/materials?q=tmt%2012&page=2');
  });

  it('uploads a document page as raw bytes and downloads it as a file', async () => {
    const t = setup('web', (url) => {
      if (url.pathname === '/auth/login') return json(200, auth('access-1'));
      if (url.pathname.endsWith('/content')) {
        return new Response(new Blob(['%PDF-1.4'], { type: 'application/pdf' }), { status: 200 });
      }
      return json(201, { id: 'inv-1' });
    });
    await t.client.auth.login('a@b.c', 'pw');
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    await t.client.invoices.uploadPage('inv-1', bytes, 'application/pdf', 'bill nov.pdf');
    const upload = t.calls.at(-1)!;
    expect(upload.path).toBe('/invoices/inv-1/pages');
    expect(upload.init.body).toBe(bytes);
    expect(header(upload.init, 'Content-Type')).toBe('application/pdf');
    expect(header(upload.init, 'X-File-Name')).toBe('bill%20nov.pdf');
    expect(header(upload.init, 'Authorization')).toBe('Bearer access-1');

    const file = await t.client.invoices.pageContent('inv-1', 1);
    expect(await file.text()).toBe('%PDF-1.4');
  });

  it('sends the idempotency key with Confirm & Receive', async () => {
    const t = setup('web', (url) =>
      url.pathname === '/auth/login' ? json(200, auth('access-1')) : json(201, { id: 'p1' }),
    );
    await t.client.auth.login('a@b.c', 'pw');
    await t.client.invoices.confirm('inv-1', 4, 'key-1234567890123456');
    const call = t.calls.at(-1)!;
    expect(call.path).toBe('/invoices/inv-1/confirm');
    expect(call.init.body).toBe(JSON.stringify({ version: 4 }));
    expect(header(call.init, 'Idempotency-Key')).toBe('key-1234567890123456');
  });
});
