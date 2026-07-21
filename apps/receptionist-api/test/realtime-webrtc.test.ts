import { Readable } from 'node:stream';
import { describe, expect, test, vi } from 'vitest';
import {
  parseRealtimeOfferSdp,
  postRealtimeCall,
  readRequestText,
  summarizeRealtimeOfferDiagnostics,
} from '../src/realtime-webrtc';

const SDP_FIXTURE = [
  'v=0',
  'o=- 4227147428 1719357865 IN IP4 127.0.0.1',
  's=-',
  'c=IN IP4 0.0.0.0',
  't=0 0',
  'a=group:BUNDLE 0 1',
  'a=msid-semantic:WMS *',
  'a=fingerprint:sha-256 CA:92:52:51:B4:91:3B:34:DD:9C:0B:FB:76:19:7E:3B:F1:21:0F:32:2C:38:01:72:5D:3F:78:C7:5F:8B:C7:36',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111 0 8',
  'a=mid:0',
  'a=ice-ufrag:kZ2qkHXX/u11',
  'a=ice-pwd:uoD16Di5OGx3VbqgA3ymjEQV2kwiOjw6',
  'a=setup:active',
  'a=rtcp-mux',
  'a=rtpmap:111 opus/48000/2',
  'a=candidate:993865896 1 udp 2130706431 4.155.146.196 3478 typ host ufrag kZ2qkHXX/u11',
  'a=candidate:1432411780 1 tcp 1671430143 4.155.146.196 443 typ host tcptype passive ufrag kZ2qkHXX/u11',
  'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
  'a=mid:1',
  'a=sctp-port:5000',
  '',
].join('\r\n');

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
      sdp: 'v=0\r\n',
    });
  });

  test('preserves raw SDP bytes and reports safe diagnostics', () => {
    expect(parseRealtimeOfferSdp(SDP_FIXTURE)).toEqual({
      ok: true,
      sdp: SDP_FIXTURE,
    });
    expect(summarizeRealtimeOfferDiagnostics(SDP_FIXTURE)).toEqual({
      bodyLength: SDP_FIXTURE.length,
      startsWithV: true,
      endsWithCRLF: true,
      lineCount: 21,
      containsAudioMediaLine: true,
      containsFingerprint: true,
      containsIceUfrag: true,
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
      offerSdp: SDP_FIXTURE,
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
    expect(body.get('sdp')).toBe(SDP_FIXTURE);
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
      offerSdp: SDP_FIXTURE,
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
      offerSdp: SDP_FIXTURE,
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
