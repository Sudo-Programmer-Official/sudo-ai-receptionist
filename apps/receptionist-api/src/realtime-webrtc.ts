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

export class RealtimeCallUpstreamError extends Error {
  constructor(
    message: string,
    public readonly upstreamStatus: number,
    public readonly upstreamBody: string,
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
  instructions: string;
  openAiApiKey: string;
  safetyIdentifier: string;
  fetchImpl?: typeof fetch;
}): Promise<RealtimeCallSuccess> => {
  const fetchImpl = input.fetchImpl ?? fetch;
  if (!input.openAiApiKey.trim()) {
    throw new Error('OPENAI_API_KEY is required for realtime sessions');
  }
  const sessionConfig = {
    type: 'realtime',
    model: input.model,
    instructions: input.instructions,
    output_modalities: ['audio'],
    max_output_tokens: 256,
    turn_detection: {
      type: 'server_vad',
      prefix_padding_ms: 300,
      silence_duration_ms: 350,
      threshold: 0.5,
      create_response: false,
      interrupt_response: true,
    },
    input_audio_transcription: {
      model: 'gpt-4o-mini-transcribe',
      language: 'en',
    },
    audio: {
      output: {
        voice: input.voice,
      },
    },
  };

  const formData = new FormData();
  formData.set('sdp', new Blob([input.offerSdp], { type: 'application/sdp' }), 'offer.sdp');
  formData.set('session', new Blob([JSON.stringify(sessionConfig)], { type: 'application/json' }), 'session.json');

  const response = await fetchImpl('https://api.openai.com/v1/realtime/calls', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.openAiApiKey}`,
      'OpenAI-Safety-Identifier': input.safetyIdentifier,
    },
    body: formData,
  });

  const responseText = await response.text();
  if (!response.ok) {
    throw new RealtimeCallUpstreamError(
      'OpenAI realtime call failed',
      response.status,
      responseText,
    );
  }

  const location = response.headers.get('Location') ?? response.headers.get('location') ?? '';
  const callId = location.split('/').filter(Boolean).pop() ?? createCorrelationId();
  return {
    answerSdp: responseText,
    callId,
  };
};
