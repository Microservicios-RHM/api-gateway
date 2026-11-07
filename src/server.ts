import express, { type RequestHandler, type Response } from 'express';
import { createProxyMiddleware, type Options } from 'http-proxy-middleware';
import swaggerUi from 'swagger-ui-express';
import { Counter, Registry, collectDefaultMetrics } from 'prom-client';
import { createAuthGuard } from './security.ts';
import { sendErrorResponse } from './responses.ts';
import { openApiDocument } from './openapi.ts';

const port = parsePort(process.env.PORT);
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
  secret: requireSecret(process.env.JWT_SECRET),
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
  response.on('finish', () => httpRequests.inc({ service: 'api-gateway', method: request.method, status: String(response.statusCode) }));
  next();
});
app.get('/metrics', async (_request, response) => {
  response.setHeader('Content-Type', metricsRegistry.contentType);
  response.send(await metricsRegistry.metrics());
});
app.get('/openapi.json', (_request, response) => response.json(openApiDocument));
app.use('/swagger', swaggerUi.serve, swaggerUi.setup(openApiDocument));
app.get('/health', (_request, response) => {
  response.status(200).json({
    success: true,
    message: 'API Gateway disponible',
    data: { status: 'UP' },
  });
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

function requireUrl(value: string | undefined, name: string): string {
  if (!value) throw new Error(`Falta la variable de entorno ${name}`);
  try {
    return new URL(value).toString().replace(/\/$/, '');
  } catch {
    throw new Error(`${name} debe ser una URL válida`);
  }
}
