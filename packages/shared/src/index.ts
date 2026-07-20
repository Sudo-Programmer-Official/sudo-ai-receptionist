export const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error('Aborted'));
      return;
    }
    const timeout = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timeout);
      reject(signal.reason ?? new Error('Aborted'));
    }, { once: true });
  });

export const createCorrelationId = (): string =>
  `corr_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;

export const redactPhoneNumber = (value: string): string => value.replace(/\b(\+?\d[\d\s().-]{6,}\d)\b/g, '[redacted-phone]');

export const redactPersonData = (value: string): string =>
  redactPhoneNumber(value).replace(/\b[A-Z][a-z]+ [A-Z][a-z]+\b/g, '[redacted-name]');

export const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, signal?: AbortSignal): Promise<T> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);
  const onAbort = () => controller.abort(signal?.reason ?? new Error('Aborted'));
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true }))
    ]);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', onAbort);
  }
};

export const retry = async <T>(
  operation: () => Promise<T>,
  options: { retries: number; backoffMs: number; shouldRetry: (error: unknown) => boolean }
): Promise<T> => {
  let attempt = 0;
  let lastError: unknown;
  while (attempt <= options.retries) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === options.retries || !options.shouldRetry(error)) {
        throw error;
      }
      await sleep(options.backoffMs * Math.max(1, attempt + 1));
      attempt += 1;
    }
  }
  throw lastError;
};

export const sanitizeErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return redactPersonData(error.message).replace(/[A-Za-z0-9+/=]{20,}/g, '[redacted-token]');
  }
  return 'Unknown error';
};

export type RuntimeAdapter = 'mock' | 'salonflow';

export type RuntimeConfig = {
  businessAdapter: RuntimeAdapter;
  receptionistApiPort: number;
  salonflowBaseUrl?: string;
  salonflowIntegrationToken?: string;
  salonflowBusinessId?: string;
  openaiApiKey?: string | undefined;
  openaiRealtimeModel?: string | undefined;
};

const isPlaceholderValue = (value: string): boolean => {
  const normalized = value.trim().toLowerCase();
  return (
    normalized === 'replace-me' ||
    normalized === 'demo-tenant' ||
    normalized.includes('staging.salonflow.example') ||
    normalized.includes('example.com') ||
    normalized.includes('todo') ||
    normalized.includes('changeme')
  );
};

const readRequiredValue = (env: Record<string, string | undefined>, key: string): string => {
  const value = env[key];
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  if (isPlaceholderValue(value)) {
    throw new Error(`Environment variable ${key} still contains a placeholder value`);
  }
  return value.trim();
};

const readOptionalValue = (env: Record<string, string | undefined>, key: string): string | undefined => {
  const value = env[key];
  if (!value || !value.trim()) return undefined;
  if (isPlaceholderValue(value)) {
    throw new Error(`Environment variable ${key} still contains a placeholder value`);
  }
  return value.trim();
};

export const loadRuntimeConfig = (
  env: Record<string, string | undefined>,
  options?: { requireOpenAi?: boolean },
): RuntimeConfig => {
  const businessAdapterRaw = env.BUSINESS_ADAPTER?.trim().toLowerCase() || 'mock';
  if (businessAdapterRaw !== 'mock' && businessAdapterRaw !== 'salonflow') {
    throw new Error('BUSINESS_ADAPTER must be either "mock" or "salonflow"');
  }

  const portRaw = env.RECEPTIONIST_API_PORT ?? '8787';
  const receptionistApiPort = Number.parseInt(portRaw, 10);
  if (!Number.isFinite(receptionistApiPort) || receptionistApiPort <= 0) {
    throw new Error('Invalid RECEPTIONIST_API_PORT');
  }

  const openaiApiKey = options?.requireOpenAi ? readRequiredValue(env, 'OPENAI_API_KEY') : readOptionalValue(env, 'OPENAI_API_KEY');
  const openaiRealtimeModel = options?.requireOpenAi
    ? readRequiredValue(env, 'OPENAI_REALTIME_MODEL')
    : readOptionalValue(env, 'OPENAI_REALTIME_MODEL');

  const config: RuntimeConfig = {
    businessAdapter: businessAdapterRaw,
    receptionistApiPort,
  };

  if (openaiApiKey !== undefined) {
    config.openaiApiKey = openaiApiKey;
  }
  if (openaiRealtimeModel !== undefined) {
    config.openaiRealtimeModel = openaiRealtimeModel;
  }

  if (businessAdapterRaw === 'salonflow') {
    config.salonflowBaseUrl = readRequiredValue(env, 'SALONFLOW_BASE_URL');
    config.salonflowIntegrationToken = readRequiredValue(env, 'SALONFLOW_INTEGRATION_TOKEN');
    config.salonflowBusinessId = readRequiredValue(env, 'SALONFLOW_BUSINESS_ID');
  }

  return config;
};

export const validateEnvironment = (
  input: Record<string, string | undefined>,
  required: string[]
): Record<string, string> => {
  const output: Record<string, string> = {};
  for (const key of required) {
    const value = input[key];
    if (!value) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
    output[key] = value;
  }
  return output;
};
