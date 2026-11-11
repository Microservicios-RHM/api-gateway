import { trace } from '@opentelemetry/api';
import pino, { type Logger } from 'pino';

/**
 * Logger JSON del Gateway (Reto 8): reemplaza los console.log de texto plano por logs
 * estructurados con los campos mínimos del reto, iguales a los de los demás servicios:
 *   {"timestamp":"...","level":"INFO","service":"api-gateway","traceId":"...","message":"..."}
 */
export function createLogger(level = process.env.LOG_LEVEL ?? 'info'): Logger {
  return pino({
    level,
    messageKey: 'message',
    base: { service: process.env.OTEL_SERVICE_NAME ?? 'api-gateway' },
    timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
    formatters: {
      level: (label) => ({ level: label.toUpperCase() }),
    },
    mixin: () => {
      const span = trace.getActiveSpan();
      if (!span) return {};
      const { traceId, spanId } = span.spanContext();
      return { traceId, spanId };
    },
  });
}
