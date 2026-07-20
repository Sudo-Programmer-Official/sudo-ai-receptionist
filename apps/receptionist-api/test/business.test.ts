import { describe, expect, test } from 'vitest';
import { BusinessIdMismatchError, resolveBusinessId } from '../src/business';

describe('resolveBusinessId', () => {
  test('uses configured business id when the request omits one', () => {
    expect(resolveBusinessId({
      businessAdapter: 'salonflow',
      configuredBusinessId: '754decf4-4db3-4bfc-be6c-1a9733eea42c',
    })).toBe('754decf4-4db3-4bfc-be6c-1a9733eea42c');
  });

  test('allows matching business id', () => {
    expect(resolveBusinessId({
      businessAdapter: 'salonflow',
      configuredBusinessId: '754decf4-4db3-4bfc-be6c-1a9733eea42c',
      requestedBusinessId: '754decf4-4db3-4bfc-be6c-1a9733eea42c',
    })).toBe('754decf4-4db3-4bfc-be6c-1a9733eea42c');
  });

  test('rejects mismatched business ids with a stable 403 error', () => {
    expect(() => resolveBusinessId({
      businessAdapter: 'salonflow',
      configuredBusinessId: '754decf4-4db3-4bfc-be6c-1a9733eea42c',
      requestedBusinessId: 'different-tenant',
    })).toThrow(BusinessIdMismatchError);
  });
});
