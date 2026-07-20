import { describe, expect, test } from 'vitest';
import { loadRuntimeConfig } from '../src/index';

describe('loadRuntimeConfig', () => {
  test('rejects mock fallback in production', () => {
    expect(() => loadRuntimeConfig({
      NODE_ENV: 'production',
      PORT: '8787',
    })).toThrow('BUSINESS_ADAPTER must equal "salonflow" in production');
  });

  test('allows salonflow production runtime when configured', () => {
    const config = loadRuntimeConfig({
      NODE_ENV: 'production',
      BUSINESS_ADAPTER: 'salonflow',
      PORT: '8787',
      SALONFLOW_BASE_URL: 'https://salonflow.example',
      SALONFLOW_INTEGRATION_TOKEN: 'token-123',
      SALONFLOW_BUSINESS_ID: '754decf4-4db3-4bfc-be6c-1a9733eea42c',
    });

    expect(config.businessAdapter).toBe('salonflow');
    expect(config.salonflowBusinessId).toBe('754decf4-4db3-4bfc-be6c-1a9733eea42c');
  });
});
