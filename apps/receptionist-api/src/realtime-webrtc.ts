import type http from 'node:http';
import { createCorrelationId } from '@sudo-ai-receptionist/shared';

export type ParsedRealtimeOffer = {
  ok: true;
  sdp: string;
} | {
  ok: false;
  error: 'invalid_sdp';
  detail: string;
};

export type RealtimeCallSuccess = {
  answerSdp: string;
  callId: string;
};

export type OpenAIRealtimeError = {
  message?: string;
  type?: string;
  code?: string | null;
  param?: string | null;
};

export class RealtimeCallUpstreamError extends Error {
  constructor(
    message: string,
    public readonly upstreamStatus: number,
    public readonly upstreamBody: string,
    public readonly upstreamError?: OpenAIRealtimeError,
  ) {
    super(message);
    this.name = 'RealtimeCallUpstreamError';
  }
}

export const readRequestText = async (req: http.IncomingMessage): Promise<string> => {
  let body = '';
  for await (const chunk of req) {
    body += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
  }
  return body;
};

export const parseRealtimeOfferSdp = (input: string): ParsedRealtimeOffer => {
  const sdp = input.trim();
  if (!sdp || !sdp.startsWith('v=')) {
    return {
      ok: false,
      error: 'invalid_sdp',
      detail: 'A valid SDP offer is required.',
    };
  }
  return { ok: true, sdp };
};

export const postRealtimeCall = async (input: {
  offerSdp: string;
  model: string;
  voice: string;
  openAiApiKey: string;
  fetchImpl?: typeof fetch;
}): Promise<RealtimeCallSuccess> => {
  const fetchImpl = input.fetchImpl ?? fetch;
  if (!input.openAiApiKey.trim()) {
    throw new Error('OPENAI_API_KEY is required for realtime sessions');
  }
  const sessionConfig = {
    type: 'realtime',
    model: input.model,
    audio: {
      output: {
        voice: input.voice,
      },
    },
  };

  const formData = new FormData();
  formData.set('sdp', input.offerSdp);
  formData.set('session', JSON.stringify(sessionConfig));

  const response = await fetchImpl('https://api.openai.com/v1/realtime/calls', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.openAiApiKey}`,
    },
    body: formData,
  });

  const responseText = await response.text();
  if (!response.ok) {
    let upstreamError: OpenAIRealtimeError | undefined;
    try {
      const parsed = JSON.parse(responseText) as { error?: OpenAIRealtimeError };
      upstreamError = parsed.error;
    } catch {
      upstreamError = { message: responseText.slice(0, 500) };
    }
    throw new RealtimeCallUpstreamError(
      'OpenAI realtime call failed',
      response.status,
      responseText,
      upstreamError,
    );
  }

  const location = response.headers.get('Location') ?? response.headers.get('location') ?? '';
  const callId = location.split('/').filter(Boolean).pop() ?? createCorrelationId();
  return {
    answerSdp: responseText,
    callId,
  };
};
