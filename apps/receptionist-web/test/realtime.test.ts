import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { RealtimeVoiceController, getTranscriptEventDeduplicationKey } from '../src/realtime';
import type { ApiClient } from '../src/api';
import type { ChatResponse, ConversationStateSnapshot, RealtimeSessionResponse } from '../src/types';

type DataChannelFrame = Record<string, unknown>;

class FakeMediaStreamTrack {
  readonly kind = 'audio';
  readonly id = `track_${Math.random().toString(36).slice(2, 10)}`;
  enabled = true;
  readyState: MediaStreamTrackState = 'live';

  stop(): void {
    this.readyState = 'ended';
  }
}

class FakeMediaStream {
  private readonly tracks: FakeMediaStreamTrack[] = [];

  addTrack(track: FakeMediaStreamTrack): void {
    if (!this.tracks.some((existing) => existing.id === track.id)) {
      this.tracks.push(track);
    }
  }

  getAudioTracks(): FakeMediaStreamTrack[] {
    return this.tracks.filter((track) => track.kind === 'audio');
  }

  getTracks(): FakeMediaStreamTrack[] {
    return [...this.tracks];
  }
}

class FakeDataChannel {
  readyState: RTCDataChannelState = 'connecting';
  onopen: ((this: RTCDataChannel, ev: Event) => unknown) | null = null;
  onclose: ((this: RTCDataChannel, ev: Event) => unknown) | null = null;
  onerror: ((this: RTCDataChannel, ev: Event) => unknown) | null = null;
  onmessage: ((this: RTCDataChannel, ev: MessageEvent) => unknown) | null = null;
  readonly sent: string[] = [];

  open(): void {
    this.readyState = 'open';
    this.onopen?.(new Event('open') as Event);
  }

  close(): void {
    this.readyState = 'closed';
    this.onclose?.(new Event('close') as Event);
  }

  send(payload: string): void {
    this.sent.push(payload);
  }

  emit(frame: DataChannelFrame): void {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(frame) }));
  }
}

class FakeRTCPeerConnection {
  static localDescriptionSdpOverride: string | null = null;
  static omitLocalDescription = false;

  connectionState: RTCPeerConnectionState = 'new';
  iceConnectionState: RTCIceConnectionState = 'new';
  signalingState: RTCSignalingState = 'stable';
  iceGatheringState: RTCIceGatheringState = 'new';
  ontrack: ((this: RTCPeerConnection, ev: RTCTrackEvent) => unknown) | null = null;
  onconnectionstatechange: ((this: RTCPeerConnection, ev: Event) => unknown) | null = null;
  oniceconnectionstatechange: ((this: RTCPeerConnection, ev: Event) => unknown) | null = null;
  onsignalingstatechange: ((this: RTCPeerConnection, ev: Event) => unknown) | null = null;
  localDescription: RTCSessionDescription | null = null;
  readonly dataChannels: FakeDataChannel[] = [];
  private readonly listeners = new Map<string, Set<() => void>>();
  private readonly sender = {
    track: null as FakeMediaStreamTrack | null,
    replaceTrack: vi.fn(async (track: FakeMediaStreamTrack | null) => {
      this.sender.track = track;
    }),
  } as unknown as RTCRtpSender;

  addEventListener(type: string, handler: EventListenerOrEventListenerObject): void {
    if (typeof handler !== 'function') {
      return;
    }
    const handlers = this.listeners.get(type) ?? new Set<() => void>();
    handlers.add(handler);
    this.listeners.set(type, handlers);
  }

  removeEventListener(type: string, handler: EventListenerOrEventListenerObject): void {
    if (typeof handler !== 'function') {
      return;
    }
    this.listeners.get(type)?.delete(handler);
  }

  addTrack(track: FakeMediaStreamTrack): RTCRtpSender {
    this.sender.track = track;
    return this.sender;
  }

  createDataChannel(): RTCDataChannel {
    const channel = new FakeDataChannel() as unknown as RTCDataChannel;
    this.dataChannels.push(channel as unknown as FakeDataChannel);
    queueMicrotask(() => {
      (channel as unknown as FakeDataChannel).open();
    });
    return channel;
  }

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    return { type: 'offer', sdp: 'fake-offer-sdp' };
  }

  async setLocalDescription(description: RTCSessionDescriptionInit): Promise<void> {
    this.localDescription = FakeRTCPeerConnection.omitLocalDescription
      ? null
      : {
        type: description.type,
        sdp: FakeRTCPeerConnection.localDescriptionSdpOverride ?? description.sdp ?? null,
      } as RTCSessionDescription;
    this.iceGatheringState = 'complete';
    this.listeners.get('icegatheringstatechange')?.forEach((handler) => handler());
  }

  async setRemoteDescription(_description: RTCSessionDescriptionInit): Promise<void> {
    this.connectionState = 'connected';
    this.onconnectionstatechange?.(new Event('connectionstatechange'));
  }

  close(): void {
    this.connectionState = 'closed';
    this.onconnectionstatechange?.(new Event('connectionstatechange'));
    for (const channel of this.dataChannels) {
      channel.close();
    }
  }
}

const makeSession = (overrides: Partial<RealtimeSessionResponse> = {}): RealtimeSessionResponse => ({
  businessId: 'demo-salon',
  conversationId: 'conv-1',
  sessionToken: 'session_1',
  ephemeralSessionToken: 'session_1',
  webrtcUrl: '/api/realtime/webrtc',
  expiresAt: '2026-07-20T00:10:00.000Z',
  model: 'gpt-realtime-2.1',
  instructions: 'voice renderer',
  businessContext: {
    businessName: 'Demo Salon',
    serviceNames: ['Haircut'],
  },
  ...overrides,
});

const flush = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => queueMicrotask(resolve));
};

const microFlush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('realtime transcript dedupe', () => {
  test('uses item or event ids to suppress duplicate transcript events', () => {
    const first = {
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: 'item-123',
      transcript: 'Abhi',
    };
    const duplicateByItem = {
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: 'item-123',
      transcript: 'Abhi',
    };
    const duplicateByEvent = {
      type: 'conversation.item.input_audio_transcription.completed',
      event_id: 'evt-456',
      item_id: 'item-123',
      transcript: 'Abhi',
    };

    const seen = new Set<string>();
    const firstKey = getTranscriptEventDeduplicationKey(first);
    const duplicateItemKey = getTranscriptEventDeduplicationKey(duplicateByItem);
    const duplicateEventKey = getTranscriptEventDeduplicationKey(duplicateByEvent);

    expect(firstKey).toBe('item-123');
    expect(duplicateItemKey).toBe('item-123');
    expect(duplicateEventKey).toBe('evt-456');

    if (firstKey) {
      seen.add(firstKey);
    }
    expect(seen.has(duplicateItemKey ?? '')).toBe(true);
    expect(seen.has(duplicateEventKey ?? '')).toBe(false);
  });
});

describe('RealtimeVoiceController', () => {
  const originalMediaDevices = navigator.mediaDevices;

  let api: {
    createRealtimeSession: ReturnType<typeof vi.fn>;
    connectRealtimeCall: ReturnType<typeof vi.fn>;
    sendChat: ReturnType<typeof vi.fn>;
  };
  let controller: RealtimeVoiceController;
  let dataChannel: FakeDataChannel;
  let transcripts: Array<[string, string]>;
  let states: string[];
  let errors: string[];
  let audioElement: HTMLAudioElement;

  const createController = async (autoConnect = true): Promise<void> => {
    if (controller) {
      await controller.dispose();
    }
    transcripts = [];
    states = [];
    errors = [];

    api = {
      createRealtimeSession: vi.fn(async () => makeSession()),
      connectRealtimeCall: vi.fn(async () => 'fake-answer-sdp'),
      sendChat: vi.fn(async (input: { message: string; conversationId?: string }) => ({
        message: input.message,
        state: {
          conversationId: input.conversationId ?? 'conv-1',
          businessId: 'demo-salon',
          proposedSlots: [],
          bookingConfirmationStatus: 'unconfirmed',
        } satisfies ConversationStateSnapshot,
        requiresUserAction: true,
      } satisfies ChatResponse)),
    };

    vi.stubGlobal('RTCPeerConnection', FakeRTCPeerConnection as unknown as typeof RTCPeerConnection);
    vi.stubGlobal('MediaStream', FakeMediaStream as unknown as typeof MediaStream);
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => {
          const stream = new FakeMediaStream();
          stream.addTrack(new FakeMediaStreamTrack());
          return stream;
        }),
      },
    });

    audioElement = document.createElement('audio');
    audioElement.play = vi.fn(async () => undefined);
    audioElement.pause = vi.fn();

    controller = new RealtimeVoiceController(
      api as unknown as ApiClient,
      {
        onStateChange: (state) => states.push(state),
        onConnectionStateChange: () => undefined,
        onMicStateChange: () => undefined,
        onTranscript: (role, text) => transcripts.push([role, text]),
        onSessionSummary: () => undefined,
        onConversationState: () => undefined,
        onToolStatus: () => undefined,
        onMetric: () => undefined,
        onDiagnostics: () => undefined,
        onError: (message) => errors.push(message),
      },
      audioElement,
    );

    if (autoConnect) {
      await controller.connect();
      await flush();

      const pc = (controller as unknown as { pc: FakeRTCPeerConnection | null }).pc;
      if (!pc || pc.dataChannels.length === 0) {
        throw new Error('Expected a fake data channel to be created');
      }
      dataChannel = pc.dataChannels[0] as unknown as FakeDataChannel;
    } else {
      dataChannel = undefined as unknown as FakeDataChannel;
    }
  };

  afterEach(() => {
    vi.unstubAllGlobals();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: originalMediaDevices,
    });
    FakeRTCPeerConnection.localDescriptionSdpOverride = null;
    FakeRTCPeerConnection.omitLocalDescription = false;
    vi.restoreAllMocks();
  });

  beforeEach(async () => {
    await createController();
  });

  test('forwards only final transcript events to /api/chat once', async () => {
    dataChannel.emit({
      type: 'conversation.item.input_audio_transcription.partial',
      item_id: 'item-1',
      transcript: 'hel',
    });
    dataChannel.emit({
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: 'item-1',
      transcript: 'hello',
    });
    await flush();

    expect(api.sendChat).toHaveBeenCalledTimes(1);
    expect(api.sendChat).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'hello',
        conversationId: 'conv-1',
      }),
    );
  });

  test('ignores duplicate transcript item ids', async () => {
    dataChannel.emit({
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: 'item-2',
      transcript: 'hello',
    });
    dataChannel.emit({
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: 'item-2',
      transcript: 'hello',
    });
    await flush();

    expect(api.sendChat).toHaveBeenCalledTimes(1);
    expect(transcripts.filter(([role]) => role === 'user')).toHaveLength(1);
  });

  test('reuses the same conversation id for follow-up turns', async () => {
    dataChannel.emit({
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: 'item-3',
      transcript: 'hello',
    });
    await flush();

    await controller.sendText('yes');

    expect(api.sendChat).toHaveBeenCalledTimes(2);
    expect(api.sendChat.mock.calls[0]?.[0]).toMatchObject({ conversationId: 'conv-1' });
    expect(api.sendChat.mock.calls[1]?.[0]).toMatchObject({ conversationId: 'conv-1' });
  });

  test('posts the finalized localDescription sdp', async () => {
    await createController(false);
    FakeRTCPeerConnection.localDescriptionSdpOverride = 'final-local-sdp';

    await controller.connect();
    await flush();

    expect(api.connectRealtimeCall).toHaveBeenCalledWith(
      expect.objectContaining({
        sdp: 'final-local-sdp',
      }),
    );
  });

  test('fails clearly when the local description is missing', async () => {
    await createController(false);
    FakeRTCPeerConnection.omitLocalDescription = true;

    await expect(controller.connect()).rejects.toThrow('Failed to create SDP offer.');
  });

  test('speaks the backend response text exactly', async () => {
    await controller.sendText('hello');
    await flush();

    const assistantTurn = transcripts.find(([role]) => role === 'assistant');
    expect(assistantTurn?.[1]).toBe('hello');
    const payloads = dataChannel.sent.map((payload) => JSON.parse(payload) as { item?: { content?: Array<{ text?: string }> } });
    const rendered = payloads.find((payload) => payload.item?.content?.[0]?.text);
    expect(rendered?.item?.content?.[0]?.text).toBe('hello');
  });

  test('cancels the assistant response when interrupted by new speech', async () => {
    dataChannel.emit({
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: 'item-4',
      transcript: 'hello',
    });
    await flush();
    dataChannel.emit({ type: 'response.audio.delta' });
    dataChannel.emit({ type: 'input_audio_buffer.speech_started' });
    await flush();

    const payloads = dataChannel.sent.map((payload) => JSON.parse(payload) as { type?: string });
    expect(payloads.some((payload) => payload.type === 'response.cancel')).toBe(true);
    expect(payloads.some((payload) => payload.type === 'output_audio_buffer.clear')).toBe(true);
    expect(states).toContain('interrupted');
  });

  test('concurrent connect calls share one promise and one session request', async () => {
    await createController(false);
    const first = controller.connect();
    const second = controller.connect();

    expect(first).toBe(second);

    await first;
    await flush();

    expect(api.createRealtimeSession).toHaveBeenCalledTimes(1);
    expect(api.connectRealtimeCall).toHaveBeenCalledTimes(1);
  });

  test('double-click Start results in one session request and one webrtc request', async () => {
    await createController(false);
    const first = controller.connect();
    const second = controller.connect();

    expect(first).toBe(second);

    await first;
    await flush();

    expect(api.createRealtimeSession).toHaveBeenCalledTimes(1);
    expect(api.connectRealtimeCall).toHaveBeenCalledTimes(1);
  });

  test('stale attempt failure cannot overwrite newer success', async () => {
    await createController(false);
    const firstSessionDeferred = defer<RealtimeSessionResponse>();
    const firstAnswerDeferred = defer<string>();
    let sessionCallCount = 0;
    let webrtcCallCount = 0;
    api.createRealtimeSession.mockImplementation(async () => {
      sessionCallCount += 1;
      if (sessionCallCount === 1) {
        return firstSessionDeferred.promise;
      }
      return makeSession({ conversationId: 'conv-2' });
    });
    api.connectRealtimeCall.mockImplementation(async () => {
      webrtcCallCount += 1;
      if (webrtcCallCount === 1) {
        return firstAnswerDeferred.promise;
      }
      return 'second-answer-sdp';
    });

    const firstConnect = controller.connect();
    await flush();
    firstSessionDeferred.resolve(makeSession({ conversationId: 'conv-1' }));
    await flush();
    await controller.disconnect();
    const secondConnect = controller.connect();
    await flush();
    firstAnswerDeferred.reject(new Error('stale upstream failure'));
    await secondConnect;
    await flush();
    await firstConnect;
    await flush();

    expect(errors).not.toContain('stale upstream failure');
    expect(states).not.toContain('error');
    expect(api.createRealtimeSession).toHaveBeenCalledTimes(2);
    expect(api.connectRealtimeCall).toHaveBeenCalledTimes(2);
  });

  test('timeout is cleared after a successful connection', async () => {
    vi.useFakeTimers();
    const microFlush = async (): Promise<void> => {
      await Promise.resolve();
      await Promise.resolve();
    };
    try {
      await createController(false);

      await controller.connect();
      await microFlush();
      await vi.advanceTimersByTimeAsync(6_000);
      await microFlush();

      expect(errors).not.toContain('Realtime connection readiness timed out.');
      expect(states).not.toContain('error');
    } finally {
      vi.useRealTimers();
    }
  });

  test('old peer connection events are ignored after reconnect', async () => {
    await createController(false);

    const firstConnect = controller.connect();
    await firstConnect;
    await flush();
    const firstPc = (controller as unknown as { pc: FakeRTCPeerConnection | null }).pc;
    if (!firstPc) {
      throw new Error('Expected the first peer connection');
    }

    await controller.disconnect();
    await controller.connect();
    await flush();

    firstPc.connectionState = 'failed';
    firstPc.onconnectionstatechange?.(new Event('connectionstatechange'));
    firstPc.iceConnectionState = 'failed';
    firstPc.oniceconnectionstatechange?.(new Event('iceconnectionstatechange'));
    await flush();

    expect(errors).not.toContain('WebRTC connection failed.');
    expect(errors).not.toContain('ICE negotiation failed.');
  });

  test('end call invalidates the current attempt and reconnect creates a fresh session', async () => {
    await createController(false);
    await controller.connect();
    await flush();
    await controller.disconnect();
    await controller.connect();
    await flush();

    expect(api.createRealtimeSession).toHaveBeenCalledTimes(2);
    expect(api.connectRealtimeCall).toHaveBeenCalledTimes(2);
  });

  test('temporary disconnected state can recover without error', async () => {
    vi.useFakeTimers();
    try {
      await createController(false);
      const connectPromise = controller.connect();
      await microFlush();
      await connectPromise;

      const pc = (controller as unknown as { pc: FakeRTCPeerConnection | null }).pc;
      if (!pc) {
        throw new Error('Expected a peer connection');
      }

      pc.connectionState = 'disconnected';
      pc.onconnectionstatechange?.(new Event('connectionstatechange'));
      await microFlush();
      await vi.advanceTimersByTimeAsync(4_000);
      await microFlush();
      expect(errors).not.toContain('WebRTC connection disconnected.');

      pc.connectionState = 'connected';
      pc.onconnectionstatechange?.(new Event('connectionstatechange'));
      await microFlush();
      await vi.advanceTimersByTimeAsync(6_000);
      await microFlush();

      expect(errors).not.toContain('WebRTC connection disconnected.');
      expect(states).not.toContain('error');
    } finally {
      vi.useRealTimers();
    }
  });

  test('connected call does not fail when assistant audio never arrives', async () => {
    vi.useFakeTimers();
    try {
      await createController(false);
      const connectPromise = controller.connect();
      await microFlush();
      await connectPromise;

      await vi.advanceTimersByTimeAsync(10_000);
      await microFlush();

      expect(errors).not.toContain('Realtime connection readiness timed out.');
      expect(errors).not.toContain('WebRTC connection disconnected.');
      expect(states).not.toContain('error');
    } finally {
      vi.useRealTimers();
    }
  });

  test('unknown realtime events do not mark error', async () => {
    dataChannel.emit({ type: 'some.future.event' });
    await flush();

    expect(errors).toHaveLength(0);
    expect(states).not.toContain('error');
  });
});

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
};

const defer = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};
