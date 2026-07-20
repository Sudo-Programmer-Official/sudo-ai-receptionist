import { describe, expect, test, vi } from 'vitest';
import { ApiError, createApiClient } from '../src/api';
import type { ChatResponse, HealthResponse, RealtimeCallResponse, RealtimeSessionResponse } from '../src/types';

describe('createApiClient', () => {
  test('constructs request URLs from the configured base URL', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const client = createApiClient({
      baseUrl: 'https://backend.example/',
      fetchImpl: fetchImpl as typeof fetch,
    });

    await client.apiFetch('/api/chat');

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://backend.example/api/chat',
      expect.objectContaining({
        headers: expect.any(Headers),
      }),
    );
  });

  test('throws a typed error for API failures', async () => {
    const fetchImpl = vi.fn(async () => new Response('server error', { status: 500 }));
    const client = createApiClient({
      baseUrl: 'https://backend.example',
      fetchImpl: fetchImpl as typeof fetch,
    });

    await expect(client.apiFetch('/health')).rejects.toMatchObject({
      status: 500,
      url: 'https://backend.example/health',
      body: 'server error',
    });
  });

  test('parses health, session, realtime call, and chat responses', async () => {
    const responses = [
      new Response(JSON.stringify({ ok: true } satisfies HealthResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
      new Response(JSON.stringify({
        businessId: 'demo',
        conversationId: 'conv_1',
        sessionToken: 'session_1',
        ephemeralSessionToken: 'ephemeral_1',
        webrtcUrl: '/api/realtime/webrtc',
        expiresAt: '2026-07-20T00:00:00.000Z',
        model: 'gpt-realtime-2.1',
        instructions: 'voice instructions',
        businessContext: { businessName: 'Demo Salon', serviceNames: ['Haircut'] },
      } satisfies RealtimeSessionResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
      new Response(JSON.stringify({
        answerSdp: 'v=0',
        callId: 'call_1',
        businessId: 'demo',
        conversationId: 'conv_1',
        model: 'gpt-realtime-2.1',
        expiresAt: '2026-07-20T00:10:00.000Z',
      } satisfies RealtimeCallResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
      new Response(JSON.stringify({
        message: 'Booked',
        state: { requestedService: 'Haircut' },
        toolStatus: [{ name: 'findAvailability', status: 'ok' }],
        requiresUserAction: false,
      } satisfies ChatResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ];
    const fetchImpl = vi.fn(async () => {
      const response = responses.shift();
      if (!response) {
        throw new Error('No response queued');
      }
      return response;
    });
    const client = createApiClient({
      baseUrl: 'https://backend.example',
      fetchImpl: fetchImpl as typeof fetch,
    });

    await expect(client.getHealth()).resolves.toEqual({ ok: true });
    await expect(client.createRealtimeSession()).resolves.toMatchObject({
      conversationId: 'conv_1',
      ephemeralSessionToken: 'ephemeral_1',
    });
    await expect(client.connectRealtimeCall({ token: 'session_1', sdp: 'v=0' })).resolves.toMatchObject({
      callId: 'call_1',
      answerSdp: 'v=0',
    });
    await expect(client.sendChat({ text: 'hello' })).resolves.toMatchObject({
      message: 'Booked',
      state: { requestedService: 'Haircut' },
    });
  });

  test('includes businessId in chat requests when provided', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({
        message: 'ok',
        requiresUserAction: true,
      } satisfies ChatResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const client = createApiClient({
      baseUrl: 'https://backend.example',
      fetchImpl: fetchImpl as typeof fetch,
    });

    await client.sendChat({
      text: 'hello',
      businessId: '754decf4-4db3-4bfc-be6c-1a9733eea42c',
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://backend.example/api/chat',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          text: 'hello',
          businessId: '754decf4-4db3-4bfc-be6c-1a9733eea42c',
        }),
      }),
    );
  });
});
