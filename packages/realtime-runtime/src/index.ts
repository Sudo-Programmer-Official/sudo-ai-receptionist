import type { ConversationState } from '@sudo-ai-receptionist/conversation-state';

export interface RealtimeSessionDescriptor {
  businessId: string;
  conversationId: string;
  ephemeralSessionToken: string;
  websocketUrl?: string;
  webrtcUrl?: string;
  expiresAt: string;
}

export interface TranscriptEntry {
  role: 'user' | 'assistant' | 'system' | 'tool';
  text: string;
  timestamp: string;
}

export const buildRealtimeInstructions = (state: ConversationState): string => {
  return [
    'You are a concise AI receptionist.',
    'Ask one question at a time.',
    'Never invent services, prices, policies, or availability.',
    `Current businessId: ${state.businessId}.`,
    `Known service: ${state.requestedService ?? 'unknown'}.`
  ].join('\n');
};

export const createSessionPayload = (input: {
  businessId: string;
  conversationId: string;
  accessToken: string;
}): RealtimeSessionDescriptor => ({
  businessId: input.businessId,
  conversationId: input.conversationId,
  ephemeralSessionToken: input.accessToken,
  webrtcUrl: '/api/realtime/webrtc',
  expiresAt: new Date(Date.now() + 10 * 60_000).toISOString()
});

