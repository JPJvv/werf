import { describe, expect, it, vi } from 'vitest';
import { createSyncConnector } from '../src/connector';

describe('createSyncConnector — fetchCredentials', () => {
  it('returns null when signed out, without calling the API', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const connector = createSyncConnector({
      apiBaseUrl: '/api',
      getAccessToken: async () => null,
    });
    const credentials = await connector.fetchCredentials();

    expect(credentials).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("fetches /sync/token with the caller's access token and parses a real response shape", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        token: 'signed.jwt.token',
        endpoint: 'http://localhost:8080',
        expiresAt: '2026-01-01T00:15:00.000Z',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const connector = createSyncConnector({
      apiBaseUrl: '/api',
      getAccessToken: async () => 'my-access-token',
    });
    const credentials = await connector.fetchCredentials();

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/sync/token',
      expect.objectContaining({ headers: { Authorization: 'Bearer my-access-token' } }),
    );
    expect(credentials).toEqual({
      endpoint: 'http://localhost:8080',
      token: 'signed.jwt.token',
      expiresAt: new Date('2026-01-01T00:15:00.000Z'),
    });
    vi.unstubAllGlobals();
  });

  it('throws on a non-ok response rather than returning malformed credentials', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));

    const connector = createSyncConnector({
      apiBaseUrl: '/api',
      getAccessToken: async () => 'expired-token',
    });

    await expect(connector.fetchCredentials()).rejects.toThrow(/401/);
    vi.unstubAllGlobals();
  });

  it('rejects a response shape the schema does not recognise, rather than passing it through', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ nonsense: true }) }),
    );

    const connector = createSyncConnector({
      apiBaseUrl: '/api',
      getAccessToken: async () => 'my-access-token',
    });

    await expect(connector.fetchCredentials()).rejects.toThrow();
    vi.unstubAllGlobals();
  });
});

describe('createSyncConnector — uploadData', () => {
  it('resolves quietly when nothing is queued — the common case for this slice', async () => {
    const connector = createSyncConnector({ apiBaseUrl: '/api', getAccessToken: async () => null });
    const database = { getCrudBatch: vi.fn().mockResolvedValue(null) };

    await expect(connector.uploadData(database as never)).resolves.toBeUndefined();
  });

  it('⛔ throws rather than silently draining a real queued write — no route to a domain endpoint yet', async () => {
    // db.md: "the write queue is never discarded by the system." A write that reaches the CRUD
    // queue with nowhere honest to send it must stay visibly queued, never complete()d — see
    // connector.ts's own header for why a generic passthrough isn't the fix (phase-checklists.md
    // 3c/3d owns per-table routing).
    const connector = createSyncConnector({ apiBaseUrl: '/api', getAccessToken: async () => null });
    const complete = vi.fn();
    const database = {
      getCrudBatch: vi.fn().mockResolvedValue({ crud: [{ id: '1', table: 'farms' }], complete }),
    };

    await expect(connector.uploadData(database as never)).rejects.toThrow(/3c\/3d/);
    expect(complete).not.toHaveBeenCalled();
  });
});
