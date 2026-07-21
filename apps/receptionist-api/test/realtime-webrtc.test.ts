import { Readable } from 'node:stream';
import { describe, expect, test, vi } from 'vitest';
import {
  parseRealtimeOfferSdp,
  postRealtimeCall,
  readRequestText,
} from '../src/realtime-webrtc';

describe('realtime WebRTC transport', () => {
  test('reads raw SDP request bodies as text', async () => {
    const request = Readable.from(['v=0\r\n']) as unknown as Parameters<typeof readRequestText>[0];

    await expect(readRequestText(request)).resolves.toBe('v=0\r\n');
  });

  test('rejects missing or malformed SDP', () => {
    expect(parseRealtimeOfferSdp('')).toEqual({
      ok: false,
      error: 'invalid_sdp',
      detail: 'A valid SDP offer is required.',
    });
    expect(parseRealtimeOfferSdp('not-an-sdp')).toEqual({
      ok: false,
      error: 'invalid_sdp',
      detail: 'A valid SDP offer is required.',
    });
    expect(parseRealtimeOfferSdp('v=0\r\n')).toEqual({
      ok: true,
      sdp: 'v=0',
    });
  });

  test('sends multipart sdp and session fields to OpenAI and returns raw SDP', async () => {
    let capturedInit: RequestInit | undefined;
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      capturedInit = init;
      return new Response('v=0\r\nanswer', {
        status: 200,
        headers: { Location: 'https://api.openai.com/v1/realtime/calls/call_123' },
      });
    });

    await expect(postRealtimeCall({
      offerSdp: 'v=0\r\no=- 1 1 IN IP4 127.0.0.1',
      model: 'gpt-realtime-2.1',
      voice: 'alloy',
      openAiApiKey: 'sk-test',
      fetchImpl: fetchImpl as typeof fetch,
    })).resolves.toEqual({
      answerSdp: 'v=0\r\nanswer',
      callId: 'call_123',
    });

    const body = capturedInit?.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get('sdp')).toBe('v=0\r\no=- 1 1 IN IP4 127.0.0.1');
    expect(body.get('session')).toBe(JSON.stringify({
      type: 'realtime',
      model: 'gpt-realtime-2.1',
      audio: {
        output: {
          voice: 'alloy',
        },
      },
    }));

    const headers = new Headers(capturedInit?.headers);
    expect(headers.get('Authorization')).toBe('Bearer sk-test');
    expect(headers.has('Content-Type')).toBe(false);
  });

  test('surfaces upstream failures safely', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response('bad request', {
        status: 400,
      }),
    );

    await expect(postRealtimeCall({
      offerSdp: 'v=0\r\no=- 1 1 IN IP4 127.0.0.1',
      model: 'gpt-realtime-2.1',
      voice: 'alloy',
      openAiApiKey: 'sk-test',
      fetchImpl: fetchImpl as typeof fetch,
    })).rejects.toMatchObject({
      upstreamStatus: 400,
      upstreamBody: 'bad request',
    });
  });

  test('parses the sanitized OpenAI error body', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({
        error: {
          message: 'Invalid multipart form. field "sdp" is required but not found.',
          type: 'invalid_request_error',
          code: 'invalid_form_data',
          param: 'sdp',
        },
      }), {
        status: 400,
      }),
    );

    await expect(postRealtimeCall({
      offerSdp: 'v=0\r\no=- 1 1 IN IP4 127.0.0.1',
      model: 'gpt-realtime-2.1',
      voice: 'alloy',
      openAiApiKey: 'sk-test',
      fetchImpl: fetchImpl as typeof fetch,
    })).rejects.toMatchObject({
      upstreamStatus: 400,
      upstreamError: {
        message: 'Invalid multipart form. field "sdp" is required but not found.',
        type: 'invalid_request_error',
        code: 'invalid_form_data',
        param: 'sdp',
      },
    });
  });
});
