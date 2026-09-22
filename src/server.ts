import express, { type RequestHandler, type Response } from 'express';
import { createProxyMiddleware, type Options } from 'http-proxy-middleware';

const port = parsePort(process.env.PORT);
const empleadosServiceUrl = requireUrl(
  process.env.EMPLEADOS_SERVICE_URL,
  'EMPLEADOS_SERVICE_URL',
);
const departamentosServiceUrl = requireUrl(
  process.env.DEPARTAMENTOS_SERVICE_URL,
  'DEPARTAMENTOS_SERVICE_URL',
);

const app = express();

app.disable('x-powered-by');
app.get('/health', (_request, response) => {
  response.status(200).json({
    success: true,
    message: 'API Gateway disponible',
    data: { status: 'UP' },
  });
});

app.use(
  createServiceProxy('/empleados', empleadosServiceUrl),
  createServiceProxy('/departamentos', departamentosServiceUrl),
);

app.use((_request, response) => {
  response.status(404).json({
    success: false,
    message: 'Recurso no encontrado',
    data: null,
    error: { code: 'RESOURCE_NOT_FOUND' },
  });
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
        sendUnavailable(response);
      },
    },
  };

  return createProxyMiddleware(options) as RequestHandler;
}

function sendUnavailable(response: unknown): void {
  const httpResponse = response as Response;
  if (httpResponse.headersSent) return;
  httpResponse.status(503).json({
    success: false,
    message: 'Servicio upstream no disponible',
    data: null,
    error: { code: 'UPSTREAM_SERVICE_UNAVAILABLE' },
  });
}

function parsePort(value: string | undefined): number {
  const parsed = Number(value ?? '8080');
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error('PORT debe ser un número entero entre 1 y 65535');
  }
  return parsed;
}

function requireUrl(value: string | undefined, name: string): string {
  if (!value) throw new Error(`Falta la variable de entorno ${name}`);
  try {
    return new URL(value).toString().replace(/\/$/, '');
  } catch {
    throw new Error(`${name} debe ser una URL válida`);
  }
}