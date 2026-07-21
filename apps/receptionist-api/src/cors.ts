const DEFAULT_PRODUCTION_ORIGINS = ['https://sudo-ai-receptionist-receptionist-gsjjfepmk.vercel.app'];
const VERCEL_PROJECT_PREFIX = 'sudo-ai-receptionist-receptionist-';

const LOCALHOST_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1']);

const normalizeOrigin = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return new URL(trimmed).origin;
  } catch {
    return null;
  }
};

export const parseAllowedOrigins = (value: string | undefined): string[] => {
  const parsed = new Set<string>();
  for (const raw of value?.split(',') ?? []) {
    const origin = normalizeOrigin(raw);
    if (origin) {
      parsed.add(origin);
    }
  }
  for (const origin of DEFAULT_PRODUCTION_ORIGINS) {
    parsed.add(origin);
  }
  return [...parsed];
};

const isLocalhostOrigin = (origin: string): boolean => {
  try {
    const url = new URL(origin);
    return LOCALHOST_HOSTNAMES.has(url.hostname);
  } catch {
    return false;
  }
};

const isProjectVercelOrigin = (origin: string): boolean => {
  try {
    const url = new URL(origin);
    return url.protocol === 'https:' && url.hostname.startsWith(VERCEL_PROJECT_PREFIX) && url.hostname.endsWith('.vercel.app');
  } catch {
    return false;
  }
};

export const isAllowedOrigin = (origin: string | undefined, allowedOrigins: string[]): boolean => {
  if (!origin) {
    return false;
  }
  const normalized = normalizeOrigin(origin);
  if (!normalized) {
    return false;
  }
  if (isLocalhostOrigin(normalized)) {
    return true;
  }
  if (isProjectVercelOrigin(normalized)) {
    return true;
  }
  return allowedOrigins.includes(normalized);
};

export type CorsHeaders = {
  origin: string | null;
  allowed: boolean;
  headers: Record<string, string>;
};

export const buildCorsHeaders = (origin: string | undefined, allowedOrigins: string[]): CorsHeaders => {
  const allowed = isAllowedOrigin(origin, allowedOrigins);
  const headers: Record<string, string> = { Vary: 'Origin' };
  if (allowed && origin) {
    headers['Access-Control-Allow-Origin'] = normalizeOrigin(origin) ?? origin;
    headers['Access-Control-Allow-Methods'] = 'GET,POST,OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type, X-Correlation-Id, Accept, Authorization';
    headers['Access-Control-Max-Age'] = '86400';
  }
  return {
    origin: origin ?? null,
    allowed,
    headers,
  };
};

export const buildPublicCorsHeaders = (): Record<string, string> => ({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Correlation-Id, Accept',
  'Access-Control-Max-Age': '86400',
  Vary: 'Origin',
});
