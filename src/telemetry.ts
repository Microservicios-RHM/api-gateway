import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';

let telemetry: NodeSDK | undefined;

export function startTelemetry(): void {
  if (telemetry || process.env.OTEL_SDK_DISABLED === 'true') return;

  telemetry = new NodeSDK({
    resource: resourceFromAttributes({ 'service.name': 'api-gateway' }),
    traceExporter: new OTLPTraceExporter({
      url: process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ?? 'https://jaeger:4318/v1/traces',
    }),
    instrumentations: [getNodeAutoInstrumentations()],
  });
  telemetry.start();
}

export async function stopTelemetry(): Promise<void> {
  await telemetry?.shutdown();
}
