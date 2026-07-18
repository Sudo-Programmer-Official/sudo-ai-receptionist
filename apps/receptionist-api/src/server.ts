import http from 'node:http';
import { createAgent } from '@sudo-ai-receptionist/agent-core';
import { MockBusinessAdapter } from '@sudo-ai-receptionist/mock-business';
import { createCorrelationId, redactPersonData, sanitizeErrorMessage, validateEnvironment } from '@sudo-ai-receptionist/shared';
import { validateConversationState } from '@sudo-ai-receptionist/conversation-state';

const adapter = new MockBusinessAdapter();
const agent = createAgent(adapter);
const requestCounts = new Map<string, { count: number; windowStart: number }>();
const env = {
  PORT: Number(process.env.RECEPTIONIST_API_PORT ?? '8787'),
  BUSINESS_ADAPTER: process.env.BUSINESS_ADAPTER ?? 'mock'
};

if (!Number.isFinite(env.PORT) || env.PORT <= 0) {
  throw new Error('Invalid RECEPTIONIST_API_PORT');
}

if (env.BUSINESS_ADAPTER === 'salonflow') {
  validateEnvironment(process.env, ['SALONFLOW_BASE_URL', 'SALONFLOW_INTEGRATION_TOKEN']);
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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const correlationId = req.headers['x-correlation-id']?.toString() ?? createCorrelationId();
  const clientKey = req.socket.remoteAddress ?? 'unknown';

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('x-correlation-id', correlationId);
  res.setHeader('x-content-type-options', 'nosniff');

  if (isRateLimited(clientKey)) {
    res.writeHead(429).end(JSON.stringify({ error: 'rate_limited' }));
    return;
  }

  if (url.pathname === '/healthz') {
    res.writeHead(200).end(JSON.stringify({ ok: true }));
    return;
  }

  if (url.pathname === '/api/chat' && req.method === 'POST') {
    const payload = await readJson(req) as { text?: string; state?: unknown; businessId?: string; interrupted?: boolean };
    try {
      const agentInput = {
        text: payload.text ?? '',
        ...(payload.state !== undefined ? { state: validateConversationState(payload.state) } : {}),
        businessId: payload.businessId ?? 'demo-salon',
        correlationId,
        channel: 'web' as const,
        ...(payload.interrupted !== undefined ? { interrupted: payload.interrupted } : {})
      };
      const result = await agent.handleTurn(agentInput);
      res.writeHead(200).end(JSON.stringify({ ...result, message: redactPersonData(result.message) }));
    } catch (error) {
      res.writeHead(500).end(JSON.stringify({ error: 'internal_error', detail: sanitizeErrorMessage(error) }));
    }
    return;
  }

  if (url.pathname === '/api/realtime/session' && req.method === 'POST') {
    res.writeHead(200).end(JSON.stringify({
      businessId: 'demo-salon',
      conversationId: correlationId,
      ephemeralSessionToken: `ephemeral_${correlationId}`,
      webrtcUrl: '/api/realtime/webrtc',
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString()
    }));
    return;
  }

  res.writeHead(404).end(JSON.stringify({ error: 'not_found' }));
});

server.listen(env.PORT, () => {
  console.log(`receptionist-api listening on http://localhost:${env.PORT}`);
});
