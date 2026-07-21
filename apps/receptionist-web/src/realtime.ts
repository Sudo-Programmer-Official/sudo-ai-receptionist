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
const RENDERER_INSTRUCTIONS = 'You are the voice renderer for an AI receptionist. Speak the supplied response naturally and exactly. Do not make booking decisions, call tools, ask additional questions, or change appointment details.';
const ICE_GATHERING_TIMEOUT_MS = 3_000;
const CONNECTION_READY_TIMEOUT_MS = 5_000;
const DISCONNECTED_RECOVERY_TIMEOUT_MS = 5_000;

const safeText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export const getTranscriptEventDeduplicationKey = (event: RealtimeEvent): string | undefined => {
  const itemId = safeText(event.item_id);
  const eventId = safeText(event.event_id) || safeText(event.id);
  return eventId || itemId || undefined;
};

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
  connectionAttemptId: 0,
  connectInFlight: false,
  sessionRequestCount: 0,
  webrtcRequestCount: 0,
  peerConnectionState: 'idle',
  iceConnectionState: 'idle',
  signalingState: 'idle',
  dataChannelState: 'closed',
  localAudioTrackState: 'none',
  remoteAudioReceived: false,
  lastEventType: 'none',
  lastErrorMessage: 'none',
  lastErrorSource: 'none',
  lastSuccessfulMilestone: 'idle',
  finalTranscriptCount: 0,
  duplicateTranscriptEventsIgnored: 0,
  interruptionCount: 0,
  lastSpeechEndToAudioStartMs: null,
  lastChatRequestState: 'none',
});

const summarizeTrack = (track: MediaStreamTrack | null | undefined, sender: RTCRtpSender | null): string => {
  if (!track) {
    return sender ? `sender:${sender.track?.readyState ?? 'attached'}` : 'none';
  }

  const senderState = sender?.track ? sender.track.readyState : 'missing';
  return `kind=${track.kind}; enabled=${track.enabled}; ready=${track.readyState}; sender=${senderState}`;
};

const createSessionUpdatePayload = (_session: RealtimeSessionResponse): Record<string, unknown> => ({
  type: 'session.update',
  session: {
    instructions: RENDERER_INSTRUCTIONS,
    voice: DEFAULT_VOICE,
    modalities: ['audio'],
    tools: [],
    tool_choice: 'none',
    turn_detection: {
      type: 'server_vad',
      create_response: false,
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
  state: ConversationStateSnapshot | null,
  text: string,
): { message: string; conversationId?: string } => {
  const conversationId = session?.conversationId ?? state?.conversationId;
  return {
    message: text,
    ...(conversationId ? { conversationId } : {}),
  };
};

export class RealtimeVoiceController {
  private pc: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private micSender: RTCRtpSender | null = null;
  private session: RealtimeSessionResponse | null = null;
  private conversationState: ConversationStateSnapshot | null = null;
  private processedTranscripts = new Set<string>();
  private finalTranscriptCount = 0;
  private duplicateTranscriptEventsIgnored = 0;
  private interruptionCount = 0;
  private pendingAudioStartAt: number | null = null;
  private lastSpeechEndAt: number | null = null;
  private lastSpeechEndToAudioStartMs: number | null = null;
  private assistantSpeaking = false;
  private activeRequestId = 0;
  private connectionAttemptId = 0;
  private sessionRequestCount = 0;
  private webrtcRequestCount = 0;
  private activeTimeoutNames = new Set<string>();
  private connectStartedAtMs: number | null = null;
  private destroyed = false;
  private connectPromise: Promise<RealtimeSessionResponse | null> | null = null;
  private resolveReady: (() => void) | null = null;
  private rejectReady: ((error: Error) => void) | null = null;
  private readyPromise: Promise<void> | null = null;
  private connectionReadyTimeoutId: number | null = null;
  private disconnectedTimeoutId: number | null = null;
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

  isConnectInFlight(): boolean {
    return Boolean(this.connectPromise);
  }

  connect(initialState?: ConversationStateSnapshot): Promise<RealtimeSessionResponse | null> {
    if (this.connectPromise) {
      return this.connectPromise;
    }

    if (this.pc?.connectionState === 'connected' || this.dataChannel?.readyState === 'open') {
      return Promise.resolve(this.session);
    }

    this.destroyed = false;
    const attemptId = ++this.connectionAttemptId;
    this.connectStartedAtMs = performance.now();
    this.clearTransientConnectionError();
    this.updateDiagnostics({
      connectionAttemptId: attemptId,
      connectInFlight: true,
      lastSuccessfulMilestone: 'connecting',
    });
    this.connectPromise = this.performConnect(initialState, attemptId)
      .catch((error: unknown) => {
        if (!this.isCurrentAttempt(attemptId)) {
          return null;
        }
        if (error instanceof Error && error.message === 'Connection attempt superseded.') {
          return null;
        }
        this.setConnectionFailure(
          error instanceof Error ? error.message : 'Failed to start realtime session.',
          'connect',
          attemptId,
        );
        throw error;
      })
      .finally(() => {
        if (this.connectionAttemptId === attemptId) {
          this.connectPromise = null;
          this.updateDiagnostics({ connectInFlight: false });
        }
    });
    return this.connectPromise;
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
    this.connectionAttemptId += 1;
    this.activeRequestId += 1;
    this.pendingAudioStartAt = null;
    this.assistantSpeaking = false;
    this.isDisconnecting = true;
    this.setDisconnectReason('explicit_end_call');
    this.clearConnectionTimers();
    if (this.connectPromise) {
      this.connectPromise = null;
      this.updateDiagnostics({ connectInFlight: false });
    }
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
    this.connectStartedAtMs = null;
    this.activeTimeoutNames.clear();
    this.updateDiagnostics({
      peerConnectionState: 'closed',
      iceConnectionState: 'closed',
      signalingState: 'closed',
      dataChannelState: 'closed',
      localAudioTrackState: 'none',
      remoteAudioReceived: false,
      lastErrorMessage: 'none',
      lastSpeechEndToAudioStartMs: null,
      finalTranscriptCount: this.finalTranscriptCount,
      duplicateTranscriptEventsIgnored: this.duplicateTranscriptEventsIgnored,
      interruptionCount: this.interruptionCount,
      lastChatRequestState: this.connectionState,
    });
    this.events.onConnectionStateChange('idle');
    this.events.onMicStateChange('off');
    this.events.onStateChange('idle');
    this.events.onSessionSummary('Voice session disconnected.');
    this.isDisconnecting = false;
    this.clearTransientConnectionError();
  }

  async interrupt(): Promise<void> {
    this.interruptionCount += 1;
    this.pendingAudioStartAt = null;
    this.assistantSpeaking = false;
    this.audioElement.pause();
    this.audioElement.currentTime = 0;
    console.info(JSON.stringify({
      scope: 'receptionist-web',
      event: 'assistant_interrupted',
      interruptionCount: this.interruptionCount,
    }));
    this.events.onStateChange('interrupted');
    this.updateDiagnostics();
    this.events.onStateChange('listening');
    this.sendEvent({ type: 'response.cancel' });
    this.sendEvent({ type: 'output_audio_buffer.clear' });
  }

  async dispose(): Promise<void> {
    this.destroyed = true;
    await this.disconnect();
  }

  private async performConnect(initialState: ConversationStateSnapshot | undefined, attemptId: number): Promise<RealtimeSessionResponse | null> {
    if (!this.isCurrentAttempt(attemptId)) {
      return null;
    }
    this.events.onConnectionStateChange('api_connected');
    this.logTransition('api_connected', attemptId);
    this.events.onStateChange('connecting');
    this.events.onSessionSummary('Requesting a short-lived realtime session from the backend...');
    const sessionStartedAt = performance.now();
    const resolvedState = initialState ?? this.conversationState ?? null;

    this.session = null;
    this.conversationState = resolvedState;
    this.clearTransientConnectionError();
    this.updateDiagnostics({
      connectionAttemptId: attemptId,
      connectInFlight: true,
      lastSuccessfulMilestone: 'requesting session',
    });
    this.sessionRequestCount += 1;
    this.updateDiagnostics({ sessionRequestCount: this.sessionRequestCount });
    const session = await this.api.createRealtimeSession({
      ...(resolvedState ? { state: resolvedState } : {}),
    });

    if (!this.isCurrentAttempt(attemptId) || this.destroyed) {
      return null;
    }

    this.session = session;
    this.processedTranscripts.clear();
    this.finalTranscriptCount = 0;
    this.duplicateTranscriptEventsIgnored = 0;
    this.interruptionCount = 0;
    this.pendingAudioStartAt = null;
    this.lastSpeechEndAt = null;
    this.lastSpeechEndToAudioStartMs = null;
    this.assistantSpeaking = false;
    this.peerConnectionOpen = false;
    this.dataChannelOpen = false;
    this.micAttached = false;
    this.updateDiagnostics({
      lastSuccessfulMilestone: 'session created',
    });
    this.events.onConnectionStateChange('session_created');
    this.logTransition('session_created', attemptId);
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
    this.logTransition('webrtc_connecting', attemptId);
    this.updateDiagnostics();
    this.attachPeerConnectionHandlers(pc, sessionStartedAt, attemptId);

    await this.ensureLocalStream();
    await this.attachLocalStreamToPeerConnection();

    this.dataChannel = pc.createDataChannel('oai-events');
    this.attachDataChannelHandlers(this.dataChannel, attemptId);
    this.updateDiagnostics();

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await this.waitForIceGatheringComplete(pc, attemptId);

    const localOffer = pc.localDescription?.sdp;
    if (!localOffer) {
      throw new Error('Failed to create SDP offer.');
    }

    if (!this.isCurrentAttempt(attemptId)) {
      return null;
    }
    this.webrtcRequestCount += 1;
    this.updateDiagnostics({ webrtcRequestCount: this.webrtcRequestCount, lastSuccessfulMilestone: 'posting sdp' });
    const answerSdp = await this.api.connectRealtimeCall({
      token: session.sessionToken,
      sdp: localOffer,
    });

    if (!this.isCurrentAttempt(attemptId) || this.destroyed || this.pc !== pc) {
      return null;
    }

    await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
    if (!this.isCurrentAttempt(attemptId) || this.destroyed || this.pc !== pc) {
      return null;
    }
    this.events.onSessionSummary(`${summarizeSession(session)} · call established`);
    this.events.onMetric({
      name: 'realtime call setup latency',
      valueMs: Math.round(performance.now() - sessionStartedAt),
      detail: 'sdp exchange complete',
    });
    this.updateDiagnostics({ lastSuccessfulMilestone: 'answer applied' });

    await this.waitForConnectionReady(attemptId);
    if (!this.isCurrentAttempt(attemptId) || this.destroyed || this.pc !== pc) {
      return null;
    }

    this.clearConnectionTimers();
    this.updateDiagnostics({ lastSuccessfulMilestone: 'connection ready' });
    this.sendEvent(createSessionUpdatePayload(session));
    this.events.onStateChange('listening');
    this.assistantSpeaking = false;
    this.pendingAudioStartAt = null;
    this.updateDiagnostics();

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

  private attachPeerConnectionHandlers(pc: RTCPeerConnection, sessionStartedAt: number, attemptId: number): void {
    pc.ontrack = (event) => {
      if (!this.isCurrentAttempt(attemptId) || this.pc !== pc) {
        return;
      }
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
      if (!this.isCurrentAttempt(attemptId) || this.pc !== pc) {
        return;
      }
      this.diagnostics.peerConnectionState = pc.connectionState;
      this.logTransition('peer_connection_state_change', attemptId);
      if (pc.connectionState === 'connected') {
        this.clearDisconnectedRecoveryTimer();
        this.peerConnectionOpen = true;
        this.setDisconnectReason('connected');
        this.events.onConnectionStateChange('webrtc_connected');
        this.events.onMetric({
          name: 'session startup latency',
          valueMs: Math.round(performance.now() - sessionStartedAt),
          detail: 'peer connection connected',
        });
        this.clearConnectionTimers();
        this.updateDiagnostics({ lastSuccessfulMilestone: 'peer connection connected' });
        this.resolveReadyIfPossible();
      } else if (pc.connectionState === 'failed') {
        this.setConnectionFailure('WebRTC connection failed.', 'peer_connection_failed', attemptId);
      } else if (pc.connectionState === 'disconnected') {
        if (this.peerConnectionOpen || this.dataChannelOpen || this.connectionIsReady()) {
          this.scheduleDisconnectedRecoveryFailure(pc, attemptId);
        } else {
          this.updateDiagnostics({ lastSuccessfulMilestone: 'peer connection disconnected' });
        }
      } else if (pc.connectionState === 'closed' && !this.isDisconnecting) {
        this.setConnectionFailure(`WebRTC connection ${pc.connectionState}.`, 'peer_connection', attemptId);
      }
      this.updateDiagnostics();
    };

    pc.oniceconnectionstatechange = () => {
      if (!this.isCurrentAttempt(attemptId) || this.pc !== pc) {
        return;
      }
      this.diagnostics.iceConnectionState = pc.iceConnectionState;
      this.logTransition('ice_connection_state_change', attemptId);
      if (pc.iceConnectionState === 'failed') {
        this.setConnectionFailure('ICE negotiation failed.', 'ice_connection_failed', attemptId);
      }
      this.updateDiagnostics();
    };

    pc.onsignalingstatechange = () => {
      if (!this.isCurrentAttempt(attemptId) || this.pc !== pc) {
        return;
      }
      this.diagnostics.signalingState = pc.signalingState;
      this.logTransition('signaling_state_change', attemptId);
      this.updateDiagnostics();
    };
  }

  private attachDataChannelHandlers(dataChannel: RTCDataChannel, attemptId: number): void {
    dataChannel.onopen = () => {
      if (!this.isCurrentAttempt(attemptId) || this.dataChannel !== dataChannel) {
        return;
      }
      this.diagnostics.dataChannelState = dataChannel.readyState;
      this.dataChannelOpen = true;
      this.setDisconnectReason('connected');
      this.clearConnectionTimers();
      this.events.onConnectionStateChange('data_channel_open');
      this.logTransition('data_channel_open', attemptId);
      this.events.onSessionSummary(`${this.session ? summarizeSession(this.session) : 'Realtime session'} · voice ready`);
      this.updateDiagnostics({ lastSuccessfulMilestone: 'data channel open' });
      this.updateDiagnostics();
      this.resolveReadyIfPossible();
    };

    dataChannel.onclose = () => {
      if (!this.isCurrentAttempt(attemptId) || this.dataChannel !== dataChannel) {
        return;
      }
      this.diagnostics.dataChannelState = dataChannel.readyState;
      this.logTransition('data_channel_close', attemptId);
      this.updateDiagnostics();
      if (!this.isDisconnecting) {
        this.setConnectionFailure('Realtime data channel closed.', 'data_channel_closed', attemptId);
      }
    };

    dataChannel.onerror = () => {
      if (!this.isCurrentAttempt(attemptId) || this.dataChannel !== dataChannel) {
        return;
      }
      this.diagnostics.dataChannelState = dataChannel.readyState;
      this.logTransition('data_channel_error', attemptId);
      this.updateDiagnostics();
      if (!this.isDisconnecting) {
        this.setConnectionFailure('Realtime data channel error.', 'data_channel_error', attemptId);
      }
    };

    dataChannel.onmessage = (event) => {
      if (!this.isCurrentAttempt(attemptId) || this.dataChannel !== dataChannel) {
        return;
      }
      this.diagnostics.lastEventType = 'datachannel.message';
      this.updateDiagnostics();
      try {
        const parsed = JSON.parse(String(event.data)) as RealtimeEvent;
        this.handleEvent(parsed).catch((error) => {
          this.setConnectionFailure(error instanceof Error ? error.message : 'Realtime event handling failed.', 'data_channel', attemptId);
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

  private async waitForIceGatheringComplete(pc: RTCPeerConnection, attemptId: number): Promise<void> {
    if (pc.iceGatheringState === 'complete') {
      return;
    }
    await new Promise<void>((resolve) => {
      this.setActiveTimeout('ice_gathering_timeout');
      const timeoutId = window.setTimeout(() => {
        this.clearActiveTimeout('ice_gathering_timeout');
        pc.removeEventListener('icegatheringstatechange', onStateChange);
        resolve();
      }, ICE_GATHERING_TIMEOUT_MS);
      const onStateChange = (): void => {
        if (!this.isCurrentAttempt(attemptId) || this.pc !== pc) {
          window.clearTimeout(timeoutId);
          this.clearActiveTimeout('ice_gathering_timeout');
          pc.removeEventListener('icegatheringstatechange', onStateChange);
          resolve();
          return;
        }
        if (pc.iceGatheringState === 'complete') {
          window.clearTimeout(timeoutId);
          this.clearActiveTimeout('ice_gathering_timeout');
          pc.removeEventListener('icegatheringstatechange', onStateChange);
          resolve();
        }
      };
      pc.addEventListener('icegatheringstatechange', onStateChange);
    });
  }

  private waitForConnectionReady(attemptId: number): Promise<void> {
    if (this.connectionIsReady()) {
      return Promise.resolve();
    }

    if (!this.readyPromise) {
      this.readyPromise = new Promise<void>((resolve, reject) => {
        this.clearConnectionReadyTimeout();
        this.setActiveTimeout('connection_ready_timeout');
        this.connectionReadyTimeoutId = window.setTimeout(() => {
          if (!this.isCurrentAttempt(attemptId)) {
            return;
          }
          this.clearConnectionReadyTimeout();
          this.clearActiveTimeout('connection_ready_timeout');
          reject(new Error('Realtime connection readiness timed out.'));
        }, CONNECTION_READY_TIMEOUT_MS);
        this.resolveReady = () => {
          this.clearConnectionReadyTimeout();
          this.clearActiveTimeout('connection_ready_timeout');
          this.readyPromise = null;
          this.resolveReady = null;
          this.rejectReady = null;
          resolve();
        };
        this.rejectReady = (error: Error) => {
          this.clearConnectionReadyTimeout();
          this.clearActiveTimeout('connection_ready_timeout');
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
      ...this.diagnostics,
      peerConnectionState: this.pc?.connectionState ?? 'closed',
      iceConnectionState: this.pc?.iceConnectionState ?? 'closed',
      signalingState: this.pc?.signalingState ?? 'closed',
      dataChannelState: this.dataChannel?.readyState ?? 'closed',
      localAudioTrackState: summarizeTrack(localTrack, this.micSender),
      ...partial,
    };
    this.events.onDiagnostics({ ...this.diagnostics });
  }

  private setLastError(message: string, source = 'unknown'): void {
    this.updateDiagnostics({
      lastErrorMessage: message,
      lastErrorSource: source,
    });
  }

  private clearTransientConnectionError(): void {
    this.updateDiagnostics({
      lastErrorMessage: 'none',
      lastErrorSource: 'none',
    });
  }

  private isCurrentAttempt(attemptId: number): boolean {
    return this.connectionAttemptId === attemptId && !this.destroyed;
  }

  private clearConnectionReadyTimeout(): void {
    if (this.connectionReadyTimeoutId !== null) {
      window.clearTimeout(this.connectionReadyTimeoutId);
      this.connectionReadyTimeoutId = null;
    }
  }

  private clearConnectionTimers(): void {
    this.clearConnectionReadyTimeout();
    this.clearDisconnectedRecoveryTimer();
    this.clearActiveTimeout('connection_ready_timeout');
    this.clearActiveTimeout('disconnected_recovery_timeout');
    this.clearActiveTimeout('ice_gathering_timeout');
  }

  private clearDisconnectedRecoveryTimer(): void {
    if (this.disconnectedTimeoutId !== null) {
      window.clearTimeout(this.disconnectedTimeoutId);
      this.disconnectedTimeoutId = null;
    }
  }

  private scheduleDisconnectedRecoveryFailure(pc: RTCPeerConnection, attemptId: number): void {
    this.clearDisconnectedRecoveryTimer();
    this.setActiveTimeout('disconnected_recovery_timeout');
    this.updateDiagnostics({
      lastSuccessfulMilestone: 'peer connection disconnected',
      lastErrorSource: 'peer_connection_disconnected_pending',
      disconnectReason: 'peer_connection_disconnected',
    });
    this.disconnectedTimeoutId = window.setTimeout(() => {
      if (!this.isCurrentAttempt(attemptId) || this.pc !== pc || this.isDisconnecting) {
        return;
      }
      this.clearActiveTimeout('disconnected_recovery_timeout');
      if (pc.connectionState === 'connected') {
        return;
      }
      this.setConnectionFailure('WebRTC connection disconnected.', 'peer_connection_disconnected', attemptId);
    }, DISCONNECTED_RECOVERY_TIMEOUT_MS);
  }

  private setConnectionFailure(message: string, source = 'unknown', attemptId = this.connectionAttemptId): void {
    if (!this.isCurrentAttempt(attemptId)) {
      return;
    }
    this.clearConnectionReadyTimeout();
    this.clearDisconnectedRecoveryTimer();
    this.clearConnectionTimers();
    this.setLastError(message, source);
    this.setDisconnectReason(source);
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
    this.clearConnectionReadyTimeout();
    this.clearDisconnectedRecoveryTimer();
    this.clearConnectionTimers();
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
        this.logTransition(type, this.connectionAttemptId);
        this.events.onSessionSummary(joinLines([
          this.session ? summarizeSession(this.session) : undefined,
          type === 'session.updated' ? 'session updated' : undefined,
        ]));
        return;
    case 'input_audio_buffer.speech_started':
        this.logTransition(type, this.connectionAttemptId);
        this.lastSpeechEndAt = null;
        if (this.assistantSpeaking) {
          await this.interrupt();
        }
        this.events.onStateChange('listening');
        return;
      case 'input_audio_buffer.speech_stopped':
        this.logTransition(type, this.connectionAttemptId);
        this.events.onStateChange('thinking');
        return;
      case 'conversation.item.input_audio_transcription.completed': {
        this.logTransition(type, this.connectionAttemptId);
        const transcript = safeText(event.transcript);
        const dedupeKey = getTranscriptEventDeduplicationKey(event);
        if (!transcript) {
          return;
        }
        this.finalTranscriptCount += 1;
        this.updateDiagnostics();
        if (dedupeKey && this.processedTranscripts.has(dedupeKey)) {
          this.duplicateTranscriptEventsIgnored += 1;
          this.updateDiagnostics();
          console.info(JSON.stringify({
            scope: 'receptionist-web',
            event: 'duplicate_transcript_ignored',
            duplicateCount: this.duplicateTranscriptEventsIgnored,
          }));
          return;
        }
        if (dedupeKey) {
          this.processedTranscripts.add(dedupeKey);
        }
        this.events.onStateChange('transcribing');
        this.lastSpeechEndAt = performance.now();
        console.info(JSON.stringify({
          scope: 'receptionist-web',
          event: 'final_transcription_received',
          transcriptLength: transcript.length,
          duplicateIgnored: false,
        }));
        await this.handleTranscript(transcript);
        return;
      }
      case 'response.audio.delta':
      case 'response.output_audio.delta':
        this.logTransition(type, this.connectionAttemptId);
        if (!this.assistantSpeaking && this.pendingAudioStartAt !== null && this.lastSpeechEndAt !== null) {
          this.assistantSpeaking = true;
          this.events.onStateChange('speaking');
          this.lastSpeechEndToAudioStartMs = Math.max(0, Math.round(performance.now() - this.lastSpeechEndAt));
          console.info(JSON.stringify({
            scope: 'receptionist-web',
            event: 'assistant_audio_started',
            speechEndToAudioStartMs: this.lastSpeechEndToAudioStartMs,
          }));
          this.events.onMetric({
            name: 'user speech end to AI audio start',
            valueMs: this.lastSpeechEndToAudioStartMs,
          });
          this.updateDiagnostics();
        }
        return;
      case 'response.audio.done':
      case 'response.output_audio.done':
      case 'response.done':
        this.logTransition(type, this.connectionAttemptId);
        this.assistantSpeaking = false;
        this.pendingAudioStartAt = null;
        this.events.onStateChange('listening');
        this.updateDiagnostics();
        console.info(JSON.stringify({
          scope: 'receptionist-web',
          event: 'assistant_audio_completed',
        }));
        return;
      case 'error':
        this.logTransition(type, this.connectionAttemptId);
        this.setConnectionFailure(
          safeText((event as { error?: { message?: string } }).error?.message) || 'Realtime error',
          'realtime_event',
        );
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
    console.info(JSON.stringify({
      scope: 'receptionist-web',
      event: 'chat_request_started',
      hasConversationId: Boolean(this.session?.conversationId || this.conversationState?.conversationId),
    }));
    this.updateDiagnostics({
      finalTranscriptCount: this.finalTranscriptCount,
      duplicateTranscriptEventsIgnored: this.duplicateTranscriptEventsIgnored,
      interruptionCount: this.interruptionCount,
      lastChatRequestState: 'thinking',
    });

    const requestStartedAt = performance.now();
    const requestId = ++this.activeRequestId;
    try {
      const response = await this.api.sendChat({
        ...createChatRequest(this.session, this.conversationState, transcript),
      });

      if (requestId !== this.activeRequestId || this.destroyed) {
        return;
      }

      console.info(JSON.stringify({
        scope: 'receptionist-web',
        event: 'chat_request_completed',
        messageLength: response.message.length,
      }));
      this.updateDiagnostics({
        finalTranscriptCount: this.finalTranscriptCount,
        duplicateTranscriptEventsIgnored: this.duplicateTranscriptEventsIgnored,
        interruptionCount: this.interruptionCount,
        lastChatRequestState: 'completed',
      });
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
      console.info(JSON.stringify({
        scope: 'receptionist-web',
        event: 'assistant_speech_requested',
        messageLength: response.message.length,
      }));
      await this.speak(response.message);
    } catch (error) {
      this.setConnectionFailure(error instanceof Error ? error.message : 'The backend request failed.', 'chat');
    }
  }

  private setActiveTimeout(name: string): void {
    this.activeTimeoutNames.add(name);
    this.updateDiagnostics({ activeTimeoutNames: [...this.activeTimeoutNames] });
  }

  private clearActiveTimeout(name: string): void {
    if (!this.activeTimeoutNames.has(name)) {
      return;
    }
    this.activeTimeoutNames.delete(name);
    this.updateDiagnostics({ activeTimeoutNames: [...this.activeTimeoutNames] });
  }

  private setDisconnectReason(reason: string): void {
    this.updateDiagnostics({ disconnectReason: reason });
  }

  private logTransition(source: string, attemptId = this.connectionAttemptId): void {
    console.info(JSON.stringify({
      scope: 'receptionist-web',
      event: 'realtime_transition',
      attemptId,
      source,
      pcState: this.pc?.connectionState ?? 'closed',
      iceState: this.pc?.iceConnectionState ?? 'closed',
      dataChannelState: this.dataChannel?.readyState ?? 'closed',
      elapsedMs: this.connectStartedAtMs === null ? null : Math.max(0, Math.round(performance.now() - this.connectStartedAtMs)),
      activeTimeoutNames: [...this.activeTimeoutNames],
      disconnectReason: this.diagnostics.disconnectReason ?? 'none',
      errorSource: this.diagnostics.lastErrorSource,
    }));
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
      ...createChatRequest(this.session, this.conversationState, trimmed),
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
    console.info(JSON.stringify({
      scope: 'receptionist-web',
      event: 'assistant_speech_requested',
      messageLength: response.message.length,
    }));
    await this.speak(response.message);
    return response;
  }

  private async speak(message: string): Promise<void> {
    if (!message.trim()) {
      return;
    }
    this.pendingAudioStartAt = performance.now();
    this.assistantSpeaking = false;
    this.updateDiagnostics();
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
