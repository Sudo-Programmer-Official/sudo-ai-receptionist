import type { ChatRequest, ChatResponse, ConversationStateSnapshot, HealthResponse, RealtimeSessionResponse } from './types';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly url: string,
    public readonly body: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export type ApiClient = {
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
  getHealth: () => Promise<HealthResponse>;
  createRealtimeSession: (input?: { businessId?: string; state?: ConversationStateSnapshot }) => Promise<RealtimeSessionResponse>;
  connectRealtimeCall: (input: { token: string; sdp: string }) => Promise<string>;
  sendChat: (input: ChatRequest) => Promise<ChatResponse>;
};

type ApiClientConfig = {
  baseUrl: string;
  fetchImpl?: typeof fetch;
};

const normalizeBaseUrl = (value: string): string => value.replace(/\/+$/, '');

const buildUrl = (baseUrl: string, path: string): string => new URL(path, `${normalizeBaseUrl(baseUrl)}/`).toString();

const parseJson = async <T>(response: Response): Promise<T> => {
  const text = await response.text();
  if (!text) {
    return {} as T;
  }
  return JSON.parse(text) as T;
};

const createRequestHeaders = (initHeaders: HeadersInit | undefined): Headers => {
  const headers = new Headers(initHeaders);
  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json');
  }
  return headers;
};

export const createApiClient = (config: ApiClientConfig): ApiClient => {
  const fetchImpl = config.fetchImpl ?? fetch;

  const apiFetch = async (path: string, init?: RequestInit): Promise<Response> => {
    const url = buildUrl(config.baseUrl, path);
    const response = await fetchImpl(url, {
      ...init,
      headers: createRequestHeaders(init?.headers),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new ApiError(`Request failed with status ${response.status}`, response.status, url, body);
    }

    return response;
  };

  const requestJson = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const response = await apiFetch(path, init);
    return parseJson<T>(response);
  };

  const getHealth = async (): Promise<HealthResponse> => {
    try {
      return await requestJson<HealthResponse>('/health', { method: 'GET' });
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        return requestJson<HealthResponse>('/healthz', { method: 'GET' });
      }
      throw error;
    }
  };

  const createRealtimeSession = async (input?: { businessId?: string; state?: ConversationStateSnapshot }): Promise<RealtimeSessionResponse> =>
    requestJson<RealtimeSessionResponse>('/api/realtime/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(input?.businessId ? { businessId: input.businessId } : {}),
        ...(input?.state ? { state: input.state } : {}),
      }),
    });

  const connectRealtimeCall = async (input: { token: string; sdp: string }): Promise<string> => {
    const response = await apiFetch('/api/realtime/webrtc', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/sdp',
        Accept: 'application/sdp, text/plain, */*',
        'X-Realtime-Session-Token': input.token,
      },
      body: input.sdp,
    });
    return response.text();
  };

  const sendChat = async (input: ChatRequest): Promise<ChatResponse> =>
    requestJson<ChatResponse>('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: input.message,
        ...(input.conversationId ? { conversationId: input.conversationId } : {}),
        ...(input.state ? { state: input.state } : {}),
        ...(input.interrupted !== undefined ? { interrupted: input.interrupted } : {}),
      }),
    });

  return {
    apiFetch,
    getHealth,
    createRealtimeSession,
    connectRealtimeCall,
    sendChat,
  };
};
