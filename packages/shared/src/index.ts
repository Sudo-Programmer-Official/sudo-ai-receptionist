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
