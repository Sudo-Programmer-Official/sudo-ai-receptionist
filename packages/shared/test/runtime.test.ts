import { describe, expect, test } from 'vitest';
import { loadRuntimeConfig, redactPersonData } from '../src/index';

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

  test('preserves ISO and display dates while redacting phone numbers', () => {
    expect(redactPersonData('2026-07-21')).toBe('2026-07-21');
    expect(redactPersonData('July 21, 2026')).toBe('July 21, 2026');
    expect(redactPersonData('5551234567')).toBe('[redacted-phone]');
    expect(redactPersonData('+1 555 123 4567')).toBe('[redacted-phone]');
  });
});
