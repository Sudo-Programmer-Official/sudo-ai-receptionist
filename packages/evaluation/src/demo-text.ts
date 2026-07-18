import { createAgent } from '@sudo-ai-receptionist/agent-core';
import { MockBusinessAdapter } from '@sudo-ai-receptionist/mock-business';
import type { ConversationState } from '@sudo-ai-receptionist/conversation-state';

const adapter = new MockBusinessAdapter();
const agent = createAgent(adapter);
let state: ConversationState | undefined;

const turns = [
  'I need a haircut tomorrow',
  '2',
  'My name is Jordan Lee',
  'My phone is 555-010-3333',
  'yes please confirm'
];

for (const turn of turns) {
  const result = await agent.handleTurn({
    text: turn,
    ...(state ? { state } : {}),
    businessId: 'demo-salon',
    channel: 'voice'
  });
  state = result.state;
  console.log(`USER: ${turn}`);
  console.log(`ASSISTANT: ${result.message}`);
  console.log(`TOOLS: ${JSON.stringify(result.toolStatus)}`);
}

console.log('');
console.log(`BOOKING_ID: ${state?.bookingId ?? 'missing'}`);
console.log(`SUMMARY: ${state?.requestedService ?? 'service'} for ${state?.customerName ?? 'customer'} at ${state?.selectedSlot?.startsAt ?? state?.proposedSlots[0]?.startsAt ?? 'unknown time'}`);
