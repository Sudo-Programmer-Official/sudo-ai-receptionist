import type { ApiClient } from './api';
import type {
  ChatResponse,
  ConversationStateSnapshot,
  LatencyMetric,
  RealtimeCallResponse,
  RealtimeSessionResponse,
  ToolStatus,
  VoiceState,
} from './types';

type RealtimeEvent = {
  type?: string;
  [key: string]: unknown;
};

type RealtimeVoiceEvents = {
  onStateChange: (state: VoiceState) => void;
  onTranscript: (role: 'user' | 'assistant' | 'tool', text: string) => void;
  onSessionSummary: (summary: string) => void;
  onConversationState: (state: ConversationStateSnapshot) => void;
  onToolStatus: (toolStatus: ToolStatus[]) => void;
  onMetric: (metric: LatencyMetric) => void;
  onError: (message: string) => void;
};

const DEFAULT_MODEL = 'gpt-realtime-2.1';

const safeText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const joinLines = (values: Array<string | undefined>): string => values.filter((value): value is string => Boolean(value && value.trim())).join('\n');

const inferVoiceState = (response: ChatResponse, fallback: VoiceState): VoiceState => {
  const message = response.message.toLowerCase();
  const status = response.state?.bookingConfirmationStatus;

  if (status === 'confirmed' || message.includes('booked') || message.includes('confirmed for')) {
    return 'booked';
  }
  if (status === 'pending' || message.includes('should i confirm')) {
    return 'confirming';
  }
  if (message.includes('phone number') || message.includes('name should')) {
    return 'collecting_customer';
  }
  if (message.includes('which one works best') || message.includes('i found these options')) {
    return 'offering_slots';
  }
  if (message.includes('availability') || response.toolStatus?.some((tool) => tool.name === 'findAvailability')) {
    return 'checking_availability';
  }
  if (message.includes('different time') || message.includes('choose one of the available times')) {
    return 'offering_slots';
  }
  return fallback;
};

const summarizeSession = (session: RealtimeSessionResponse): string => {
  const context = session.businessContext;
  const pieces = [
    `Session ${session.conversationId}`,
    `${session.model ?? DEFAULT_MODEL}`,
    context?.businessName,
    context?.serviceNames?.length ? `${context.serviceNames.slice(0, 5).join(', ')}` : undefined,
    `expires ${new Date(session.expiresAt).toLocaleTimeString()}`,
  ];
  return pieces.filter(Boolean).join(' · ');
};

export class RealtimeVoiceController {
  private pc: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private session: RealtimeSessionResponse | null = null;
  private conversationState: ConversationStateSnapshot | null = null;
  private processedTranscripts = new Set<string>();
  private pendingAudioStartAt: number | null = null;
  private lastSpeechEndAt: number | null = null;
  private assistantSpeaking = false;
  private activeRequestId = 0;
  private destroyed = false;

  constructor(
    private readonly api: ApiClient,
    private readonly events: RealtimeVoiceEvents,
    private readonly audioElement: HTMLAudioElement,
  ) {}

  getConversationState(): ConversationStateSnapshot | null {
    return this.conversationState;
  }

  getSession(): RealtimeSessionResponse | null {
    return this.session;
  }

  async connect(initialState?: ConversationStateSnapshot): Promise<RealtimeSessionResponse> {
    this.events.onStateChange('connecting');
    this.events.onSessionSummary('Requesting a short-lived realtime session from the backend...');
    const sessionStartedAt = performance.now();
    const resolvedState = initialState ?? this.conversationState ?? null;

    const session = await this.api.createRealtimeSession({
      ...(resolvedState ? { state: resolvedState } : {}),
    });

    if (this.destroyed) {
      return session;
    }

    this.session = session;
    this.conversationState = resolvedState;
    this.events.onSessionSummary(summarizeSession(session));
    this.events.onMetric({ name: 'realtime session startup latency', valueMs: Math.round(performance.now() - sessionStartedAt), detail: 'session bootstrap' });

    await this.ensureMedia();

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });
    this.pc = pc;
    this.remoteStream = new MediaStream();

    pc.ontrack = (event) => {
      for (const track of event.streams[0]?.getTracks() ?? []) {
        if (!this.remoteStream?.getTracks().some((existing) => existing.id === track.id)) {
          this.remoteStream?.addTrack(track);
        }
      }
      this.audioElement.srcObject = this.remoteStream;
      void this.audioElement.play().catch(() => undefined);
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        this.events.onStateChange('listening');
        this.events.onMetric({
          name: 'session startup latency',
          valueMs: Math.round(performance.now() - sessionStartedAt),
          detail: 'peer connection connected',
        });
      }
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        this.events.onStateChange('error');
        this.events.onError(`WebRTC connection ${pc.connectionState}.`);
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'failed') {
        this.events.onStateChange('error');
        this.events.onError('ICE negotiation failed.');
      }
    };

    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        pc.addTrack(track, this.localStream);
      }
    }

    this.dataChannel = pc.createDataChannel('oai-events');
    this.dataChannel.onopen = () => {
      this.events.onSessionSummary(`${summarizeSession(session)} · voice ready`);
    };
    this.dataChannel.onmessage = (event) => {
      try {
        const parsed = JSON.parse(String(event.data)) as RealtimeEvent;
        this.handleEvent(parsed).catch((error) => {
          this.events.onError(error instanceof Error ? error.message : 'Realtime event handling failed.');
        });
      } catch {
        // Ignore malformed frames from the service.
      }
    };
    this.dataChannel.onerror = () => {
      this.events.onError('Realtime data channel error.');
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await this.waitForIceGatheringComplete(pc);

    const localOffer = pc.localDescription?.sdp;
    if (!localOffer) {
      throw new Error('Failed to create SDP offer.');
    }

    const answer = await this.api.connectRealtimeCall({
      token: session.sessionToken,
      sdp: localOffer,
    });

    if (this.destroyed) {
      return session;
    }

    await pc.setRemoteDescription({ type: 'answer', sdp: answer.answerSdp });
    this.events.onSessionSummary(`${summarizeSession(session)} · call ${answer.callId}`);
    this.events.onMetric({
      name: 'realtime call setup latency',
      valueMs: Math.round(performance.now() - sessionStartedAt),
      detail: 'sdp exchange complete',
    });

    return session;
  }

  async sendText(text: string): Promise<ChatResponse> {
    return this.handleUserText(text);
  }

  async disconnect(): Promise<void> {
    this.activeRequestId += 1;
    this.pendingAudioStartAt = null;
    this.assistantSpeaking = false;
    this.sendEvent({ type: 'response.cancel' });
    this.sendEvent({ type: 'output_audio_buffer.clear' });
    this.dataChannel?.close();
    this.pc?.getSenders().forEach((sender) => sender.track?.stop());
    this.pc?.close();
    this.localStream?.getTracks().forEach((track) => track.stop());
    this.audioElement.pause();
    this.audioElement.currentTime = 0;
    this.audioElement.srcObject = null;
    this.pc = null;
    this.dataChannel = null;
    this.localStream = null;
    this.remoteStream = null;
    this.session = null;
    this.events.onStateChange('idle');
    this.events.onSessionSummary('Voice session disconnected.');
  }

  async interrupt(): Promise<void> {
    this.pendingAudioStartAt = null;
    this.assistantSpeaking = false;
    this.audioElement.pause();
    this.audioElement.currentTime = 0;
    this.events.onStateChange('listening');
    this.sendEvent({ type: 'response.cancel' });
    this.sendEvent({ type: 'output_audio_buffer.clear' });
  }

  async dispose(): Promise<void> {
    this.destroyed = true;
    await this.disconnect();
  }

  private async ensureMedia(): Promise<void> {
    if (this.localStream) {
      return;
    }
    this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  }

  private sendEvent(payload: Record<string, unknown>): void {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      return;
    }
    this.dataChannel.send(JSON.stringify(payload));
  }

  private async waitForIceGatheringComplete(pc: RTCPeerConnection): Promise<void> {
    if (pc.iceGatheringState === 'complete') {
      return;
    }
    await new Promise<void>((resolve) => {
      const onStateChange = (): void => {
        if (pc.iceGatheringState === 'complete') {
          pc.removeEventListener('icegatheringstatechange', onStateChange);
          resolve();
        }
      };
      pc.addEventListener('icegatheringstatechange', onStateChange);
    });
  }

  private async handleEvent(event: RealtimeEvent): Promise<void> {
    switch (event.type) {
      case 'session.created':
      case 'session.updated':
        this.events.onSessionSummary(joinLines([
          this.session ? summarizeSession(this.session) : undefined,
          event.type === 'session.updated' ? 'session updated' : undefined,
        ]));
        return;
      case 'input_audio_buffer.speech_started':
        this.lastSpeechEndAt = null;
        if (this.assistantSpeaking) {
          await this.interrupt();
        }
        this.events.onStateChange('listening');
        return;
      case 'input_audio_buffer.speech_stopped':
        this.events.onStateChange('thinking');
        return;
      case 'conversation.item.input_audio_transcription.completed': {
        const transcript = safeText(event.transcript);
        const itemId = safeText(event.item_id);
        if (!transcript || this.processedTranscripts.has(itemId)) {
          return;
        }
        if (itemId) {
          this.processedTranscripts.add(itemId);
        }
        this.lastSpeechEndAt = performance.now();
        await this.handleTranscript(transcript);
        return;
      }
      case 'response.audio.delta':
      case 'response.output_audio.delta':
        if (!this.assistantSpeaking && this.pendingAudioStartAt !== null && this.lastSpeechEndAt !== null) {
          this.assistantSpeaking = true;
          this.events.onStateChange('speaking');
          this.events.onMetric({
            name: 'user speech end to AI audio start',
            valueMs: Math.max(0, Math.round(performance.now() - this.lastSpeechEndAt)),
          });
        }
        return;
      case 'response.audio.done':
      case 'response.output_audio.done':
      case 'response.done':
        this.assistantSpeaking = false;
        this.pendingAudioStartAt = null;
        this.events.onStateChange('listening');
        return;
      case 'error':
        this.events.onStateChange('error');
        this.events.onError(safeText((event as { error?: { message?: string } }).error?.message) || 'Realtime error');
        return;
      default:
        return;
    }
  }

  private async handleTranscript(transcript: string): Promise<void> {
    if (!transcript.trim()) {
      return;
    }
    this.events.onTranscript('user', transcript);
    this.events.onStateChange('thinking');

    const requestStartedAt = performance.now();
    const requestId = ++this.activeRequestId;
    try {
      const response = await this.api.sendChat({
        text: transcript,
        ...(this.conversationState ? { state: this.conversationState } : {}),
      });

      if (requestId !== this.activeRequestId || this.destroyed) {
        return;
      }

      if (response.state) {
        this.conversationState = response.state;
        this.events.onConversationState(response.state);
      }
      this.events.onToolStatus(response.toolStatus ?? []);
      response.toolStatus?.forEach((tool) => {
        if (typeof tool.latencyMs === 'number') {
          this.events.onMetric({
            name: `${tool.name} duration`,
            valueMs: tool.latencyMs,
            detail: 'backend tool latency',
          });
        }
      });
      this.events.onMetric({
        name: 'tool-call duration',
        valueMs: Math.round(performance.now() - requestStartedAt),
        detail: 'backend /api/chat round trip',
      });

      const nextVoiceState = inferVoiceState(response, response.requiresUserAction ? 'listening' : 'speaking');
      this.events.onStateChange(nextVoiceState);
      this.events.onTranscript('assistant', response.message);
      await this.speak(response.message);
    } catch (error) {
      this.events.onStateChange('error');
      this.events.onError(error instanceof Error ? error.message : 'The backend request failed.');
    }
  }

  private async handleUserText(text: string): Promise<ChatResponse> {
    const trimmed = text.trim();
    if (!trimmed) {
      throw new Error('Empty message.');
    }

    this.events.onTranscript('user', trimmed);
    this.events.onStateChange('thinking');
    const requestStartedAt = performance.now();
    const requestId = ++this.activeRequestId;
    const response = await this.api.sendChat({
      text: trimmed,
      ...(this.conversationState ? { state: this.conversationState } : {}),
    });

    if (requestId !== this.activeRequestId || this.destroyed) {
      return response;
    }

    if (response.state) {
      this.conversationState = response.state;
      this.events.onConversationState(response.state);
    }
    this.events.onToolStatus(response.toolStatus ?? []);
    response.toolStatus?.forEach((tool) => {
      if (typeof tool.latencyMs === 'number') {
        this.events.onMetric({
          name: `${tool.name} duration`,
          valueMs: tool.latencyMs,
          detail: 'backend tool latency',
        });
      }
    });
    this.events.onMetric({
      name: 'tool-call duration',
      valueMs: Math.round(performance.now() - requestStartedAt),
      detail: 'backend /api/chat round trip',
    });

    const nextVoiceState = inferVoiceState(response, response.requiresUserAction ? 'listening' : 'speaking');
    this.events.onStateChange(nextVoiceState);
    this.events.onTranscript('assistant', response.message);
    await this.speak(response.message);
    return response;
  }

  private async speak(message: string): Promise<void> {
    if (!message.trim()) {
      return;
    }
    this.pendingAudioStartAt = performance.now();
    this.assistantSpeaking = false;
    this.sendEvent({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'input_text',
            text: message,
          },
        ],
      },
    });
    this.sendEvent({ type: 'response.create' });
  }
}

export const requestRealtimeSession = (api: ApiClient, input?: { businessId?: string; state?: ConversationStateSnapshot }): Promise<RealtimeSessionResponse> =>
  api.createRealtimeSession(input);

export const connectRealtimeCall = (api: ApiClient, input: { token: string; sdp: string }): Promise<RealtimeCallResponse> =>
  api.connectRealtimeCall(input);

export const formatRealtimeSessionSummary = (session: RealtimeSessionResponse): string => summarizeSession(session);
