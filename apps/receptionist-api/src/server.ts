import http from 'node:http';
import { createAgent } from '@sudo-ai-receptionist/agent-core';
import { MockBusinessAdapter } from '@sudo-ai-receptionist/mock-business';
import { SalonFlowAdapter } from '@sudo-ai-receptionist/salonflow';
import { createCorrelationId, loadRuntimeConfig, sanitizeErrorMessage } from '@sudo-ai-receptionist/shared';
import { createConversationState, validateConversationState } from '@sudo-ai-receptionist/conversation-state';
import { buildRealtimeInstructions, createSessionPayload, type RealtimeBusinessContext } from '@sudo-ai-receptionist/realtime-runtime';
import { createStructuredLogger } from '@sudo-ai-receptionist/observability';
import { buildCorsHeaders, buildPublicCorsHeaders, parseAllowedOrigins } from './cors.js';
import { BusinessIdMismatchError, ServerMisconfiguredError, resolveBusinessId, resolveChatText } from './business.js';
import { resolveRealtimeBusinessContext } from './realtime.js';

const runtime = loadRuntimeConfig(process.env);
const adapter =
  runtime.businessAdapter === 'salonflow'
    ? new SalonFlowAdapter({
        baseUrl: runtime.salonflowBaseUrl ?? '',
        integrationToken: runtime.salonflowIntegrationToken ?? '',
      })
    : new MockBusinessAdapter();
const agent = createAgent(adapter);
const requestCounts = new Map<string, { count: number; windowStart: number }>();
const realtimeSessions = new Map<string, {
  businessId: string;
  conversationId: string;
  state: ReturnType<typeof createConversationState>;
  businessContext: RealtimeBusinessContext;
  createdAt: number;
  expiresAt: number;
  used: boolean;
}>();
const conversationStates = new Map<string, ReturnType<typeof createConversationState>>();
const logger = createStructuredLogger('receptionist-api');
const allowedOrigins = parseAllowedOrigins(process.env.ALLOWED_ORIGINS);
const env = {
  PORT: runtime.receptionistApiPort,
  BUSINESS_ADAPTER: runtime.businessAdapter,
  BUSINESS_ID: runtime.businessAdapter === 'salonflow' ? runtime.salonflowBusinessId ?? '' : 'demo-salon'
};

if (!Number.isFinite(env.PORT) || env.PORT <= 0) {
  throw new Error('Invalid PORT or RECEPTIONIST_API_PORT');
}

const readJson = async (req: http.IncomingMessage): Promise<unknown> => {
  let body = '';
  for await (const chunk of req) body += chunk;
  try {
    return JSON.parse(body || '{}');
  } catch {
    return {};
  }
};

const isRateLimited = (key: string): boolean => {
  const now = Date.now();
  const windowMs = 60_000;
  const limit = 60;
  const current = requestCounts.get(key);
  if (!current || now - current.windowStart > windowMs) {
    requestCounts.set(key, { count: 1, windowStart: now });
    return false;
  }
  current.count += 1;
  return current.count > limit;
};

const setCorsHeaders = (res: http.ServerResponse, origin: string | undefined): boolean => {
  const cors = buildCorsHeaders(origin, allowedOrigins);
  for (const [key, value] of Object.entries(cors.headers)) {
    res.setHeader(key, value);
  }
  return cors.allowed;
};

const pruneRealtimeSessions = (): void => {
  const now = Date.now();
  for (const [token, session] of realtimeSessions.entries()) {
    if (session.expiresAt <= now) {
      realtimeSessions.delete(token);
    }
  }
};

const createSessionToken = (): string => `rt_${createCorrelationId()}`;

const writeBusinessIdMismatch = (res: http.ServerResponse, error: BusinessIdMismatchError): void => {
  res.writeHead(403).end(JSON.stringify({
    error: error.code,
    detail: `Requested businessId ${error.requestedBusinessId} does not match configured SalonFlow tenant.`,
  }));
};

const writeServerMisconfigured = (res: http.ServerResponse, error: ServerMisconfiguredError): void => {
  res.writeHead(500).end(JSON.stringify({
    error: error.code,
    detail: 'SALONFLOW_BUSINESS_ID is required.',
  }));
};

const postRealtimeCall = async (input: { offerSdp: string; instructions: string; model: string }): Promise<{ answerSdp: string; callId: string }> => {
  const openAiApiKey = runtime.openaiApiKey ?? process.env.OPENAI_API_KEY;
  if (!openAiApiKey) {
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
      interrupt_response: true
    },
    input_audio_transcription: {
      model: 'gpt-4o-mini-transcribe',
      language: 'en'
    }
  };

  const formData = new FormData();
  formData.append('sdp', new Blob([input.offerSdp], { type: 'application/sdp' }), 'offer.sdp');
  formData.append('session', new Blob([JSON.stringify(sessionConfig)], { type: 'application/json' }), 'session.json');

  const response = await fetch('https://api.openai.com/v1/realtime/calls', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${openAiApiKey}`
    },
    body: formData
  });

  if (!response.ok) {
    throw new Error(`OpenAI realtime call failed with status ${response.status}: ${await response.text()}`);
  }

  const answerSdp = await response.text();
  const location = response.headers.get('Location') ?? response.headers.get('location') ?? '';
  const callId = location.split('/').filter(Boolean).pop() ?? createCorrelationId();
  return { answerSdp, callId };
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const correlationId = req.headers['x-correlation-id']?.toString() ?? createCorrelationId();
  const clientKey = req.socket.remoteAddress ?? 'unknown';
  const requestOrigin = req.headers.origin?.toString();

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('x-correlation-id', correlationId);
  res.setHeader('x-content-type-options', 'nosniff');
  const corsAllowed = setCorsHeaders(res, requestOrigin);

  if (req.method === 'OPTIONS') {
    if (url.pathname === '/health' || url.pathname === '/healthz') {
      for (const [key, value] of Object.entries(buildPublicCorsHeaders())) {
        res.setHeader(key, value);
      }
      res.writeHead(204).end();
      return;
    }
    if (!corsAllowed && requestOrigin) {
      res.writeHead(403).end(JSON.stringify({ error: 'cors_denied' }));
      return;
    }
    res.writeHead(204).end();
    return;
  }

  if (isRateLimited(clientKey)) {
    res.writeHead(429).end(JSON.stringify({ error: 'rate_limited' }));
    return;
  }

  if (url.pathname === '/health' || url.pathname === '/healthz') {
    for (const [key, value] of Object.entries(buildPublicCorsHeaders())) {
      res.setHeader(key, value);
    }
    res.writeHead(200).end(JSON.stringify({ ok: true }));
    return;
  }

  if (url.pathname === '/api/chat' && req.method === 'POST') {
    const payload = await readJson(req) as {
      text?: string;
      message?: string;
      conversationId?: string;
      state?: unknown;
      businessId?: string;
      interrupted?: boolean;
      channel?: 'web' | 'voice' | 'sms' | 'phone';
    };
    try {
      const businessId = resolveBusinessId({
        businessAdapter: env.BUSINESS_ADAPTER,
        configuredBusinessId: env.BUSINESS_ID,
        requestedBusinessId: payload.businessId,
      });
      const conversationId = payload.conversationId?.trim() || correlationId;
      const cachedState = conversationStates.get(conversationId);
      const validatedState = payload.state !== undefined ? validateConversationState(payload.state) : undefined;
      const state = validatedState ?? cachedState ?? createConversationState({
        conversationId,
        businessId,
        channel: payload.channel ?? (payload.conversationId ? 'voice' : 'web'),
      });
      const agentInput = {
        text: resolveChatText(payload),
        state,
        businessId,
        correlationId,
        channel: state.channel,
        ...(payload.interrupted !== undefined ? { interrupted: payload.interrupted } : {})
      };
      const result = await agent.handleTurn(agentInput);
      conversationStates.set(result.state.conversationId, result.state);
      res.writeHead(200).end(JSON.stringify(result));
    } catch (error) {
      if (error instanceof BusinessIdMismatchError) {
        writeBusinessIdMismatch(res, error);
        return;
      }
      if (error instanceof ServerMisconfiguredError) {
        writeServerMisconfigured(res, error);
        return;
      }
      res.writeHead(500).end(JSON.stringify({ error: 'internal_error', detail: sanitizeErrorMessage(error) }));
    }
    return;
  }

  if (url.pathname === '/api/realtime/session' && req.method === 'POST') {
    try {
      pruneRealtimeSessions();
      const payload = await readJson(req) as { businessId?: string; state?: unknown };
      const businessId = resolveBusinessId({
        businessAdapter: env.BUSINESS_ADAPTER,
        configuredBusinessId: env.BUSINESS_ID,
        requestedBusinessId: payload.businessId,
      });
      const conversationId = correlationId;
      const state = payload.state !== undefined
        ? validateConversationState(payload.state)
        : createConversationState({ conversationId, businessId, channel: 'voice' });
      const businessContext = await resolveRealtimeBusinessContext({
        adapter,
        businessId,
        correlationId,
        logger,
      });
      const sessionToken = createSessionToken();
      const instructions = buildRealtimeInstructions({
        conversation: state,
        businessContext,
        model: runtime.openaiRealtimeModel ?? 'gpt-realtime-2.1'
      });
      realtimeSessions.set(sessionToken, {
        businessId,
        conversationId,
        state,
        businessContext,
        createdAt: Date.now(),
        expiresAt: Date.now() + 10 * 60_000,
        used: false
      });
      const session = createSessionPayload({
        businessId,
        conversationId,
        accessToken: sessionToken,
        model: runtime.openaiRealtimeModel ?? 'gpt-realtime-2.1',
        instructions,
        businessContext
      });
      logger.log('info', 'realtime session created', {
        businessId,
        conversationId,
        sessionToken
      });
      res.writeHead(200).end(JSON.stringify(session));
    } catch (error) {
      if (error instanceof BusinessIdMismatchError) {
        writeBusinessIdMismatch(res, error);
        return;
      }
      if (error instanceof ServerMisconfiguredError) {
        writeServerMisconfigured(res, error);
        return;
      }
      res.writeHead(500).end(JSON.stringify({ error: 'realtime_session_failed', detail: sanitizeErrorMessage(error) }));
    }
    return;
  }

  if (url.pathname === '/api/realtime/webrtc' && req.method === 'POST') {
    try {
      pruneRealtimeSessions();
      const payload = await readJson(req) as { token?: string; sdp?: string };
      const token = payload.token?.trim();
      const offerSdp = payload.sdp?.trim();
      if (!token || !offerSdp) {
        res.writeHead(400).end(JSON.stringify({ error: 'missing_token_or_sdp' }));
        return;
      }
      const session = realtimeSessions.get(token);
      if (!session || session.expiresAt <= Date.now()) {
        realtimeSessions.delete(token);
        res.writeHead(401).end(JSON.stringify({ error: 'invalid_or_expired_session' }));
        return;
      }
      if (session.used) {
        res.writeHead(409).end(JSON.stringify({ error: 'session_already_used' }));
        return;
      }
      const model = runtime.openaiRealtimeModel ?? 'gpt-realtime-2.1';
      const instructions = buildRealtimeInstructions({
        conversation: session.state,
        businessContext: session.businessContext,
        model
      });
      const startedAt = Date.now();
      const { answerSdp, callId } = await postRealtimeCall({
        offerSdp,
        instructions,
        model
      });
      logger.log('info', 'realtime call established', {
        businessId: session.businessId,
        conversationId: session.conversationId,
        callId,
        latencyMs: Date.now() - startedAt
      });
      session.used = true;
      res.writeHead(200).end(JSON.stringify({
        answerSdp,
        callId,
        businessId: session.businessId,
        conversationId: session.conversationId,
        model,
        expiresAt: new Date(session.expiresAt).toISOString()
      }));
    } catch (error) {
      res.writeHead(500).end(JSON.stringify({ error: 'realtime_webrtc_failed', detail: sanitizeErrorMessage(error) }));
    }
    return;
  }

  res.writeHead(404).end(JSON.stringify({ error: 'not_found' }));
});

server.listen(env.PORT, '0.0.0.0', () => {
  console.log(`receptionist-api listening on http://localhost:${env.PORT}`);
});
