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

export const summarizeRealtimeOfferDiagnostics = (sdp: string): {
  bodyLength: number;
  startsWithV: boolean;
  endsWithCRLF: boolean;
  lineCount: number;
  containsAudioMediaLine: boolean;
  containsFingerprint: boolean;
  containsIceUfrag: boolean;
} => ({
  bodyLength: sdp.length,
  startsWithV: sdp.startsWith('v='),
  endsWithCRLF: sdp.endsWith('\r\n'),
  lineCount: sdp.length === 0 ? 0 : sdp.split('\r\n').length,
  containsAudioMediaLine: sdp.includes('\r\nm=audio '),
  containsFingerprint: sdp.includes('\r\na=fingerprint:'),
  containsIceUfrag: sdp.includes('\r\na=ice-ufrag:'),
});

export const parseRealtimeOfferSdp = (input: string): ParsedRealtimeOffer => {
  if (typeof input !== 'string' || input.length === 0 || !input.startsWith('v=')) {
    return {
      ok: false,
      error: 'invalid_sdp',
      detail: 'A valid SDP offer is required.',
    };
  }
  return { ok: true, sdp: input };
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
