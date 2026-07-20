import { describe, expect, test } from 'vitest';
import { BusinessIdMismatchError, ServerMisconfiguredError, resolveBusinessId, resolveChatText } from '../src/business';

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
    try {
      resolveBusinessId({
        businessAdapter: 'salonflow',
        configuredBusinessId: '754decf4-4db3-4bfc-be6c-1a9733eea42c',
        requestedBusinessId: 'different-tenant',
      });
      throw new Error('Expected business id mismatch');
    } catch (error) {
      expect(error).toBeInstanceOf(BusinessIdMismatchError);
      expect(error).toMatchObject({ code: 'business_not_allowed' });
    }
  });

  test('rejects a missing configuration with a server misconfigured error', () => {
    try {
      resolveBusinessId({
        businessAdapter: 'salonflow',
        configuredBusinessId: undefined,
        requestedBusinessId: undefined,
      });
      throw new Error('Expected server misconfigured error');
    } catch (error) {
      expect(error).toBeInstanceOf(ServerMisconfiguredError);
      expect(error).toMatchObject({ code: 'server_misconfigured' });
    }
  });
});

describe('resolveChatText', () => {
  test('prefers text and falls back to message', () => {
    expect(resolveChatText({ message: 'I want a haircut tomorrow afternoon.' })).toBe('I want a haircut tomorrow afternoon.');
    expect(resolveChatText({ text: 'hello', message: 'ignored' })).toBe('hello');
  });
});
