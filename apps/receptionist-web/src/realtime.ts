import type { ApiClient } from './api';
import type {
  ChatResponse,
  ConversationStateSnapshot,
  LatencyMetric,
  MicState,
  RealtimeConnectionState,
  RealtimeDiagnostics,
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
  onConnectionStateChange: (state: RealtimeConnectionState) => void;
  onMicStateChange: (state: MicState) => void;
  onTranscript: (role: 'user' | 'assistant' | 'tool', text: string) => void;
  onSessionSummary: (summary: string) => void;
  onConversationState: (state: ConversationStateSnapshot) => void;
  onToolStatus: (toolStatus: ToolStatus[]) => void;
  onMetric: (metric: LatencyMetric) => void;
  onDiagnostics: (diagnostics: RealtimeDiagnostics) => void;
  onError: (message: string) => void;
};

const DEFAULT_MODEL = 'gpt-realtime-2.1';
const DEFAULT_VOICE = 'alloy';

const safeText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const joinLines = (values: Array<string | undefined>): string =>
  values.filter((value): value is string => Boolean(value && value.trim())).join('\n');

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

const initialDiagnostics = (): RealtimeDiagnostics => ({
  peerConnectionState: 'idle',
  iceConnectionState: 'idle',
  signalingState: 'idle',
  dataChannelState: 'closed',
  localAudioTrackState: 'none',
  remoteAudioReceived: false,
  lastEventType: 'none',
  lastErrorMessage: 'none',
});

const summarizeTrack = (track: MediaStreamTrack | null | undefined, sender: RTCRtpSender | null): string => {
  if (!track) {
    return sender ? `sender:${sender.track?.readyState ?? 'attached'}` : 'none';
  }

  const senderState = sender?.track ? sender.track.readyState : 'missing';
  return `kind=${track.kind}; enabled=${track.enabled}; ready=${track.readyState}; sender=${senderState}`;
};

const createSessionUpdatePayload = (session: RealtimeSessionResponse): Record<string, unknown> => ({
  type: 'session.update',
  session: {
    instructions: session.instructions ?? '',
    voice: DEFAULT_VOICE,
    modalities: ['audio'],
    tools: [],
    tool_choice: 'none',
    turn_detection: {
      type: 'server_vad',
      create_response: true,
      interrupt_response: true,
      prefix_padding_ms: 300,
      silence_duration_ms: 350,
      threshold: 0.5,
    },
    input_audio_transcription: {
      model: 'gpt-4o-mini-transcribe',
      language: 'en',
    },
  },
});

const createChatRequest = (
  session: RealtimeSessionResponse | null,
  text: string,
  state: ConversationStateSnapshot | null,
): { text: string; businessId?: string; state?: ConversationStateSnapshot } => ({
  text,
  ...(session?.businessId ? { businessId: session.businessId } : {}),
  ...(state ? { state } : {}),
});

export class RealtimeVoiceController {
  private pc: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private micSender: RTCRtpSender | null = null;
  private session: RealtimeSessionResponse | null = null;
  private conversationState: ConversationStateSnapshot | null = null;
  private processedTranscripts = new Set<string>();
  private pendingAudioStartAt: number | null = null;
  private lastSpeechEndAt: number | null = null;
  private assistantSpeaking = false;
  private activeRequestId = 0;
  private destroyed = false;
  private connectingPromise: Promise<RealtimeSessionResponse> | null = null;
  private resolveReady: (() => void) | null = null;
  private rejectReady: ((error: Error) => void) | null = null;
  private readyPromise: Promise<void> | null = null;
  private peerConnectionOpen = false;
  private dataChannelOpen = false;
  private micAttached = false;
  private connectionState: RealtimeConnectionState = 'idle';
  private micState: MicState = 'off';
  private diagnostics: RealtimeDiagnostics = initialDiagnostics();
  private isDisconnecting = false;

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

  getConnectionState(): RealtimeConnectionState {
    return this.connectionState;
  }

  getMicState(): MicState {
    return this.micState;
  }

  getDiagnostics(): RealtimeDiagnostics {
    return this.diagnostics;
  }

  async connect(initialState?: ConversationStateSnapshot): Promise<RealtimeSessionResponse> {
    if (this.connectingPromise) {
      return this.connectingPromise;
    }

    this.destroyed = false;
    this.connectingPromise = this.connectInternal(initialState).catch((error: unknown) => {
      if (this.connectionState !== 'error') {
        this.setConnectionFailure(error instanceof Error ? error.message : 'Failed to start realtime session.');
      }
      throw error;
    }).finally(() => {
      this.connectingPromise = null;
    });
    return this.connectingPromise;
  }

  async enableMic(): Promise<void> {
    await this.ensureLocalStream();
    this.events.onMicStateChange(this.localStream ? 'enabled' : 'off');
    await this.attachLocalStreamToPeerConnection();
    if (this.pc && this.dataChannel) {
      this.events.onMicStateChange('attached');
    }
  }

  async sendText(text: string): Promise<ChatResponse> {
    return this.handleUserText(text);
  }

  async disconnect(): Promise<void> {
    this.activeRequestId += 1;
    this.pendingAudioStartAt = null;
    this.assistantSpeaking = false;
    this.isDisconnecting = true;
    if (this.rejectReady) {
      this.rejectReady(new Error('Voice session disconnected.'));
    }
    this.sendEvent({ type: 'response.cancel' });
    this.sendEvent({ type: 'output_audio_buffer.clear' });
    this.dataChannel?.close();
    this.pc?.close();
    this.localStream?.getTracks().forEach((track) => track.stop());
    this.localStream = null;
    this.audioElement.pause();
    this.audioElement.currentTime = 0;
    this.audioElement.srcObject = null;
    this.resetConnectionReferences();
    this.session = null;
    this.connectionState = 'idle';
    this.micState = 'off';
    this.updateDiagnostics({
      peerConnectionState: 'closed',
      iceConnectionState: 'closed',
      signalingState: 'closed',
      dataChannelState: 'closed',
      localAudioTrackState: 'none',
      remoteAudioReceived: false,
      lastErrorMessage: 'none',
    });
    this.events.onConnectionStateChange('idle');
    this.events.onMicStateChange('off');
    this.events.onStateChange('idle');
    this.events.onSessionSummary('Voice session disconnected.');
    this.isDisconnecting = false;
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

  private async connectInternal(initialState?: ConversationStateSnapshot): Promise<RealtimeSessionResponse> {
    this.events.onConnectionStateChange('api_connected');
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
    this.processedTranscripts.clear();
    this.pendingAudioStartAt = null;
    this.lastSpeechEndAt = null;
    this.assistantSpeaking = false;
    this.peerConnectionOpen = false;
    this.dataChannelOpen = false;
    this.micAttached = false;
    this.events.onConnectionStateChange('session_created');
    this.events.onSessionSummary(summarizeSession(session));
    this.events.onMetric({
      name: 'realtime session startup latency',
      valueMs: Math.round(performance.now() - sessionStartedAt),
      detail: 'session bootstrap',
    });

    this.resetConnectionReferences();

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });
    this.pc = pc;
    this.remoteStream = new MediaStream();
    this.audioElement.srcObject = this.remoteStream;
    this.events.onConnectionStateChange('webrtc_connecting');
    this.updateDiagnostics();
    this.attachPeerConnectionHandlers(pc, sessionStartedAt);

    await this.ensureLocalStream();
    await this.attachLocalStreamToPeerConnection();

    this.dataChannel = pc.createDataChannel('oai-events');
    this.attachDataChannelHandlers(this.dataChannel);
    this.updateDiagnostics();

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

    if (this.destroyed || this.pc !== pc) {
      return session;
    }

    await pc.setRemoteDescription({ type: 'answer', sdp: answer.answerSdp });
    this.events.onSessionSummary(`${summarizeSession(session)} · call ${answer.callId}`);
    this.events.onMetric({
      name: 'realtime call setup latency',
      valueMs: Math.round(performance.now() - sessionStartedAt),
      detail: 'sdp exchange complete',
    });

    await this.waitForConnectionReady();
    if (this.destroyed || this.pc !== pc) {
      return session;
    }

    this.sendEvent(createSessionUpdatePayload(session));
    this.events.onStateChange('listening');
    this.pendingAudioStartAt = performance.now();
    this.assistantSpeaking = false;
    this.sendEvent({ type: 'response.create' });

    return session;
  }

  private async ensureLocalStream(): Promise<MediaStream> {
    if (this.localStream) {
      return this.localStream;
    }

    this.micState = 'requesting';
    this.events.onMicStateChange(this.micState);
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.micState = 'enabled';
      this.events.onMicStateChange(this.micState);
      this.updateDiagnostics();
      return this.localStream;
    } catch (error) {
      this.micState = 'blocked';
      this.events.onMicStateChange(this.micState);
      this.setLastError(error instanceof Error ? error.message : 'Microphone permission was denied.');
      throw error instanceof Error ? error : new Error('Microphone permission was denied.');
    }
  }

  private async attachLocalStreamToPeerConnection(): Promise<void> {
    if (!this.pc || !this.localStream) {
      return;
    }

    const tracks = this.localStream.getAudioTracks();
    if (tracks.length === 0) {
      throw new Error('No microphone audio track available.');
    }

    for (const track of tracks) {
      if (track.kind !== 'audio') {
        continue;
      }
      if (this.micSender?.track?.id === track.id) {
        continue;
      }
      if (this.micSender && !this.micSender.track) {
        await this.micSender.replaceTrack(track);
      } else {
        this.micSender = this.pc.addTrack(track, this.localStream);
      }
    }

    this.micAttached = true;
    this.micState = 'attached';
    this.events.onMicStateChange(this.micState);
    this.updateDiagnostics();
    this.resolveReadyIfPossible();
  }

  private attachPeerConnectionHandlers(pc: RTCPeerConnection, sessionStartedAt: number): void {
    pc.ontrack = (event) => {
      this.diagnostics.remoteAudioReceived = true;
      const track = event.track;
      if (track && this.remoteStream && !this.remoteStream.getTracks().some((existing) => existing.id === track.id)) {
        this.remoteStream.addTrack(track);
      }
      this.audioElement.srcObject = this.remoteStream;
      void this.audioElement.play().catch(() => undefined);
      this.updateDiagnostics();
    };

    pc.onconnectionstatechange = () => {
      this.diagnostics.peerConnectionState = pc.connectionState;
      if (pc.connectionState === 'connected') {
        this.peerConnectionOpen = true;
        this.events.onConnectionStateChange('webrtc_connected');
        this.events.onMetric({
          name: 'session startup latency',
          valueMs: Math.round(performance.now() - sessionStartedAt),
          detail: 'peer connection connected',
        });
        this.resolveReadyIfPossible();
      } else if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        this.setConnectionFailure(`WebRTC connection ${pc.connectionState}.`);
      }
      this.updateDiagnostics();
    };

    pc.oniceconnectionstatechange = () => {
      this.diagnostics.iceConnectionState = pc.iceConnectionState;
      if (pc.iceConnectionState === 'failed') {
        this.setConnectionFailure('ICE negotiation failed.');
      }
      this.updateDiagnostics();
    };

    pc.onsignalingstatechange = () => {
      this.diagnostics.signalingState = pc.signalingState;
      this.updateDiagnostics();
    };
  }

  private attachDataChannelHandlers(dataChannel: RTCDataChannel): void {
    dataChannel.onopen = () => {
      this.diagnostics.dataChannelState = dataChannel.readyState;
      this.dataChannelOpen = true;
      this.events.onConnectionStateChange('data_channel_open');
      this.events.onSessionSummary(`${this.session ? summarizeSession(this.session) : 'Realtime session'} · voice ready`);
      this.updateDiagnostics();
      this.resolveReadyIfPossible();
    };

    dataChannel.onclose = () => {
      this.diagnostics.dataChannelState = dataChannel.readyState;
      this.updateDiagnostics();
      if (!this.isDisconnecting) {
        this.setConnectionFailure('Realtime data channel closed.');
      }
    };

    dataChannel.onerror = () => {
      this.diagnostics.dataChannelState = dataChannel.readyState;
      this.updateDiagnostics();
      if (!this.isDisconnecting) {
        this.setConnectionFailure('Realtime data channel error.');
      }
    };

    dataChannel.onmessage = (event) => {
      this.diagnostics.lastEventType = 'datachannel.message';
      this.updateDiagnostics();
      try {
        const parsed = JSON.parse(String(event.data)) as RealtimeEvent;
        this.handleEvent(parsed).catch((error) => {
          this.setConnectionFailure(error instanceof Error ? error.message : 'Realtime event handling failed.');
        });
      } catch {
        // Ignore malformed frames from the service.
      }
    };
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

  private waitForConnectionReady(): Promise<void> {
    if (this.connectionIsReady()) {
      return Promise.resolve();
    }

    if (!this.readyPromise) {
      this.readyPromise = new Promise<void>((resolve, reject) => {
        this.resolveReady = () => {
          this.readyPromise = null;
          this.resolveReady = null;
          this.rejectReady = null;
          resolve();
        };
        this.rejectReady = (error: Error) => {
          this.readyPromise = null;
          this.resolveReady = null;
          this.rejectReady = null;
          reject(error);
        };
      });
    }

    return this.readyPromise;
  }

  private connectionIsReady(): boolean {
    return Boolean(
      this.pc &&
      this.dataChannel &&
      this.pc.connectionState === 'connected' &&
      this.dataChannel.readyState === 'open' &&
      this.micAttached,
    );
  }

  private resolveReadyIfPossible(): void {
    if (!this.connectionIsReady() || !this.resolveReady) {
      return;
    }
    this.resolveReady();
  }

  private updateDiagnostics(partial?: Partial<RealtimeDiagnostics>): void {
    const localTrack = this.localStream?.getAudioTracks().find((track) => track.kind === 'audio') ?? null;
    this.diagnostics = {
      peerConnectionState: this.pc?.connectionState ?? 'closed',
      iceConnectionState: this.pc?.iceConnectionState ?? 'closed',
      signalingState: this.pc?.signalingState ?? 'closed',
      dataChannelState: this.dataChannel?.readyState ?? 'closed',
      localAudioTrackState: summarizeTrack(localTrack, this.micSender),
      remoteAudioReceived: this.diagnostics.remoteAudioReceived,
      lastEventType: this.diagnostics.lastEventType,
      lastErrorMessage: this.diagnostics.lastErrorMessage,
      ...partial,
    };
    this.events.onDiagnostics({ ...this.diagnostics });
  }

  private setLastError(message: string): void {
    this.diagnostics.lastErrorMessage = message;
    this.updateDiagnostics();
  }

  private setConnectionFailure(message: string): void {
    this.setLastError(message);
    if (this.rejectReady) {
      this.rejectReady(new Error(message));
    }
    this.cleanupConnectionResources(true);
    this.session = null;
    this.connectionState = 'error';
    if (this.micState !== 'blocked') {
      this.micState = 'off';
      this.events.onMicStateChange('off');
    }
    this.events.onConnectionStateChange('error');
    this.events.onStateChange('error');
    this.events.onError(message);
  }

  private cleanupConnectionResources(stopTracks: boolean): void {
    this.isDisconnecting = true;
    try {
      this.sendEvent({ type: 'response.cancel' });
      this.sendEvent({ type: 'output_audio_buffer.clear' });
      if (stopTracks) {
        this.localStream?.getTracks().forEach((track) => track.stop());
        this.localStream = null;
      }
      this.dataChannel?.close();
      this.pc?.close();
      this.audioElement.pause();
      this.audioElement.currentTime = 0;
      this.audioElement.srcObject = null;
    } finally {
      this.resetConnectionReferences();
      this.isDisconnecting = false;
      this.peerConnectionOpen = false;
      this.dataChannelOpen = false;
      this.micAttached = false;
      this.updateDiagnostics({
        dataChannelState: 'closed',
        peerConnectionState: this.pc?.connectionState ?? 'closed',
      });
    }
  }

  private resetConnectionReferences(): void {
    this.pc = null;
    this.dataChannel = null;
    this.remoteStream = null;
    this.micSender = null;
    this.resolveReady = null;
    this.rejectReady = null;
    this.readyPromise = null;
  }

  private async handleEvent(event: RealtimeEvent): Promise<void> {
    const type = safeText(event.type) || 'unknown';
    this.diagnostics.lastEventType = type;
    this.updateDiagnostics();

    switch (type) {
      case 'session.created':
      case 'session.updated':
        this.events.onSessionSummary(joinLines([
          this.session ? summarizeSession(this.session) : undefined,
          type === 'session.updated' ? 'session updated' : undefined,
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
        this.setConnectionFailure(safeText((event as { error?: { message?: string } }).error?.message) || 'Realtime error');
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
        ...createChatRequest(this.session, transcript, this.conversationState),
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
      this.setConnectionFailure(error instanceof Error ? error.message : 'The backend request failed.');
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
      ...createChatRequest(this.session, trimmed, this.conversationState),
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

export const connectRealtimeCall = (api: ApiClient, input: { token: string; sdp: string }) =>
  api.connectRealtimeCall(input);

export const formatRealtimeSessionSummary = (session: RealtimeSessionResponse): string => summarizeSession(session);
