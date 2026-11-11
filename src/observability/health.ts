/**
 * Health Check API (Reto 8). GET /health verifica de verdad las dependencias del servicio, en
 * vez de responder siempre "UP" (antipatrón "health check vacío"):
 *
 *   200 {"status":"UP","service":"empleados-service","checks":{"database":"UP","messageBroker":"UP"}}
 *   503 {"status":"DOWN", ... "checks":{"database":"DOWN", ...}}
 *
 * Cada chequeo tiene un tiempo límite corto: un health check lento degrada al propio servicio y
 * hace que el healthcheck de Docker lo marque unhealthy por timeout, no por la dependencia.
 */
import type { Request, RequestHandler, Response } from 'express';

export type HealthStatus = 'UP' | 'DOWN';
export type HealthCheck = () => Promise<boolean> | boolean;

export interface HealthReport {
  readonly status: HealthStatus;
  readonly service: string;
  readonly checks: Record<string, HealthStatus>;
}

const DEFAULT_CHECK_TIMEOUT_MS = 2_000;

/**
 * - 'all': UP solo si todas las dependencias están UP (microservicios: sin su base de datos o su
 *   broker no pueden atender).
 * - 'any': UP si al menos una dependencia está UP. Es la política del Gateway: con un servicio
 *   caído sigue enrutando a los demás, así que marcarlo DOWN (y unhealthy en Docker) ocultaría
 *   cuál es el servicio que realmente falló. El detalle por servicio queda en `checks`.
 */
export type HealthPolicy = 'all' | 'any';

export async function evaluateHealth(
  service: string,
  checks: Record<string, HealthCheck>,
  timeoutMs = DEFAULT_CHECK_TIMEOUT_MS,
  policy: HealthPolicy = 'all',
): Promise<HealthReport> {
  const entries = await Promise.all(
    Object.entries(checks).map(async ([name, check]) => {
      const healthy = await withTimeout(Promise.resolve().then(check), timeoutMs).catch(() => false);
      return [name, healthy ? 'UP' : 'DOWN'] as const;
    }),
  );
  const results = Object.fromEntries(entries) as Record<string, HealthStatus>;
  const values = Object.values(results);
  const healthy =
    policy === 'all' ? values.every((value) => value === 'UP') : values.length === 0 || values.includes('UP');
  const status: HealthStatus = healthy ? 'UP' : 'DOWN';
  return { status, service, checks: results };
}

export function createHealthHandler(
  service: string,
  checks: Record<string, HealthCheck>,
  policy: HealthPolicy = 'all',
): RequestHandler {
  return async (_req: Request, res: Response) => {
    const report = await evaluateHealth(service, checks, DEFAULT_CHECK_TIMEOUT_MS, policy);
    res.status(report.status === 'UP' ? 200 : 503).json(report);
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('Health check timed out')), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Check de un servicio vecino: su propio GET /health debe responder 2xx. */
export function upstreamHealthCheck(baseUrl: string, timeoutMs = 1_500): HealthCheck {
  return async () => {
    const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(timeoutMs) });
    return response.ok;
  };
}
