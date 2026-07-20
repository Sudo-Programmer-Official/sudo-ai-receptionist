import { SalonFlowAdapter } from '@sudo-ai-receptionist/salonflow';
import { createCorrelationId, loadRuntimeConfig } from '@sudo-ai-receptionist/shared';

export const DEMO_BUSINESS_ID = '754decf4-4db3-4bfc-be6c-1a9733eea42c';

export type SalonFlowRuntime = {
  baseUrl: string;
  integrationToken: string;
  businessId: string;
  openaiApiKey: string;
  openaiRealtimeModel: string;
};

const ensureDemoBusiness = (businessId: string): string => {
  if (businessId !== DEMO_BUSINESS_ID) {
    throw new Error(`SALONFLOW_BUSINESS_ID must be ${DEMO_BUSINESS_ID}`);
  }
  return businessId;
};

export const loadSalonFlowRuntime = (): SalonFlowRuntime => {
  const env = { ...process.env };
  delete env.OPENAI_API_KEY;
  delete env.OPENAI_REALTIME_MODEL;
  const runtime = loadRuntimeConfig(env);
  if (runtime.businessAdapter !== 'salonflow') {
    throw new Error('BUSINESS_ADAPTER must equal salonflow');
  }
  if (!runtime.salonflowBaseUrl) {
    throw new Error('SALONFLOW_BASE_URL is required');
  }
  if (!runtime.salonflowIntegrationToken) {
    throw new Error('SALONFLOW_INTEGRATION_TOKEN is required');
  }
  if (!runtime.salonflowBusinessId) {
    throw new Error('SALONFLOW_BUSINESS_ID is required');
  }

  return {
    baseUrl: runtime.salonflowBaseUrl,
    integrationToken: runtime.salonflowIntegrationToken,
    businessId: ensureDemoBusiness(runtime.salonflowBusinessId),
    openaiApiKey: runtime.openaiApiKey ?? '',
    openaiRealtimeModel: runtime.openaiRealtimeModel ?? '',
  };
};

export const createLoggedSalonFlowAdapter = (
  runtime: SalonFlowRuntime,
  label: string,
): SalonFlowAdapter =>
  new SalonFlowAdapter({
    baseUrl: runtime.baseUrl,
    integrationToken: runtime.integrationToken,
    timeoutMs: 10_000,
    observer: (event) => {
      const payload = {
        event: `salonflow_${label}_http`,
        method: event.method,
        path: event.path,
        correlationId: event.correlationId,
        status: event.status,
        latencyMs: event.latencyMs,
        retryable: event.retryable,
        ...(event.errorCode ? { errorCode: event.errorCode } : {}),
      };
      console.log(JSON.stringify(payload));
    },
  });

export const createStableCorrelationId = (prefix: string): string =>
  `${prefix}_${createCorrelationId()}`;
