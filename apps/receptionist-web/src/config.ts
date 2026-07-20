import type { FrontendEnv } from './types';

export type FrontendConfig = {
  apiUrl: string;
};

const PLACEHOLDER_HINTS = ['replace-me', 'todo', 'example.com', 'staging.salonflow.example'];

const normalizeTrailingSlashes = (value: string): string => value.replace(/\/+$/, '');

const isPlaceholderValue = (value: string): boolean => {
  const normalized = value.trim().toLowerCase();
  return PLACEHOLDER_HINTS.some((hint) => normalized.includes(hint));
};

const validateAbsoluteHttpUrl = (value: string): string => {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('VITE_RECEPTIONIST_API_URL must be a valid absolute URL');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('VITE_RECEPTIONIST_API_URL must start with http:// or https://');
  }

  return normalizeTrailingSlashes(parsed.toString());
};

export const readFrontendConfig = (env: FrontendEnv = import.meta.env as unknown as FrontendEnv): FrontendConfig => {
  const rawUrl = env.VITE_RECEPTIONIST_API_URL?.trim();
  if (!rawUrl) {
    throw new Error('Missing VITE_RECEPTIONIST_API_URL');
  }
  if (isPlaceholderValue(rawUrl)) {
    throw new Error('VITE_RECEPTIONIST_API_URL still contains a placeholder value');
  }

  return {
    apiUrl: validateAbsoluteHttpUrl(rawUrl),
  };
};
