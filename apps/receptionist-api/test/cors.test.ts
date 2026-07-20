import { describe, expect, test } from 'vitest';
import { buildCorsHeaders, isAllowedOrigin, parseAllowedOrigins } from '../src/cors';

describe('cors policy', () => {
  test('includes the deployed Vercel frontend origin by default', () => {
    const allowedOrigins = parseAllowedOrigins(undefined);

    expect(isAllowedOrigin('https://sudo-ai-receptionist-receptionist-gsjjfepmk.vercel.app', allowedOrigins)).toBe(true);
  });

  test('allows configured Vercel and localhost origins', () => {
    const allowedOrigins = parseAllowedOrigins('https://app.example.com');
    const cors = buildCorsHeaders('https://app.example.com', allowedOrigins);

    expect(isAllowedOrigin('https://app.example.com', allowedOrigins)).toBe(true);
    expect(isAllowedOrigin('http://localhost:5173', allowedOrigins)).toBe(true);
    expect(isAllowedOrigin('http://127.0.0.1:3000', allowedOrigins)).toBe(true);
    expect(cors.allowed).toBe(true);
    expect(cors.headers['Access-Control-Allow-Origin']).toBe('https://app.example.com');
    expect(cors.headers['Access-Control-Allow-Methods']).toBe('GET,POST,OPTIONS');
    expect(cors.headers['Access-Control-Allow-Headers']).toContain('Authorization');
  });

  test('denies unknown origins', () => {
    const allowedOrigins = parseAllowedOrigins('https://app.example.com');

    expect(isAllowedOrigin('https://evil.example.com', allowedOrigins)).toBe(false);
    expect(buildCorsHeaders('https://evil.example.com', allowedOrigins).allowed).toBe(false);
    expect(buildCorsHeaders('https://evil.example.com', allowedOrigins).headers['Access-Control-Allow-Origin']).toBeUndefined();
  });

  test('omits cors permission when origin is missing', () => {
    const allowedOrigins = parseAllowedOrigins('https://app.example.com');

    const cors = buildCorsHeaders(undefined, allowedOrigins);

    expect(cors.allowed).toBe(false);
    expect(cors.headers['Access-Control-Allow-Origin']).toBeUndefined();
    expect(cors.headers.Vary).toBe('Origin');
  });
});
