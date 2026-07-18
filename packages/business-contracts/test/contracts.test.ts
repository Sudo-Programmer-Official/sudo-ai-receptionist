import { describe, expect, it } from 'vitest';
import { AdapterError } from '../src/index.js';

describe('business contracts', () => {
  it('creates typed adapter errors', () => {
    const error = new AdapterError('fail', { code: 'bad_request', retryable: false, status: 400 });
    expect(error.code).toBe('bad_request');
    expect(error.retryable).toBe(false);
    expect(error.status).toBe(400);
  });
});

