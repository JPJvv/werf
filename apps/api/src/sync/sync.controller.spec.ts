import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../config/config';
import type { AuthContext } from '../auth/auth.guard';
import type { TokenService } from '../auth/token.service';
import { SyncController } from './sync.controller';

const AUTH: AuthContext = { userId: 'user-123', sessionId: 'sess-1', activeFarmId: null };

describe('SyncController — GET /sync/token', () => {
  it("mints a token for the CALLER's own id, never a client-supplied one", async () => {
    const signPowerSyncToken = vi.fn().mockResolvedValue({
      token: 'signed.jwt.token',
      expiresAt: new Date('2026-01-01T00:15:00Z'),
    });
    const controller = new SyncController(
      { signPowerSyncToken } as unknown as TokenService,
      { powerSyncUrl: 'http://localhost:8080' } as AppConfig,
    );

    const result = await controller.token(AUTH);

    expect(signPowerSyncToken).toHaveBeenCalledOnce();
    expect(signPowerSyncToken).toHaveBeenCalledWith('user-123');
    expect(result).toEqual({
      token: 'signed.jwt.token',
      endpoint: 'http://localhost:8080',
      expiresAt: '2026-01-01T00:15:00.000Z',
    });
  });
});
