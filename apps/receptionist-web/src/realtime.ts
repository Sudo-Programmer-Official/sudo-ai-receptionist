import type { ApiClient } from './api';
import type { RealtimeSessionResponse } from './types';

export const requestRealtimeSession = (api: ApiClient): Promise<RealtimeSessionResponse> => api.createRealtimeSession();

export const formatRealtimeSessionSummary = (session: RealtimeSessionResponse): string =>
  `Session ${session.conversationId} expires at ${new Date(session.expiresAt).toISOString()}`;
