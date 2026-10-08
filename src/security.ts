import jwt from 'jsonwebtoken';
import type { Request, RequestHandler } from 'express';
import { sendErrorResponse } from './responses.ts';

export interface SecurityConfig {
  readonly secret: string;
  readonly issuer: string;
}

interface AccessClaims {
  readonly sub: string;
  readonly role: string;
}

const BEARER_PREFIX = 'Bearer ';
const SIGNING_ALGORITHM = 'HS256';
const ROLE_ADMIN = 'ADMIN';
const ROLE_USER = 'USER';
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const PUBLIC_ROUTES = new Set([
  'GET /health',
  'POST /auth/login',
  'POST /auth/recover-password',
  'POST /auth/reset-password',
]);

const OWN_PROFILE_PATH = /^\/perfiles\/([^/]+)\/?$/;
// Incluye lo que cuelga de /docs/ — Swagger carga su css y sus scripts desde ahi, y sin ellos
// la pagina llega en blanco.
const DOCUMENTATION_PATH = /\/docs(\/|$)|\/openapi\.json$/;

// La validación vive aquí y no en cada microservicio: el ecosistema tiene seis servicios en cinco
// lenguajes, y repartir la verificación de firma significaría cinco librerías que mantener
// sincronizadas. Cuando el Reto 10 mueva la validación a JWKS, se cambia un solo archivo.
export function createAuthGuard(config: SecurityConfig): RequestHandler {
  return (request, response, next) => {
    if (isPublicRoute(request)) {
      next();
      return;
    }

    const claims = readClaims(request.headers.authorization, config);
    if (!claims) {
      sendErrorResponse(
        response,
        401,
        'La petición no incluye un token de acceso válido',
        'UNAUTHORIZED',
        request.originalUrl,
      );
      return;
    }

    if (isAuthorized(request, claims)) {
      next();
      return;
    }

    sendErrorResponse(
      response,
      403,
      'El rol del token no permite realizar esta operación',
      'FORBIDDEN',
      request.originalUrl,
    );
  };
}

// Un USER no puede escribir en general, pero sí sobre lo suyo. Comparar el rol no alcanza: la
// segunda comprobación mira de quién es el recurso, y es lo que permite que cada empleado
// gestione su propio perfil sin darle permisos de administrador.
function isAuthorized(request: Request, claims: AccessClaims): boolean {
  if (claims.role === ROLE_ADMIN) return true;
  if (claims.role !== ROLE_USER) return false;
  if (READ_METHODS.has(request.method)) return true;

  if (request.method === 'POST' && request.path === '/auth/change-password') return true;

  const ownProfile = OWN_PROFILE_PATH.exec(request.path);
  return request.method === 'PUT' && ownProfile?.[1] === claims.sub;
}

function isPublicRoute(request: Request): boolean {
  if (PUBLIC_ROUTES.has(`${request.method} ${normalize(request.path)}`)) return true;

  // La documentación queda abierta a propósito: el enunciado pide poder obtener el token desde
  // Swagger, y la página en sí no expone ningún dato del negocio.
  return READ_METHODS.has(request.method) && isDocumentationPath(normalize(request.path));
}

function isDocumentationPath(path: string): boolean {
  return DOCUMENTATION_PATH.test(path);
}

function normalize(path: string): string {
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
}

function readClaims(header: string | undefined, config: SecurityConfig): AccessClaims | null {
  if (!header?.startsWith(BEARER_PREFIX)) return null;

  try {
    const payload = jwt.verify(header.slice(BEARER_PREFIX.length).trim(), config.secret, {
      algorithms: [SIGNING_ALGORITHM],
      issuer: config.issuer,
    });

    if (typeof payload === 'string' || typeof payload.sub !== 'string') return null;

    // Un token de restablecimiento lleva el claim `type` y está firmado con el mismo secreto:
    // sin este rechazo serviría para entrar a cualquier recurso.
    if ('type' in payload) return null;

    const role = payload.role;
    if (role !== ROLE_ADMIN && role !== ROLE_USER) return null;

    return { sub: payload.sub, role };
  } catch {
    return null;
  }
}
