import { describe, expect, test } from 'vitest';
import { readFrontendConfig } from '../src/config';

describe('readFrontendConfig', () => {
  test('normalizes trailing slashes', () => {
    const config = readFrontendConfig({
      VITE_RECEPTIONIST_API_URL: 'https://example.test/backend///',
    });

    expect(config.apiUrl).toBe('https://example.test/backend');
  });

  test('fails when the variable is missing', () => {
    expect(() => readFrontendConfig({})).toThrow('Missing VITE_RECEPTIONIST_API_URL');
  });

  test('fails when the variable is a placeholder', () => {
    expect(() =>
      readFrontendConfig({
        VITE_RECEPTIONIST_API_URL: 'https://staging.salonflow.example',
      }),
    ).toThrow('placeholder');
  });
});
