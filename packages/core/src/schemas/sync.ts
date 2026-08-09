import { z } from 'zod';

/**
 * What `GET /sync/token` returns — the credentials a `PowerSyncBackendConnector`'s
 * `fetchCredentials` hands to the PowerSync client SDK. `endpoint` is the self-hosted
 * PowerSync service's own URL (a separate service from this API, not this API's address).
 */
export const powerSyncCredentialsSchema = z.object({
  token: z.string().min(1),
  endpoint: z.string().url(),
  expiresAt: z.string().datetime({ offset: true }),
});
export type PowerSyncCredentialsResponse = z.infer<typeof powerSyncCredentialsSchema>;
