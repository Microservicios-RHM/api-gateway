export const openApiDocument = {
  openapi: '3.0.3',
  info: {
    title: 'RHM API Gateway',
    version: '1.0.0',
    description: 'Punto de entrada unificado. Cada ruta conserva el contrato OpenAPI del microservicio propietario.',
  },
  servers: [{ url: '/', description: 'Gateway actual' }],
  paths: {
    '/health': { get: { summary: 'Estado del Gateway', responses: { '200': { description: 'UP' }, '503': { description: 'DOWN' } } } },
    '/auth/{path}': { parameters: [{ name: 'path', in: 'path', required: true, schema: { type: 'string' } }], get: { summary: 'Auth proxy', responses: { '200': { description: 'Proxy response' } } }, post: { summary: 'Auth proxy', responses: { '200': { description: 'Proxy response' } } } },
    '/empleados/{path}': { parameters: [{ name: 'path', in: 'path', required: true, schema: { type: 'string' } }], get: { summary: 'Employees proxy', responses: { '200': { description: 'Proxy response' } } }, post: { summary: 'Employees proxy', responses: { '201': { description: 'Created' } } } },
    '/departamentos/{path}': { parameters: [{ name: 'path', in: 'path', required: true, schema: { type: 'string' } }], get: { summary: 'Departments proxy', responses: { '200': { description: 'Proxy response' } } } },
    '/perfiles/{path}': { parameters: [{ name: 'path', in: 'path', required: true, schema: { type: 'string' } }], get: { summary: 'Profiles proxy', responses: { '200': { description: 'Proxy response' } } } },
    '/vacaciones/{path}': { parameters: [{ name: 'path', in: 'path', required: true, schema: { type: 'string' } }], get: { summary: 'Vacations proxy', responses: { '200': { description: 'Proxy response' } } } },
  },
  components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } },
} as const;
