import type { ApiClient } from './api';
import type {
  ConversationStateSnapshot,
  LatencyMetric,
  MicState,
  RealtimeConnectionState,
  RealtimeDiagnostics,
  RealtimeSessionResponse,
  ToolStatus,
  VoiceState,
} from './types';
import { RealtimeVoiceController } from './realtime';
import { formatSlotForCustomer, formatTimeZoneLabel, isSupportedTimeZone } from '@sudo-ai-receptionist/shared';

type MountOptions = {
  root: HTMLElement;
  api: ApiClient;
};

type AppDom = {
  transcript: HTMLElement;
  sessionSummary: HTMLElement;
  buildMarker: HTMLElement;
  voiceState: HTMLElement;
  voiceHint: HTMLElement;
  connectionState: HTMLElement;
  apiState: HTMLElement;
  micState: HTMLElement;
  connectionDot: HTMLElement;
  toolDot: HTMLElement;
  serviceValue: HTMLElement;
  nameValue: HTMLElement;
  phoneValue: HTMLElement;
  slotValue: HTMLElement;
  bookingValue: HTMLElement;
  toolStatus: HTMLElement;
  toolList: HTMLElement;
  metricsList: HTMLElement;
  readinessList: HTMLElement;
  readinessSummary: HTMLElement;
  diagnosticsList: HTMLElement;
  stagePills: HTMLElement;
  userText: HTMLTextAreaElement;
  connectBtn: HTMLButtonElement;
  micBtn: HTMLButtonElement;
  interruptBtn: HTMLButtonElement;
  sendBtn: HTMLButtonElement;
  clearBtn: HTMLButtonElement;
  remoteAudio: HTMLAudioElement;
};

type AppState = {
  conversation: ConversationStateSnapshot | null;
  session: RealtimeSessionResponse | null;
  voiceState: VoiceState;
  connectionState: RealtimeConnectionState;
  micState: MicState;
  toolStatus: ToolStatus[];
  metrics: LatencyMetric[];
  diagnostics: RealtimeDiagnostics;
};

type StageMeta = {
  state: VoiceState;
  label: string;
  hint: string;
};

const stages: StageMeta[] = [
  { state: 'idle', label: 'Idle', hint: 'Waiting for you to connect the voice session.' },
  { state: 'connecting', label: 'Connecting', hint: 'Creating an ephemeral realtime session.' },
  { state: 'listening', label: 'Listening', hint: 'Microphone is live and the assistant is waiting.' },
  { state: 'transcribing', label: 'Transcribing', hint: 'The final user transcript is being assembled.' },
  { state: 'thinking', label: 'Thinking', hint: 'The backend is validating the last transcript.' },
  { state: 'checking_availability', label: 'Checking availability', hint: 'SalonFlow is being queried for open times.' },
  { state: 'offering_slots', label: 'Offering slots', hint: 'The assistant is reading out the top matches.' },
  { state: 'collecting_customer', label: 'Collecting customer', hint: 'The assistant is asking for name or phone.' },
  { state: 'confirming', label: 'Confirming', hint: 'Explicit booking approval is required now.' },
  { state: 'booking', label: 'Booking', hint: 'The appointment write is in progress.' },
  { state: 'booked', label: 'Booked', hint: 'A single appointment has been created.' },
  { state: 'interrupted', label: 'Interrupted', hint: 'The assistant audio was cut off immediately.' },
  { state: 'speaking', label: 'Speaking', hint: 'OpenAI Realtime is playing back the assistant voice.' },
  { state: 'error', label: 'Error', hint: 'The voice connection or backend request failed.' },
];

const shellMarkup = `
  <main class="app-shell">
    <header class="hero">
      <div class="hero-copy">
        <div class="eyebrow">Sudo AI Receptionist</div>
        <h1>Natural browser voice booking with measured latency.</h1>
        <p>OpenAI Realtime over WebRTC, backend-validated SalonFlow booking, and interruption-aware voice control.</p>
      </div>
      <div class="status-stack">
        <div class="chip-row">
          <div class="chip" id="connectionState">Disconnected</div>
          <div class="chip" id="apiState">Checking API</div>
          <div class="chip" id="micState">Mic off</div>
        </div>
        <div class="voice-orb" id="connectionDot">
          <div class="voice-orb-inner"></div>
        </div>
        <div class="small build-marker" id="buildMarker">Build: unknown</div>
      </div>
    </header>

    <div class="grid">
      <section class="panel stage-panel">
        <div class="panel-top">
          <div>
            <div class="section-title">Voice session</div>
            <div class="small" id="voiceHint">Waiting for connection.</div>
          </div>
          <div class="voice-state" id="voiceState">idle</div>
        </div>

        <div class="panel-inner stack">
          <div class="card">
            <div class="chip-row wrap" id="stagePills"></div>
          </div>

          <div class="control-row">
            <button class="primary" id="connectBtn">Start voice</button>
            <button class="ghost" id="micBtn">Mic test</button>
            <button class="danger" id="interruptBtn">Interrupt</button>
            <button class="ghost" id="clearBtn">Clear transcript</button>
          </div>

          <div class="card">
            <div class="row-between">
              <strong>Session summary</strong>
              <div class="status-dot" id="toolDot"></div>
            </div>
            <div class="small" id="sessionSummary">No session started.</div>
          </div>

          <div class="card">
            <div class="row-between">
              <strong>WebRTC diagnostics</strong>
              <div class="small">Temporary debug surface</div>
            </div>
            <div class="diagnostics-list" id="diagnosticsList"></div>
          </div>

          <div class="card">
            <div class="row-between">
              <strong>Tool latency</strong>
              <div class="small" id="toolStatus">No tool calls yet.</div>
            </div>
            <div class="metric-list" id="metricsSummary"></div>
            <div class="tool-list" id="toolList"></div>
          </div>

          <div class="card">
            <div class="row-between">
              <strong>MVP readiness</strong>
              <div class="small" id="readinessSummary">0/5 ready</div>
            </div>
            <div class="checklist" id="readinessList"></div>
          </div>

          <div class="card transcript-card">
            <div class="row-between">
              <strong>Transcript</strong>
              <span class="small">Voice and text fallback share the same backend path.</span>
            </div>
            <div class="transcript" id="transcript"></div>
          </div>

          <div class="card stack">
            <strong>Text fallback</strong>
            <textarea id="userText" placeholder="Type the customer request if voice is unavailable."></textarea>
            <div class="control-row">
              <button class="primary" id="sendBtn">Send text</button>
            </div>
          </div>
        </div>
      </section>

      <aside class="panel sidebar">
        <div class="section-title">
          <div>
            <strong>Booking details</strong>
            <div class="small">Live conversation state from the backend.</div>
          </div>
        </div>
        <div class="panel-inner stack">
          <div class="card">
            <div class="small">Selected service</div>
            <div class="detail" id="serviceValue">None yet</div>
          </div>
          <div class="card split">
            <div>
              <div class="small">Customer name</div>
              <div class="detail" id="nameValue">Pending</div>
            </div>
            <div>
              <div class="small">Customer phone</div>
              <div class="detail" id="phoneValue">Pending</div>
            </div>
          </div>
          <div class="card">
            <div class="small">Appointment slot</div>
            <div class="detail" id="slotValue">No slot selected</div>
          </div>
          <div class="card">
            <div class="small">Booking status</div>
            <div class="detail" id="bookingValue">Unconfirmed</div>
          </div>
          <div class="card">
            <div class="small">Instrumentation</div>
            <div class="small">
              Session startup latency, speech-to-audio delay, tool-call duration, SalonFlow endpoint latency, booking-write duration, and interruption handling are tracked in the client.
            </div>
          </div>
        </div>
      </aside>
    </div>

    <audio id="remoteAudio" autoplay playsinline class="sr-only"></audio>
  </main>
`;

const setStatusDot = (element: HTMLElement, mode: 'live' | 'warn' | 'fail' | ''): void => {
  element.classList.remove('live', 'warn', 'fail');
  if (mode) {
    element.classList.add(mode);
  }
};

const setChipState = (element: HTMLElement, label: string, mode?: 'active' | 'warn' | 'fail'): void => {
  element.textContent = label;
  element.className = `chip${mode ? ` ${mode}` : ''}`;
};

const createDom = (root: HTMLElement): AppDom => {
  root.innerHTML = shellMarkup;
  const get = <T extends HTMLElement>(id: string): T => {
    const element = root.querySelector<T>(`#${id}`);
    if (!element) {
      throw new Error(`Missing element: ${id}`);
    }
    return element;
  };

  return {
    transcript: get('transcript'),
    sessionSummary: get('sessionSummary'),
    buildMarker: get('buildMarker'),
    voiceState: get('voiceState'),
    voiceHint: get('voiceHint'),
    connectionState: get('connectionState'),
    apiState: get('apiState'),
    micState: get('micState'),
    connectionDot: get('connectionDot'),
    toolDot: get('toolDot'),
    serviceValue: get('serviceValue'),
    nameValue: get('nameValue'),
    phoneValue: get('phoneValue'),
    slotValue: get('slotValue'),
    bookingValue: get('bookingValue'),
    toolStatus: get('toolStatus'),
    toolList: get('toolList'),
    metricsList: get('metricsSummary'),
    readinessList: get('readinessList'),
    readinessSummary: get('readinessSummary'),
    diagnosticsList: get('diagnosticsList'),
    stagePills: get('stagePills'),
    userText: get<HTMLTextAreaElement>('userText'),
    connectBtn: get<HTMLButtonElement>('connectBtn'),
    micBtn: get<HTMLButtonElement>('micBtn'),
    interruptBtn: get<HTMLButtonElement>('interruptBtn'),
    sendBtn: get<HTMLButtonElement>('sendBtn'),
    clearBtn: get<HTMLButtonElement>('clearBtn'),
    remoteAudio: get<HTMLAudioElement>('remoteAudio'),
  };
};

const formatMetric = (metric: LatencyMetric): string => {
  const suffix = metric.detail ? ` · ${metric.detail}` : '';
  return `${metric.name}: ${metric.valueMs}ms${suffix}`;
};

const summarizeToolStatus = (items: ToolStatus[] | undefined): string =>
  items && items.length > 0 ? items.map((item) => `${item.name} ${item.latencyMs ? `(${item.latencyMs}ms)` : ''}`.trim()).join(' · ') : 'No tool calls yet.';

const formatConnectionState = (state: RealtimeConnectionState): { label: string; mode?: 'active' | 'warn' | 'fail' } => {
  switch (state) {
    case 'api_connected':
      return { label: 'API connected', mode: 'active' };
    case 'session_created':
      return { label: 'Session created', mode: 'warn' };
    case 'webrtc_connecting':
      return { label: 'WebRTC connecting', mode: 'warn' };
    case 'webrtc_connected':
      return { label: 'WebRTC connected', mode: 'active' };
    case 'data_channel_open':
      return { label: 'Data channel open', mode: 'active' };
    case 'error':
      return { label: 'Connection error', mode: 'fail' };
    case 'idle':
    default:
      return { label: 'Disconnected' };
  }
};

const formatMicState = (state: MicState): { label: string; mode?: 'active' | 'warn' | 'fail' } => {
  switch (state) {
    case 'requesting':
      return { label: 'Mic requesting', mode: 'warn' };
    case 'enabled':
      return { label: 'Mic enabled', mode: 'active' };
    case 'attached':
      return { label: 'Mic attached', mode: 'active' };
    case 'blocked':
      return { label: 'Mic blocked', mode: 'fail' };
    case 'off':
    default:
      return { label: 'Mic off' };
  }
};

const formatDiagnosticsValue = (value: unknown): string => {
  if (typeof value === 'boolean') {
    return value ? 'yes' : 'no';
  }
  if (typeof value === 'string' && value.trim()) {
    return value;
  }
  return 'none';
};

type ReadinessItem = {
  label: string;
  ready: boolean;
};

const buildReadinessItems = (state: AppState, dom: AppDom): ReadinessItem[] => [
  { label: 'Backend healthy', ready: dom.apiState.textContent?.toLowerCase().includes('healthy') ?? false },
  { label: 'Session created', ready: ['session_created', 'webrtc_connecting', 'webrtc_connected', 'data_channel_open'].includes(state.connectionState) },
  { label: 'WebRTC connected', ready: ['webrtc_connected', 'data_channel_open'].includes(state.connectionState) },
  { label: 'Data channel open', ready: state.connectionState === 'data_channel_open' },
  { label: 'Mic active', ready: ['enabled', 'attached'].includes(state.micState) },
  { label: 'Listening', ready: ['listening', 'speaking', 'thinking'].includes(state.voiceState) },
  { label: 'User transcript captured', ready: dom.transcript.querySelector('.bubble.user') !== null },
  { label: 'Assistant audio received', ready: state.diagnostics.remoteAudioReceived },
];

const getBrowserTimeZone = (): string | undefined => {
  try {
    const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone?.trim();
    if (!resolved || !isSupportedTimeZone(resolved)) {
      return undefined;
    }
    return resolved;
  } catch {
    return undefined;
  }
};

export const mountReceptionistApp = ({ root, api }: MountOptions): { destroy: () => void } => {
  const dom = createDom(root);
  const browserTimeZone = getBrowserTimeZone();
  const state: AppState = {
    conversation: null,
    session: null,
    voiceState: 'idle',
    connectionState: 'idle',
    micState: 'off',
    toolStatus: [],
    metrics: [],
    diagnostics: {
      peerConnectionState: 'idle',
      iceConnectionState: 'idle',
      signalingState: 'idle',
      dataChannelState: 'closed',
      localAudioTrackState: 'none',
      remoteAudioReceived: false,
      lastEventType: 'none',
      lastErrorMessage: 'none',
    },
  };
  const buildSha = import.meta.env.VITE_VERCEL_GIT_COMMIT_SHA?.trim() || 'unknown';
  dom.buildMarker.textContent = `Build: ${buildSha.slice(0, 7)}`;

  const controller = new RealtimeVoiceController(
    api,
    {
      onStateChange: (voiceState) => {
        state.voiceState = voiceState;
        const meta = stages.find((entry) => entry.state === voiceState) ?? stages[0]!;
        setChipState(
          dom.voiceState,
          meta.label,
          voiceState === 'error'
            ? 'fail'
            : voiceState === 'booked'
              ? 'active'
              : voiceState === 'connecting' || voiceState === 'thinking' || voiceState === 'interrupted'
                ? 'warn'
                : 'active',
        );
        dom.voiceHint.textContent = meta.hint;
        setStatusDot(
          dom.connectionDot,
          voiceState === 'error'
            ? 'fail'
            : voiceState === 'booked'
              ? 'live'
              : voiceState === 'connecting' || voiceState === 'thinking' || voiceState === 'interrupted'
                ? 'warn'
                : state.connectionState === 'data_channel_open' || state.connectionState === 'webrtc_connected'
                  ? 'live'
                  : state.connectionState === 'session_created' || state.connectionState === 'webrtc_connecting'
                    ? 'warn'
                    : '',
        );
        updateConnectButton();
        renderStages();
        renderReadiness();
      },
      onConnectionStateChange: (connectionState) => {
        state.connectionState = connectionState;
        const meta = formatConnectionState(connectionState);
        setChipState(dom.connectionState, meta.label, meta.mode);
        setStatusDot(
          dom.connectionDot,
          connectionState === 'error'
            ? 'fail'
            : connectionState === 'data_channel_open' || connectionState === 'webrtc_connected'
              ? 'live'
              : connectionState === 'session_created' || connectionState === 'webrtc_connecting'
                ? 'warn'
                : '',
        );
        updateConnectButton();
        renderReadiness();
      },
      onMicStateChange: (micState) => {
        state.micState = micState;
        const meta = formatMicState(micState);
        setChipState(dom.micState, meta.label, meta.mode);
        renderReadiness();
      },
      onTranscript: (role, text) => {
        const bubble = document.createElement('div');
        bubble.className = `bubble ${role}`;
        bubble.textContent = text;
        dom.transcript.appendChild(bubble);
        dom.transcript.scrollTop = dom.transcript.scrollHeight;
        renderReadiness();
      },
      onSessionSummary: (summary) => {
        dom.sessionSummary.textContent = summary;
      },
      onConversationState: (conversation) => {
        state.conversation = conversation;
        dom.serviceValue.textContent = conversation.requestedService ?? 'None yet';
        dom.nameValue.textContent = conversation.customerName ?? 'Pending';
        dom.phoneValue.textContent = conversation.customerPhone ?? 'Pending';
        const businessTimezone = conversation.businessProfile?.timezone?.trim() || 'America/Chicago';
        const callerTimezone = conversation.callerTimezone?.trim() || browserTimeZone;
        const slot = conversation.selectedSlot ?? conversation.proposedSlots?.[0];
        if (slot) {
          const businessSlot = formatSlotForCustomer(slot.startsAt, businessTimezone);
          dom.slotValue.textContent = callerTimezone && callerTimezone !== businessTimezone
            ? `${businessSlot.spokenDate} at ${businessSlot.spokenLabel} ${formatTimeZoneLabel(businessTimezone)} — ${formatSlotForCustomer(slot.startsAt, callerTimezone).spokenLabel} your time`
            : `${businessSlot.spokenDate} at ${businessSlot.spokenLabel} ${formatTimeZoneLabel(businessTimezone)}`;
        } else {
          dom.slotValue.textContent = 'No slot selected';
        }
        dom.bookingValue.textContent = conversation.bookingConfirmationStatus || 'Unconfirmed';

        if (conversation.bookingConfirmationStatus === 'confirmed') {
          state.voiceState = 'booked';
          setChipState(dom.voiceState, 'Booked', 'active');
          dom.voiceHint.textContent = 'A single appointment has been created.';
        } else if (conversation.bookingConfirmationStatus === 'pending') {
          state.voiceState = 'confirming';
          setChipState(dom.voiceState, 'Confirming', 'warn');
          dom.voiceHint.textContent = 'Explicit yes is required before booking.';
        }
        updateConnectButton();
        renderReadiness();
        renderStages();
      },
      onToolStatus: (toolStatus) => {
        state.toolStatus = toolStatus;
        dom.toolStatus.textContent = summarizeToolStatus(toolStatus);
        dom.toolList.innerHTML = '';
        for (const tool of toolStatus) {
          const row = document.createElement('div');
          row.className = 'tool-row';
          row.textContent = `${tool.name} · ${tool.status}${tool.latencyMs ? ` · ${tool.latencyMs}ms` : ''}`;
          dom.toolList.appendChild(row);
        }
        setStatusDot(dom.toolDot, toolStatus.some((tool) => tool.status === 'ok') ? 'live' : toolStatus.some((tool) => tool.status === 'error') ? 'fail' : '');
        renderReadiness();
      },
      onMetric: (metric) => {
        state.metrics = [metric, ...state.metrics].slice(0, 8);
        dom.metricsList.innerHTML = '';
        for (const item of state.metrics) {
          const row = document.createElement('div');
          row.className = 'metric-row';
          row.textContent = formatMetric(item);
          dom.metricsList.appendChild(row);
        }
        renderReadiness();
      },
      onDiagnostics: (diagnostics) => {
        state.diagnostics = diagnostics;
        dom.diagnosticsList.innerHTML = '';
        const rows: Array<[string, unknown]> = [
          ['Peer connection', diagnostics.peerConnectionState],
          ['ICE connection', diagnostics.iceConnectionState],
          ['Signaling', diagnostics.signalingState],
          ['Data channel', diagnostics.dataChannelState],
          ['Local audio', diagnostics.localAudioTrackState],
          ['Remote audio', diagnostics.remoteAudioReceived],
          ['Last event', diagnostics.lastEventType],
          ['Last error', diagnostics.lastErrorMessage],
          ['Final transcripts', diagnostics.finalTranscriptCount ?? 0],
          ['Duplicates ignored', diagnostics.duplicateTranscriptEventsIgnored ?? 0],
          ['Interruptions', diagnostics.interruptionCount ?? 0],
          ['Speech→audio latency', diagnostics.lastSpeechEndToAudioStartMs ?? 'n/a'],
        ];
        for (const [label, value] of rows) {
          const row = document.createElement('div');
          row.className = 'diagnostic-row';
          row.innerHTML = `<span class="diagnostic-label">${label}</span><span class="diagnostic-value">${formatDiagnosticsValue(value)}</span>`;
          dom.diagnosticsList.appendChild(row);
        }
        renderReadiness();
      },
      onError: (message) => {
        dom.sessionSummary.textContent = message;
        state.voiceState = 'error';
        setChipState(dom.voiceState, 'Error', 'fail');
        dom.voiceHint.textContent = 'The realtime session or backend call failed.';
        setStatusDot(dom.connectionDot, 'fail');
        updateConnectButton();
        renderReadiness();
        renderStages();
      },
    },
    dom.remoteAudio,
  );

  const renderStages = (): void => {
    dom.stagePills.innerHTML = '';
    for (const stage of stages) {
      const pill = document.createElement('div');
      pill.className = `stage-pill${state.voiceState === stage.state ? ' active' : ''}`;
      pill.textContent = stage.label;
      pill.title = stage.hint;
      dom.stagePills.appendChild(pill);
    }
  };

  const renderReadiness = (): void => {
    const items = buildReadinessItems(state, dom);
    const readyCount = items.filter((item) => item.ready).length;
    dom.readinessSummary.textContent = `${readyCount}/${items.length} ready`;
    dom.readinessList.innerHTML = '';
    for (const item of items) {
      const row = document.createElement('div');
      row.className = `check-row ${item.ready ? 'ready' : 'pending'}`;
      row.textContent = item.label;
      dom.readinessList.appendChild(row);
    }
  };

  const updateConnectButton = (): void => {
    const hasSession = Boolean(state.session);
    dom.connectBtn.textContent = hasSession ? 'Stop voice' : 'Start voice';
    dom.connectBtn.classList.toggle('danger', hasSession);
    dom.connectBtn.classList.toggle('primary', !hasSession);
  };

  const refreshHealth = async (): Promise<void> => {
    setChipState(dom.apiState, 'Checking API', 'warn');
    try {
      const health = await api.getHealth();
      const label = health.ok === false ? 'API degraded' : 'API healthy';
      setChipState(dom.apiState, label, 'active');
      setChipState(dom.connectionState, 'API connected', 'active');
      state.connectionState = 'api_connected';
      if (!state.session) {
        dom.sessionSummary.textContent = `Health check succeeded via /health${health.status ? ` (${health.status})` : ''}.`;
      }
      setStatusDot(dom.connectionDot, 'live');
      renderReadiness();
    } catch {
      setChipState(dom.apiState, 'API offline', 'fail');
      setChipState(dom.connectionState, 'Disconnected');
      state.connectionState = 'idle';
      if (!state.session) {
        dom.sessionSummary.textContent = 'Unable to reach the backend health endpoint.';
      }
      setStatusDot(dom.connectionDot, 'fail');
      renderReadiness();
    }
  };

  const connect = async (): Promise<void> => {
    if (state.session) {
      await disconnect();
      return;
    }
    state.voiceState = 'connecting';
    updateConnectButton();
    renderStages();
    try {
      const session = await controller.connect(state.conversation ?? undefined);
      state.session = session;
      dom.sessionSummary.textContent = `Session ${session.conversationId} ready.`;
      updateConnectButton();
      renderReadiness();
      renderStages();
    } catch (error) {
      setChipState(dom.connectionState, 'Connection failed', 'fail');
      setStatusDot(dom.connectionDot, 'fail');
      dom.sessionSummary.textContent = error instanceof Error ? error.message : 'Failed to create voice session.';
      state.voiceState = 'error';
      updateConnectButton();
      renderReadiness();
      renderStages();
    }
  };

  const disconnect = async (): Promise<void> => {
    await controller.disconnect();
    state.session = null;
    setChipState(dom.connectionState, 'Disconnected');
    state.connectionState = 'idle';
    setChipState(dom.voiceState, 'Idle');
    state.voiceState = 'idle';
    setChipState(dom.micState, 'Mic off');
    state.micState = 'off';
    dom.voiceHint.textContent = 'Waiting for connection.';
    setStatusDot(dom.connectionDot, '');
    updateConnectButton();
    renderReadiness();
    renderStages();
  };

  const enableMic = async (): Promise<void> => {
    try {
      await controller.enableMic();
      dom.sessionSummary.textContent = 'Microphone permission granted.';
      renderReadiness();
    } catch {
      setChipState(dom.micState, 'Mic blocked', 'fail');
      dom.sessionSummary.textContent = 'Microphone permission was denied.';
      renderReadiness();
    }
  };

  const interrupt = (): void => {
    void controller.interrupt();
    setChipState(dom.voiceState, 'Interrupted', 'warn');
    dom.voiceHint.textContent = 'The assistant audio was stopped immediately.';
    renderReadiness();
  };

  const clearTranscript = (): void => {
    dom.transcript.innerHTML = '';
    renderReadiness();
  };

  const sendText = async (): Promise<void> => {
    const text = dom.userText.value.trim();
    if (!text) {
      return;
    }
    try {
      await controller.sendText(text);
    } finally {
      dom.userText.value = '';
      renderStages();
      renderReadiness();
    }
  };

  const onLoad = (): void => {
    console.info(`Receptionist web build ${buildSha.slice(0, 7)}`);
    setChipState(dom.connectionState, 'Disconnected');
    setChipState(dom.micState, 'Mic off');
    setChipState(dom.voiceState, 'Idle');
    dom.voiceHint.textContent = 'Waiting for connection.';
    updateConnectButton();
    renderReadiness();
    renderStages();
    void refreshHealth();
  };

  dom.connectBtn.addEventListener('click', () => { void connect(); });
  dom.micBtn.addEventListener('click', () => { void enableMic(); });
  dom.interruptBtn.addEventListener('click', interrupt);
  dom.clearBtn.addEventListener('click', clearTranscript);
  dom.sendBtn.addEventListener('click', () => { void sendText(); });
  window.addEventListener('load', onLoad, { once: true });

  if (document.readyState !== 'loading') {
    onLoad();
  }

  return {
    destroy: () => {
      dom.connectBtn.replaceWith(dom.connectBtn.cloneNode(true));
      dom.micBtn.replaceWith(dom.micBtn.cloneNode(true));
      dom.interruptBtn.replaceWith(dom.interruptBtn.cloneNode(true));
      dom.clearBtn.replaceWith(dom.clearBtn.cloneNode(true));
      dom.sendBtn.replaceWith(dom.sendBtn.cloneNode(true));
      void controller.dispose();
    },
  };
};
