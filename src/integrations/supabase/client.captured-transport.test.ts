import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ create: vi.fn(), previewStorage: vi.fn(), globalToken: 'synthetic-global-A', storage: {} }));
vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.create }));
vi.mock('./previewAuthStorage', () => ({ brokeredPreviewStorage: mocks.previewStorage }));
beforeEach(() => {
  vi.resetModules(); vi.stubEnv('VITE_SUPABASE_URL', 'https://synthetic.invalid'); vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'synthetic-public-key');
  mocks.create.mockReset(); mocks.previewStorage.mockReset().mockReturnValue(mocks.storage); mocks.globalToken = 'synthetic-global-A';
  mocks.create.mockImplementation((_url: string, _key: string, options: { accessToken?: () => Promise<string> }) => {
    const token = () => options.accessToken ? options.accessToken() : Promise.resolve(mocks.globalToken);
    const functions = { invoke: vi.fn(async function (this: unknown) { return { data: { token: await token(), bound: this === functions }, error: null }; }), setAuth: vi.fn() };
    const storage = { from: vi.fn(function (this: unknown, bucket: string) { return { bucket, bound: this === storage }; }) };
    const client = {
      from: vi.fn(function (this: unknown, table: string) { return { table, bound: this === client }; }),
      rpc: vi.fn(async function (this: unknown) { return { data: { token: await token(), bound: this === client }, error: null }; }),
      functions, storage, auth: { signOut: vi.fn() }, channel: vi.fn(),
    };
    return client;
  });
});
afterEach(() => vi.unstubAllEnvs());

describe('canonical stateless captured-bearer data transport', () => {
  it('leaves the ordinary brokered shared client configuration unchanged', async () => {
    const { supabase } = await import('./client');
    expect(mocks.create).toHaveBeenCalledExactlyOnceWith('https://synthetic.invalid', 'synthetic-public-key', {
      auth: { storage: mocks.storage, persistSession: true, autoRefreshToken: true },
    });
    expect(mocks.previewStorage).toHaveBeenCalledTimes(1);
    expect(supabase).toHaveProperty('auth');
  });
  it('uses a static top-level accessToken and immutable header after the global actor changes', async () => {
    const { supabase, createCapturedBearerTransport } = await import('./client');
    const owned = createCapturedBearerTransport('synthetic-captured-A');
    const [url, key, options] = mocks.create.mock.calls[1];
    expect([url, key]).toEqual(['https://synthetic.invalid', 'synthetic-public-key']);
    expect(options.accessToken).toBeTypeOf('function');
    expect(options.auth).toBeUndefined(); // SDK custom accessToken bypasses its GoTrue lifecycle.
    expect(options.global.headers.Authorization).toBe('Bearer synthetic-captured-A');
    mocks.globalToken = 'synthetic-global-B';
    expect(await options.accessToken()).toBe('synthetic-captured-A');
    expect(await owned.rpc('owned_probe', {})).toEqual({ data: { token: 'synthetic-captured-A', bound: true }, error: null });
    expect(await supabase.rpc('owned_probe' as never)).toEqual({ data: { token: 'synthetic-global-B', bound: true }, error: null });
    expect(await owned.functions.invoke('owned_probe')).toEqual({ data: { token: 'synthetic-captured-A', bound: true }, error: null });
    expect(mocks.previewStorage).toHaveBeenCalledTimes(1);
  });
  it('exposes only frozen bound data methods, with no auth, channels, raw SDK or mutable function auth', async () => {
    const { createCapturedBearerTransport } = await import('./client');
    const owned = createCapturedBearerTransport('synthetic-captured-A');
    expect(Object.keys(owned).sort()).toEqual(['from', 'functions', 'rpc', 'storage']);
    expect(Object.keys(owned.functions)).toEqual(['invoke']); expect(Object.keys(owned.storage)).toEqual(['from']);
    expect(Object.isFrozen(owned)).toBe(true); expect(Object.isFrozen(owned.functions)).toBe(true); expect(Object.isFrozen(owned.storage)).toBe(true);
    expect(owned).not.toHaveProperty('auth'); expect(owned).not.toHaveProperty('channel'); expect(owned.functions).not.toHaveProperty('setAuth');
    expect(owned.from('profiles')).toEqual({ table: 'profiles', bound: true });
    expect(owned.storage.from('telegram-media')).toEqual({ bucket: 'telegram-media', bound: true });
  });
  it('rejects missing, oversized and whitespace-bearing tokens before constructing another client', async () => {
    const { createCapturedBearerTransport } = await import('./client');
    for (const value of [undefined, null, '', 'synthetic token', 'synthetic\nheader', 'x'.repeat(16385)]) {
      expect(() => createCapturedBearerTransport(value as string)).toThrow('Captured bearer required');
    }
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });
  it('enforces captured Authorization at the final fetch boundary despite caller header overrides', async () => {
    const { createCapturedBearerTransport } = await import('./client');
    createCapturedBearerTransport('synthetic-captured-A');
    const send = mocks.create.mock.calls[1][2].global.fetch as typeof fetch;
    const network = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', network);
    try {
      const signal = new AbortController().signal;
      await send('https://synthetic.invalid/rest/v1/profiles', { method: 'POST', body: '{}', signal, credentials: 'omit', headers: { authorization: 'Bearer synthetic-B', 'x-test': 'preserved' } });
      let headers = new Headers(network.mock.calls[0][1].headers);
      expect(headers.get('authorization')).toBe('Bearer synthetic-captured-A'); expect(headers.get('x-test')).toBe('preserved');
      expect(network.mock.calls[0][1]).toMatchObject({ method: 'POST', body: '{}', credentials: 'omit' });
      expect(network.mock.calls[0][1].signal).toBe(signal);
      const request = new Request('https://synthetic.invalid/rest/v1/profiles', { headers: { Authorization: 'Bearer synthetic-B', 'x-original': 'preserved' } });
      await send(request, { headers: new Headers({ AUTHORIZATION: 'Bearer synthetic-C' }) });
      headers = new Headers(network.mock.calls[1][1].headers);
      expect(headers.get('authorization')).toBe('Bearer synthetic-captured-A'); expect(headers.get('x-original')).toBe('preserved');
    } finally { vi.unstubAllGlobals(); }
  });
});
