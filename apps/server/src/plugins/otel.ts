import type { Config } from "@/config.js";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { Resource } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

export function startOtel(config: Config): NodeSDK | null {
  if (!config.OTEL_EXPORTER_OTLP_ENDPOINT) return null;
  const headers = config.OTEL_EXPORTER_OTLP_HEADERS
    ? Object.fromEntries(
        config.OTEL_EXPORTER_OTLP_HEADERS.split(",").map((kv) => {
          const [k = "", ...v] = kv.split("=");
          return [k.trim(), v.join("=").trim()];
        }),
      )
    : undefined;

  const sdk = new NodeSDK({
    resource: new Resource({ [ATTR_SERVICE_NAME]: config.OTEL_SERVICE_NAME }),
    traceExporter: new OTLPTraceExporter({
      url: `${config.OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces`,
      headers,
    }),
    instrumentations: [
      getNodeAutoInstrumentations({ "@opentelemetry/instrumentation-fs": { enabled: false } }),
    ],
  });
  sdk.start();
  return sdk;
}
