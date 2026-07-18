/**
 * Plain, decorator-free health logic so it is unit-testable without a Nest DI container.
 * The controller is a thin transport wrapper around this.
 */
export interface HealthStatus {
  status: 'ok';
  service: 'werf-api';
}

export function getHealth(): HealthStatus {
  return { status: 'ok', service: 'werf-api' };
}
