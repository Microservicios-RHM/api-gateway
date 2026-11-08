import { readFileSync } from 'node:fs';
import express, { type RequestHandler, type Response } from 'express';
import { createProxyMiddleware, type Options } from 'http-proxy-middleware';
import swaggerUi from 'swagger-ui-express';
import { Counter, Registry, collectDefaultMetrics } from 'prom-client';
import { context, propagation, SpanKind, trace } from '@opentelemetry/api';
import { startTelemetry } from './telemetry.ts';
import { createAuthGuard } from './security.ts';
import { sendErrorResponse } from './responses.ts';
import { openApiDocument } from './openapi.ts';

const jwtSecret = process.env.JWT_SECRET || readSecretFile(process.env.JWT_SECRET_FILE);
const port = parsePort(process.env.PORT);
startTelemetry();
const empleadosServiceUrl = requireUrl(
  process.env.EMPLEADOS_SERVICE_URL,
  'EMPLEADOS_SERVICE_URL',
);
const departamentosServiceUrl = requireUrl(
  process.env.DEPARTAMENTOS_SERVICE_URL,
  'DEPARTAMENTOS_SERVICE_URL',
);
const notificacionesServiceUrl = requireUrl(
  process.env.NOTIFICACIONES_SERVICE_URL,
  'NOTIFICACIONES_SERVICE_URL',
);
const perfilesServiceUrl = requireUrl(
  process.env.PERFILES_SERVICE_URL,
  'PERFILES_SERVICE_URL',
);
const vacacionesServiceUrl = requireUrl(
  process.env.VACACIONES_SERVICE_URL,
  'VACACIONES_SERVICE_URL',
);
const authServiceUrl = requireUrl(process.env.AUTH_SERVICE_URL, 'AUTH_SERVICE_URL');
const security = {
  secret: requireSecret(jwtSecret),
  issuer: process.env.JWT_ISSUER ?? 'auth-service',
};

const app = express();
const metricsRegistry = new Registry();
collectDefaultMetrics({ register: metricsRegistry, prefix: 'rhm_gateway_' });
const httpRequests = new Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests handled by the Gateway',
  labelNames: ['service', 'method', 'status'] as const,
  registers: [metricsRegistry],
});

app.disable('x-powered-by');
app.use((request, response, next) => {
  const extractedContext = propagation.extract(context.active(), request.headers);
  trace.getTracer('api-gateway').startActiveSpan(
    `${request.method} ${request.path}`,
    { kind: SpanKind.SERVER, attributes: { 'http.request.method': request.method, 'url.path': request.path } },
    extractedContext,
    (span) => {
      response.on('finish', () => {
        span.setAttribute('http.response.status_code', response.statusCode);
        span.end();
      });
      next();
    },
  );
});
app.use((request, response, next) => {
  response.on('finish', () => httpRequests.inc({ service: 'api-gateway', method: request.method, status: String(response.statusCode) }));
  next();
});
app.get('/metrics', async (_request, response) => {
  response.setHeader('Content-Type', metricsRegistry.contentType);
  response.send(await metricsRegistry.metrics());
});
app.get('/openapi.json', (_request, response) => response.json(openApiDocument));
app.use('/swagger', swaggerUi.serve, swaggerUi.setup(openApiDocument));
app.get('/health', async (_request, response) => {
  const dependencies = {
    empleados: empleadosServiceUrl,
    departamentos: departamentosServiceUrl,
    notificaciones: notificacionesServiceUrl,
    perfiles: perfilesServiceUrl,
    vacaciones: vacacionesServiceUrl,
    auth: authServiceUrl,
  };
  const checks = Object.fromEntries(await Promise.all(Object.entries(dependencies).map(async ([name, url]) => {
    try {
      const result = await fetch(`${url}/health`, { signal: AbortSignal.timeout(2_000) });
      return [name, result.ok ? 'UP' : 'DOWN'];
    } catch {
      return [name, 'DOWN'];
    }
  }))) as Record<string, 'UP' | 'DOWN'>;
  const status = Object.values(checks).every((value) => value === 'UP') ? 'UP' : 'DOWN';
  response.status(status === 'UP' ? 200 : 503).json({ status, service: 'api-gateway', checks });
});

app.use(createAuthGuard(security));

app.use(
  createServiceProxy('/auth', authServiceUrl),
  createServiceProxy('/empleados', empleadosServiceUrl),
  createServiceProxy('/departamentos', departamentosServiceUrl),
  createServiceProxy('/notificaciones', notificacionesServiceUrl),
  createServiceProxy('/perfiles', perfilesServiceUrl),
  createServiceProxy('/vacaciones', vacacionesServiceUrl),
);

app.use((request, response) => {
  sendErrorResponse(
    response,
    404,
    'Recurso no encontrado',
    'RESOURCE_NOT_FOUND',
    request.originalUrl,
  );
});

app.listen(port, '0.0.0.0', () => {
  console.log(`API Gateway listening on port ${port}`);
});

function createServiceProxy(path: string, target: string): RequestHandler {
  const options: Options = {
    target,
    changeOrigin: true,
    pathFilter: path,
    on: {
      proxyReq: (proxyRequest) => {
        const headers: Record<string, string> = {};
        propagation.inject(context.active(), headers);
        for (const [name, value] of Object.entries(headers)) proxyRequest.setHeader(name, value);
      },
      error: (error, request, response) => {
        console.error(`Upstream unavailable for ${request.url}: ${error.message}`);
        sendUnavailable(response, request.url ?? '/');
      },
    },
  };

  return createProxyMiddleware(options) as RequestHandler;
}

function sendUnavailable(response: unknown, path: string): void {
  sendErrorResponse(
    response as Response,
    503,
    'Servicio upstream no disponible',
    'UPSTREAM_SERVICE_UNAVAILABLE',
    path,
  );
}

function parsePort(value: string | undefined): number {
  const parsed = Number(value ?? '8080');
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error('PORT debe ser un número entero entre 1 y 65535');
  }
  return parsed;
}

function requireSecret(value: string | undefined): string {
  if (!value) throw new Error('Falta la variable de entorno JWT_SECRET');
  if (value.length < 16) throw new Error('JWT_SECRET debe tener al menos 16 caracteres');
  return value;
}

function readSecretFile(path: string | undefined): string | undefined {
  return path ? readFileSync(path, 'utf8').trim() : undefined;
}

function requireUrl(value: string | undefined, name: string): string {
  if (!value) throw new Error(`Falta la variable de entorno ${name}`);
  try {
    return new URL(value).toString().replace(/\/$/, '');
  } catch {
    throw new Error(`${name} debe ser una URL válida`);
  }
}
