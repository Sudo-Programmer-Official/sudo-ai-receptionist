import { describe, expect, it } from 'vitest';
import { createAgent } from '../src/index.js';
import { MockBusinessAdapter } from '@sudo-ai-receptionist/mock-business';

describe('ReceptionistAgent', () => {
  it('collects service info and proposes times', async () => {
    const agent = createAgent(new MockBusinessAdapter());
    const first = await agent.handleTurn({ text: 'I need a haircut tomorrow', businessId: 'demo-salon', channel: 'voice' });
    expect(first.message.length).toBeGreaterThan(0);
    expect(first.state.serviceId).toBeDefined();
  });
});

