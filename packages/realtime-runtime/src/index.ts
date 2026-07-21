import type { ConversationState } from '@sudo-ai-receptionist/conversation-state';

export interface RealtimeSessionDescriptor {
  businessId: string;
  conversationId: string;
  sessionToken: string;
  ephemeralSessionToken: string;
  websocketUrl?: string;
  webrtcUrl?: string;
  expiresAt: string;
  model: string;
  instructions: string;
  businessContext: RealtimeBusinessContext;
}

export interface TranscriptEntry {
  role: 'user' | 'assistant' | 'system' | 'tool';
  text: string;
  timestamp: string;
}

export interface RealtimeBusinessContext {
  businessName: string;
  serviceNames: string[];
  timeZone?: string;
  location?: string;
  bookingPolicy?: string;
}

export interface BuildRealtimeInstructionsInput {
  conversation: ConversationState;
  businessContext: RealtimeBusinessContext;
  model: string;
}

export const buildRealtimeInstructions = ({ conversation, businessContext, model }: BuildRealtimeInstructionsInput): string => {
  return [
    'You are the voice layer for a salon receptionist demo.',
    'Speak briefly, one question at a time, and keep replies natural.',
    'Do not invent services, prices, policies, or availability.',
    'Use the backend-provided booking flow and never create a second booking for the same slot.',
    'If the customer interrupts, stop speaking immediately.',
    `Model: ${model}.`,
    `BusinessId: ${conversation.businessId}.`,
    `Business: ${businessContext.businessName}.`,
    `Services: ${businessContext.serviceNames.slice(0, 8).join(', ') || 'none'}.`,
    `Timezone: ${businessContext.timeZone ?? 'unknown'}.`,
    conversation.callerTimezone ? `Caller timezone: ${conversation.callerTimezone}.` : '',
    `Location: ${businessContext.location ?? 'unknown'}.`,
    businessContext.bookingPolicy ? `Policy: ${businessContext.bookingPolicy}.` : '',
    `Known service: ${conversation.requestedService ?? 'unknown'}.`,
    `Booking status: ${conversation.bookingConfirmationStatus}.`
  ].join('\n');
};

export const createSessionPayload = (input: {
  businessId: string;
  conversationId: string;
  accessToken: string;
  model: string;
  instructions: string;
  businessContext: RealtimeBusinessContext;
}): RealtimeSessionDescriptor => ({
  businessId: input.businessId,
  conversationId: input.conversationId,
  sessionToken: input.accessToken,
  ephemeralSessionToken: input.accessToken,
  webrtcUrl: '/api/realtime/webrtc',
  expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
  model: input.model,
  instructions: input.instructions,
  businessContext: input.businessContext
});
