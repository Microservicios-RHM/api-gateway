/**
 * Métricas en formato Prometheus (Reto 8) con prom-client.
 *
 * Los nombres y etiquetas son los mismos en los 7 servicios del ecosistema, para que el
 * dashboard de Grafana use una sola consulta por panel:
 *   - http_requests_total{method, route, status}            contador
 *   - http_request_duration_seconds{method, route, status}  histograma (_bucket, _sum, _count)
 *   - process_cpu_seconds_total, process_resident_memory_bytes, nodejs_*  (métricas por defecto)
 *
 * `route` es la plantilla de la ruta, nunca la URL concreta: con el id real cada empleado crearía
 * una serie nueva y Prometheus se saturaría (alta cardinalidad). En el Gateway las peticiones
 * reenviadas no tienen ruta de Express, así que se etiquetan con el prefijo del servicio de destino
 * (/empleados, /vacaciones...): es justo la vista "por servicio" que necesita el dashboard.
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

export const UNMATCHED_ROUTE = 'unmatched';

export interface HttpMetrics {
  readonly registry: Registry;
  readonly middleware: RequestHandler;
  readonly handler: RequestHandler;
}

export type RouteLabeler = (req: Request) => string;

export function createHttpMetrics(
  serviceName: string,
  collectDefaults = true,
  routeLabel: RouteLabeler = routeTemplate,
): HttpMetrics {
  const registry = new Registry();
  registry.setDefaultLabels({ service: serviceName });
  if (collectDefaults) collectDefaultMetrics({ register: registry });

  const requests = new Counter({
    name: 'http_requests_total',
    help: 'Total de peticiones HTTP recibidas, por método, ruta y código de respuesta',
    labelNames: ['method', 'route', 'status'] as const,
    registers: [registry],
  });
  const duration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'Tiempo de respuesta de las peticiones HTTP en segundos',
    labelNames: ['method', 'route', 'status'] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
    registers: [registry],
  });

  const middleware: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
    if (req.path === '/metrics') {
      next();
      return;
    }
    const stopTimer = duration.startTimer();
    res.once('finish', () => {
      const labels = { method: req.method, route: routeLabel(req), status: String(res.statusCode) };
      requests.inc(labels);
      stopTimer(labels);
    });
    next();
  };

  const handler: RequestHandler = async (_req: Request, res: Response) => {
    res.setHeader('Content-Type', registry.contentType);
    res.end(await registry.metrics());
  };

  return { registry, middleware, handler };
}

export function routeTemplate(req: Pick<Request, 'baseUrl' | 'route'>): string {
  const routePath: unknown = req.route?.path;
  if (typeof routePath !== 'string') return UNMATCHED_ROUTE;
  const template = `${req.baseUrl ?? ''}${routePath}`;
  return template.length > 1 && template.endsWith('/') ? template.slice(0, -1) : template || '/';
}

/** Etiqueta del Gateway: prefijo del servicio de destino, o la ruta propia (/health). */
export function createPrefixLabeler(prefixes: readonly string[]): RouteLabeler {
  return (req) => {
    const ownRoute = routeTemplate(req);
    if (ownRoute !== UNMATCHED_ROUTE) return ownRoute;
    const path = req.originalUrl.split('?')[0];
    return prefixes.find((prefix) => path === prefix || path.startsWith(`${prefix}/`)) ?? UNMATCHED_ROUTE;
  };
}
