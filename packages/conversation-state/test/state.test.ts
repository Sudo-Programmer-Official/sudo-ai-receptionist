import { describe, expect, it } from 'vitest';
import { createConversationState, validateConversationState } from '../src/index.js';

describe('conversation state', () => {
  it('creates a valid default state', () => {
    const state = createConversationState({ conversationId: 'c1', businessId: 'b1', channel: 'voice' });
    expect(state.bookingConfirmationStatus).toBe('unconfirmed');
    expect(() => validateConversationState(state)).not.toThrow();
  });
});

