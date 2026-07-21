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
import { formatSlotForCustomer, formatTimeZoneLabel } from '@sudo-ai-receptionist/shared';

type MountOptions = {
  root: HTMLElement;
  api: ApiClient;
};

type AppDom = {
  transcript: HTMLElement;
  transcriptCard: HTMLElement;
  sessionSummary: HTMLElement;
  buildMarker: HTMLElement;
  callTimer: HTMLElement;
  voiceState: HTMLElement;
  voiceHint: HTMLElement;
  connectionState: HTMLElement;
  apiState: HTMLElement;
  micState: HTMLElement;
  connectLabel: HTMLElement;
  connectionDot: HTMLElement;
  toolDot: HTMLElement;
  waveform: HTMLElement;
  callerTitle: HTMLElement;
  callerAvatar: HTMLElement;
  customerBadge: HTMLElement;
  serviceValue: HTMLElement;
  serviceMeta: HTMLElement;
  nameValue: HTMLElement;
  phoneValue: HTMLElement;
  slotValue: HTMLElement;
  timeMeta: HTMLElement;
  bookingValue: HTMLElement;
  statusValue: HTMLElement;
  statusDetail: HTMLElement;
  statusProgress: HTMLElement;
  toolStatus: HTMLElement;
  toolList: HTMLElement;
  metricsList: HTMLElement;
  readinessList: HTMLElement;
  readinessSummary: HTMLElement;
  diagnosticsList: HTMLElement;
  stagePills: HTMLElement;
  diagnosticsDrawer: HTMLElement;
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
  { state: 'idle', label: 'Ready to start', hint: 'Start the call to begin the conversation.' },
  { state: 'connecting', label: 'Connecting', hint: 'Creating the live voice session.' },
  { state: 'listening', label: 'Customer is speaking…', hint: 'Customer is speaking…' },
  { state: 'transcribing', label: 'Transcribing', hint: 'Transcribing the latest user message.' },
  { state: 'thinking', label: 'Understanding the request…', hint: 'Understanding the request…' },
  { state: 'checking_availability', label: 'Checking availability…', hint: 'Checking availability…' },
  { state: 'offering_slots', label: 'Offering slots', hint: 'Presenting the best openings.' },
  { state: 'collecting_customer', label: 'Collecting customer', hint: 'Collecting customer details.' },
  { state: 'confirming', label: 'Confirming', hint: 'Waiting for a yes to book.' },
  { state: 'booking', label: 'Booking', hint: 'Booking the appointment...' },
  { state: 'booked', label: 'Appointment booked', hint: 'Appointment booked.' },
  { state: 'interrupted', label: 'Interrupted', hint: 'Assistant audio stopped.' },
  { state: 'speaking', label: 'AI receptionist is speaking…', hint: 'AI receptionist is speaking…' },
  { state: 'error', label: 'Error', hint: 'The voice connection or backend request failed.' },
];

const shellMarkup = `
  <main class="app-shell">
    <header class="topbar">
      <div class="brand-lockup">
        <div class="brand-mark" aria-hidden="true">
          <div class="brand-mark-core"></div>
        </div>
        <div class="brand-copy">
          <h1>Sudo AI Receptionist</h1>
          <p>Never miss a call. Always book. 24/7.</p>
        </div>
      </div>
      <div class="live-pill">
        <span class="live-pill-dot" aria-hidden="true"></span>
        <span>Live voice conversation</span>
        <strong id="callTimer">00:00</strong>
      </div>
    </header>

    <div class="workspace">
      <section class="main-column">
        <div class="call-stage card">
          <div class="wave-shell">
            <div class="waveform idle" id="waveform" aria-hidden="true"></div>
            <div class="wave-copy">
              <strong id="voiceState">Idle</strong>
              <span id="voiceHint">Waiting for the voice call to start.</span>
            </div>
          </div>
        </div>

        <div class="transcript-card card" id="transcriptCard">
          <div class="section-head">
            <div>
              <div class="section-kicker">Transcript</div>
              <h2>Conversation</h2>
            </div>
          </div>
          <div class="transcript" id="transcript"></div>
        </div>

        <div class="control-bar card">
          <button class="control-chip" id="micBtn" type="button">
            <span class="control-icon control-icon-mic" aria-hidden="true"></span>
            <span>Mute</span>
          </button>
          <button class="control-chip" id="interruptBtn" type="button">Interrupt</button>
          <div class="call-core">
            <button class="call-button" id="connectBtn" type="button" aria-label="Start call">
              <span class="call-button-icon" aria-hidden="true"></span>
            </button>
            <div class="call-button-label" id="connectLabel">Start call</div>
          </div>
          <button class="control-chip" id="clearBtn" type="button">Transcript</button>
        </div>

        <details class="text-fallback card" id="useTextDrawer">
          <summary>
            <div>
              <div class="section-kicker">Use text instead</div>
              <h3>Type the customer request if voice is unavailable.</h3>
            </div>
            <span class="small">Collapsed by default</span>
          </summary>
          <div class="text-fallback-body">
            <textarea id="userText" placeholder="Type the customer request if voice is unavailable."></textarea>
            <div class="text-fallback-actions">
              <button class="primary" id="sendBtn" type="button">Send text</button>
            </div>
          </div>
        </details>
      </section>

      <aside class="sidebar">
        <div class="sidebar-stack">
          <section class="info-card card">
            <div class="sidebar-card-head">
              <div>
                <div class="section-kicker">Caller Information</div>
                <h3 id="callerTitle">Caller</h3>
              </div>
              <span class="live-badge">Live</span>
            </div>
            <div class="profile-row">
              <div class="profile-avatar" id="callerAvatar">C</div>
              <div class="profile-copy">
                <div class="detail" id="nameValue">Details being collected</div>
                <div class="small" id="phoneValue">Waiting for caller details</div>
                <div class="profile-badge" id="customerBadge">New customer</div>
              </div>
            </div>
          </section>

          <section class="info-card card">
            <div class="sidebar-card-head">
              <div>
                <div class="section-kicker">Service Request</div>
                <h3>Selected service</h3>
              </div>
            </div>
            <div class="service-row">
              <div class="sidebar-icon sidebar-icon-service" aria-hidden="true">✂</div>
              <div>
                <div class="detail" id="serviceValue">None yet</div>
                <div class="small" id="serviceMeta">Duration and price will appear here.</div>
              </div>
            </div>
          </section>

          <section class="info-card card">
            <div class="sidebar-card-head">
              <div>
                <div class="section-kicker">Preferred Time</div>
                <h3>Timing</h3>
              </div>
            </div>
            <div class="service-row">
              <div class="sidebar-icon sidebar-icon-time" aria-hidden="true">⌚</div>
              <div>
                <div class="detail" id="slotValue">No preferred time yet</div>
                <div class="small" id="timeMeta">The business timezone will be used automatically.</div>
              </div>
            </div>
          </section>

          <section class="info-card card status-card">
            <div class="sidebar-card-head">
              <div>
                <div class="section-kicker">Conversation Status</div>
                <h3 id="statusValue">Idle</h3>
              </div>
            </div>
            <div class="status-visual">
              <div class="status-ring" aria-hidden="true"></div>
              <div class="status-copy" id="statusDetail">Waiting for the live call to begin.</div>
            </div>
            <div class="status-track" aria-hidden="true">
              <div class="status-track-fill" id="statusProgress"></div>
            </div>
          </section>

          <details class="diagnostics-drawer" id="diagnosticsDrawer">
            <summary>Demo diagnostics</summary>
            <div class="diagnostics-panel">
              <div class="chip-row wrap" id="stagePills"></div>
              <div class="card diagnostics-card">
                <div class="row-between">
                  <strong>Session summary</strong>
                  <div class="status-dot" id="toolDot"></div>
                </div>
                <div class="small" id="sessionSummary">No session started.</div>
                <div class="small" id="bookingValue">Unconfirmed</div>
              </div>
              <div class="chip-row wrap hidden-state-row">
                <div class="status-chip" id="connectionState">Disconnected</div>
                <div class="status-chip" id="apiState">Checking API</div>
                <div class="status-chip" id="micState">Mic off</div>
                <div class="status-dot" id="connectionDot" aria-hidden="true"></div>
              </div>
              <div class="card diagnostics-card">
                <div class="row-between">
                  <strong>WebRTC diagnostics</strong>
                  <div class="small">Temporary debug surface</div>
                </div>
                <div class="diagnostics-list" id="diagnosticsList"></div>
              </div>
              <div class="card diagnostics-card">
                <div class="row-between">
                  <strong>Tool latency</strong>
                  <div class="small" id="toolStatus">No tool calls yet.</div>
                </div>
                <div class="metric-list" id="metricsSummary"></div>
                <div class="tool-list" id="toolList"></div>
              </div>
              <div class="card diagnostics-card">
                <div class="row-between">
                  <strong>MVP readiness</strong>
                  <div class="small" id="readinessSummary">0/5 ready</div>
                </div>
                <div class="checklist" id="readinessList"></div>
              </div>
              <div class="small build-marker" id="buildMarker">Build: unknown</div>
            </div>
          </details>
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
    transcriptCard: get('transcriptCard'),
    sessionSummary: get('sessionSummary'),
    buildMarker: get('buildMarker'),
    callTimer: get('callTimer'),
    voiceState: get('voiceState'),
    voiceHint: get('voiceHint'),
    connectionState: get('connectionState'),
    apiState: get('apiState'),
    micState: get('micState'),
    connectLabel: get('connectLabel'),
    connectionDot: get('connectionDot'),
    toolDot: get('toolDot'),
    waveform: get('waveform'),
    callerTitle: get('callerTitle'),
    callerAvatar: get('callerAvatar'),
    customerBadge: get('customerBadge'),
    serviceValue: get('serviceValue'),
    serviceMeta: get('serviceMeta'),
    nameValue: get('nameValue'),
    phoneValue: get('phoneValue'),
    slotValue: get('slotValue'),
    timeMeta: get('timeMeta'),
    bookingValue: get('bookingValue'),
    statusValue: get('statusValue'),
    statusDetail: get('statusDetail'),
    statusProgress: get('statusProgress'),
    toolStatus: get('toolStatus'),
    toolList: get('toolList'),
    metricsList: get('metricsSummary'),
    readinessList: get('readinessList'),
    readinessSummary: get('readinessSummary'),
    diagnosticsList: get('diagnosticsList'),
    stagePills: get('stagePills'),
    diagnosticsDrawer: get('diagnosticsDrawer'),
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

const formatDigits = (value: string): string => value.replace(/\D/g, '');

const maskPhoneForCard = (value?: string): string => {
  if (!value) {
    return 'Waiting for caller details';
  }
  const digits = formatDigits(value);
  if (digits.length < 4) {
    return 'Waiting for caller details';
  }
  return `(***) ***-${digits.slice(-4)}`;
};

const titleCase = (value: string): string =>
  value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

const formatServiceDetails = (conversation: ConversationStateSnapshot | null): { name: string; meta: string } => {
  if (!conversation) {
    return { name: 'Not selected', meta: 'Duration and price will appear here.' };
  }

  const service = conversation.services?.find(
    (entry) =>
      entry.serviceId === conversation.serviceId ||
      (conversation.requestedService?.trim().toLowerCase() === entry.name.trim().toLowerCase()),
  );
  const name = service?.name ?? conversation.requestedService ?? 'None yet';
  const duration = service?.durationMinutes ? `~ ${service.durationMinutes} min` : 'Duration pending';
  return {
    name,
    meta: duration,
  };
};

const formatBusinessDateLabel = (dateIso: string, timezone: string): string => {
  const date = new Date(`${dateIso}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    return dateIso;
  }
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    }).format(date);
  } catch {
    return dateIso;
  }
};

const formatPreferredTimeSummary = (
  conversation: ConversationStateSnapshot | null,
  timezone: string,
  currentTimestamp: string | Date,
): { value: string; meta: string } => {
  if (!conversation) {
    return { value: 'Not selected', meta: 'The business timezone will be used automatically.' };
  }

  const selectedSlot = conversation.selectedSlot;
  if (selectedSlot) {
    const presentation = formatSlotForCustomer(selectedSlot.startsAt, timezone, currentTimestamp);
    return {
      value: `${presentation.spokenDate.charAt(0).toUpperCase()}${presentation.spokenDate.slice(1)}, ${presentation.spokenLabel}`,
      meta: `${formatTimeZoneLabel(timezone)} local time`,
    };
  }

  if (conversation.preferredDate) {
    const preferredDate = conversation.preferredDate.trim();
    const dateText = /^\d{4}-\d{2}-\d{2}$/.test(preferredDate)
      ? formatBusinessDateLabel(preferredDate, timezone)
      : preferredDate;
    const range = conversation.preferredTimeRange?.trim();
    return {
      value: range ? `${dateText} · ${titleCase(range)}` : dateText,
      meta: `${formatTimeZoneLabel(timezone)} local time`,
    };
  }

  return { value: 'Not selected', meta: 'The business timezone will be used automatically.' };
};

const formatConversationStatus = (
  voiceState: VoiceState,
  connectionState: RealtimeConnectionState,
  bookingStatus?: ConversationStateSnapshot['bookingConfirmationStatus'],
): { label: string; detail: string; progress: number } => {
  if (voiceState === 'booked' || bookingStatus === 'confirmed') {
    return { label: 'Appointment booked', detail: 'Appointment booked.', progress: 100 };
  }
  if (voiceState === 'booking') {
    return { label: 'Booking', detail: 'Booking the appointment...', progress: 92 };
  }
  if (voiceState === 'confirming' || bookingStatus === 'pending') {
    return { label: 'Confirming', detail: 'Waiting for a yes to book.', progress: 84 };
  }
  if (voiceState === 'collecting_customer') {
    return { label: 'Collecting customer', detail: 'Collecting customer details.', progress: 76 };
  }
  if (voiceState === 'offering_slots') {
    return { label: 'Offering slots', detail: 'Presenting the best openings.', progress: 68 };
  }
  if (voiceState === 'checking_availability') {
    return { label: 'Checking availability', detail: 'Checking availability...', progress: 58 };
  }
  if (voiceState === 'thinking' || voiceState === 'transcribing') {
    return { label: titleCase(voiceState), detail: voiceState === 'thinking' ? 'Thinking through the next response.' : 'Transcribing the latest user message.', progress: 46 };
  }
  if (voiceState === 'speaking') {
    return { label: 'Speaking', detail: 'AI receptionist is speaking...', progress: 52 };
  }
  if (voiceState === 'interrupted') {
    return { label: 'Interrupted', detail: 'Assistant audio stopped.', progress: 42 };
  }
  if (connectionState === 'webrtc_connected' || connectionState === 'data_channel_open') {
    return { label: 'Listening', detail: 'Customer is speaking...', progress: 34 };
  }
  if (connectionState === 'webrtc_connecting' || connectionState === 'session_created') {
    return { label: 'Connecting', detail: 'Creating the live voice session.', progress: 18 };
  }
  if (connectionState === 'api_connected') {
    return { label: 'Ready to answer', detail: 'Start the call to begin the conversation.', progress: 10 };
  }
  return { label: 'Ready to answer', detail: 'Start the call to begin the conversation.', progress: 0 };
};

const formatCallDuration = (startedAtMs: number): string => {
  const elapsedMs = Math.max(0, Date.now() - startedAtMs);
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

const updateWaveformState = (element: HTMLElement, state: VoiceState): void => {
  element.className = `waveform ${state}`;
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

export const mountReceptionistApp = ({ root, api }: MountOptions): { destroy: () => void } => {
  const dom = createDom(root);
  const state: AppState = {
    conversation: null,
    session: null,
    voiceState: 'idle',
    connectionState: 'idle',
    micState: 'off',
    toolStatus: [],
    metrics: [],
    diagnostics: {
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
    },
  };
  let callStartedAtMs: number | null = null;
  let callTimerHandle: number | null = null;
  let transcriptVisible = true;
  const buildSha = import.meta.env.VITE_VERCEL_GIT_COMMIT_SHA?.trim() || 'unknown';
  dom.buildMarker.textContent = `Build: ${buildSha.slice(0, 7)}`;

  const updateCallTimer = (): void => {
    dom.callTimer.textContent = callStartedAtMs === null ? '00:00' : formatCallDuration(callStartedAtMs);
  };

  const startCallTimer = (): void => {
    if (callStartedAtMs === null) {
      callStartedAtMs = Date.now();
    }
    updateCallTimer();
    if (callTimerHandle === null) {
      callTimerHandle = window.setInterval(updateCallTimer, 1000);
    }
  };

  const stopCallTimer = (): void => {
    callStartedAtMs = null;
    if (callTimerHandle !== null) {
      window.clearInterval(callTimerHandle);
      callTimerHandle = null;
    }
    updateCallTimer();
  };

  const setTranscriptVisibility = (visible: boolean): void => {
    transcriptVisible = visible;
    dom.transcriptCard.classList.toggle('collapsed', !visible);
    dom.clearBtn.setAttribute('aria-pressed', visible ? 'true' : 'false');
    dom.clearBtn.classList.toggle('active', visible);
  };

  const renderConversationSummary = (): void => {
    const conversation = state.conversation;
    const businessTimezone = conversation?.businessProfile?.timezone?.trim() || 'America/Chicago';
    const serviceSummary = formatServiceDetails(conversation);
    const preferredTimeSummary = formatPreferredTimeSummary(conversation, businessTimezone, new Date());
    const displayedVoiceState =
      state.voiceState === 'idle' && (state.connectionState === 'webrtc_connected' || state.connectionState === 'data_channel_open')
        ? 'listening'
        : state.voiceState;
    const statusSummary = formatConversationStatus(
      displayedVoiceState,
      state.connectionState,
      conversation?.bookingConfirmationStatus,
    );
    const customerName = conversation?.customerName?.trim();
    const hasCustomer = Boolean(customerName || conversation?.customerPhone?.trim());

    dom.callerTitle.textContent = hasCustomer ? 'Customer' : 'Caller';
    dom.nameValue.textContent = customerName || 'Details being collected';
    dom.phoneValue.textContent = conversation?.customerPhone ? maskPhoneForCard(conversation.customerPhone) : 'Details being collected';
    dom.customerBadge.textContent = hasCustomer ? 'Existing customer' : 'New customer';
    dom.callerAvatar.textContent = '';
    dom.callerAvatar.style.backgroundImage = 'url(/caller-avatar.png)';
    dom.callerAvatar.style.backgroundSize = 'cover';
    dom.callerAvatar.style.backgroundPosition = '18% center';

    dom.serviceValue.textContent = serviceSummary.name;
    dom.serviceMeta.textContent = serviceSummary.meta;

    dom.slotValue.textContent = preferredTimeSummary.value;
    dom.timeMeta.textContent = preferredTimeSummary.meta;

    dom.bookingValue.textContent = conversation?.bookingConfirmationStatus || 'Unconfirmed';

    dom.statusValue.textContent = statusSummary.label;
    dom.statusDetail.textContent = statusSummary.detail;
    dom.statusProgress.style.width = `${statusSummary.progress}%`;

    updateWaveformState(dom.waveform, displayedVoiceState);
    dom.voiceState.textContent = stages.find((entry) => entry.state === displayedVoiceState)?.label ?? titleCase(displayedVoiceState);
    dom.voiceHint.textContent = stages.find((entry) => entry.state === displayedVoiceState)?.hint ?? 'Start the call to begin the conversation.';

    if (state.connectionState === 'webrtc_connected' || state.connectionState === 'data_channel_open') {
      startCallTimer();
    } else if (state.connectionState === 'idle' || state.connectionState === 'error') {
      stopCallTimer();
    } else {
      updateCallTimer();
    }
  };

  const renderTranscriptEmptyState = (): void => {
    if (dom.transcript.querySelector('.message')) {
      return;
    }
    dom.transcript.innerHTML = '<div class="transcript-empty">Start the call to begin the conversation.</div>';
  };

  const appendTranscriptMessage = (role: 'user' | 'assistant' | 'tool', text: string): void => {
    if (dom.transcript.querySelector('.transcript-empty')) {
      dom.transcript.innerHTML = '';
    }
    const entry = document.createElement('article');
    entry.className = `message ${role}`;

    const avatar = document.createElement('div');
    avatar.className = `message-avatar ${role}`;
    avatar.textContent = role === 'assistant' ? 'SA' : role === 'tool' ? 'AI' : 'CU';

    const body = document.createElement('div');
    body.className = 'message-body';

    const header = document.createElement('div');
    header.className = 'message-header';
    const label = document.createElement('span');
    label.className = 'message-label';
    label.textContent = role === 'assistant' ? 'Sudo AI Receptionist' : role === 'tool' ? 'System' : 'Customer';
    const timestamp = document.createElement('span');
    timestamp.className = 'message-time';
    timestamp.textContent = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date());
    header.append(label, timestamp);

    const content = document.createElement('div');
    content.className = 'message-text';
    content.textContent = text;

    body.append(header, content);

    if (role === 'assistant') {
      entry.append(avatar, body);
    } else {
      entry.append(body, avatar);
    }

    dom.transcript.appendChild(entry);
    dom.transcript.scrollTo({ top: dom.transcript.scrollHeight, behavior: 'smooth' });
  };

  const seedWaveformBars = (): void => {
    if (dom.waveform.childElementCount > 0) {
      return;
    }
    for (let index = 0; index < 30; index += 1) {
      const bar = document.createElement('span');
      bar.style.setProperty('--bar-index', String(index));
      dom.waveform.appendChild(bar);
    }
  };

  const controller = new RealtimeVoiceController(
    api,
    {
      onStateChange: (voiceState) => {
        state.voiceState = voiceState;
        renderConversationSummary();
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
        renderConversationSummary();
        updateConnectButton();
        renderReadiness();
      },
      onMicStateChange: (micState) => {
        state.micState = micState;
        const meta = formatMicState(micState);
        setChipState(dom.micState, meta.label, meta.mode);
        renderConversationSummary();
        renderReadiness();
      },
      onTranscript: (role, text) => {
        appendTranscriptMessage(role, text);
        renderReadiness();
      },
      onSessionSummary: (summary) => {
        dom.sessionSummary.textContent = summary;
      },
      onConversationState: (conversation) => {
        state.conversation = conversation;
        if (conversation.bookingConfirmationStatus === 'confirmed') {
          state.voiceState = 'booked';
        } else if (conversation.bookingConfirmationStatus === 'pending') {
          state.voiceState = 'confirming';
        }
        renderConversationSummary();
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
          ['Attempt', diagnostics.connectionAttemptId],
          ['Connect in flight', diagnostics.connectInFlight],
          ['Session requests', diagnostics.sessionRequestCount],
          ['WebRTC requests', diagnostics.webrtcRequestCount],
          ['Peer connection', diagnostics.peerConnectionState],
          ['ICE connection', diagnostics.iceConnectionState],
          ['Signaling', diagnostics.signalingState],
          ['Data channel', diagnostics.dataChannelState],
          ['Local audio', diagnostics.localAudioTrackState],
          ['Remote audio', diagnostics.remoteAudioReceived],
          ['Last event', diagnostics.lastEventType],
          ['Last error', diagnostics.lastErrorMessage],
          ['Last error source', diagnostics.lastErrorSource],
          ['Last milestone', diagnostics.lastSuccessfulMilestone],
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
        renderConversationSummary();
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
    const connectLocked =
      controller.isConnectInFlight() ||
      state.voiceState === 'connecting' ||
      state.connectionState === 'session_created' ||
      state.connectionState === 'webrtc_connecting';
    const label = connectLocked && !hasSession
      ? 'Connecting...'
      : !hasSession
      ? 'Start call'
      : state.voiceState === 'connecting'
        ? 'Connecting...'
        : state.voiceState === 'listening'
          ? 'Listening...'
          : state.voiceState === 'transcribing'
            ? 'Transcribing...'
            : state.voiceState === 'thinking'
              ? 'Thinking...'
              : state.voiceState === 'checking_availability'
                ? 'Checking...'
                : state.voiceState === 'offering_slots'
                  ? 'Offering...'
                  : state.voiceState === 'collecting_customer'
                    ? 'Collecting...'
                    : state.voiceState === 'confirming'
                      ? 'Confirming...'
                      : state.voiceState === 'booking'
                        ? 'Booking...'
                        : state.voiceState === 'booked'
                          ? 'Booked'
                          : state.voiceState === 'interrupted'
                          ? 'Interrupted'
                            : 'End call';
    dom.connectLabel.textContent = label;
    dom.connectBtn.setAttribute('aria-label', hasSession ? 'End call' : 'Start call');
    dom.connectBtn.disabled = connectLocked;
    dom.connectBtn.classList.add('primary');
    dom.connectBtn.classList.remove('danger');
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
      renderConversationSummary();
      renderReadiness();
    } catch {
      setChipState(dom.apiState, 'API offline', 'fail');
      setChipState(dom.connectionState, 'Disconnected');
      state.connectionState = 'idle';
      if (!state.session) {
        dom.sessionSummary.textContent = 'Unable to reach the backend health endpoint.';
      }
      setStatusDot(dom.connectionDot, 'fail');
      renderConversationSummary();
      renderReadiness();
    }
  };

  const connect = async (): Promise<void> => {
    if (state.session) {
      await disconnect();
      return;
    }
    if (
      controller.isConnectInFlight() ||
      state.voiceState === 'connecting' ||
      state.connectionState === 'session_created' ||
      state.connectionState === 'webrtc_connecting'
    ) {
      return;
    }
    state.voiceState = 'connecting';
    dom.sessionSummary.textContent = 'Creating the live voice session...';
    setChipState(dom.connectionState, 'Connecting', 'warn');
    setStatusDot(dom.connectionDot, 'warn');
    updateConnectButton();
    renderStages();
    try {
      const session = await controller.connect(state.conversation ?? undefined);
      if (!session) {
        updateConnectButton();
        renderReadiness();
        renderStages();
        return;
      }
      state.session = session;
      dom.sessionSummary.textContent = `Session ${session.conversationId} ready.`;
      renderConversationSummary();
      updateConnectButton();
      renderReadiness();
      renderStages();
    } catch (error) {
      setChipState(dom.connectionState, 'Connection failed', 'fail');
      setStatusDot(dom.connectionDot, 'fail');
      dom.sessionSummary.textContent = error instanceof Error ? error.message : 'Failed to create voice session.';
      state.voiceState = 'error';
      renderConversationSummary();
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
    state.voiceState = 'idle';
    setChipState(dom.micState, 'Mic off');
    state.micState = 'off';
    setStatusDot(dom.connectionDot, '');
    stopCallTimer();
    renderTranscriptEmptyState();
    renderConversationSummary();
    updateConnectButton();
    renderReadiness();
    renderStages();
  };

  const enableMic = async (): Promise<void> => {
    try {
      await controller.enableMic();
      dom.sessionSummary.textContent = 'Microphone permission granted.';
      renderConversationSummary();
      renderReadiness();
    } catch {
      setChipState(dom.micState, 'Mic blocked', 'fail');
      dom.sessionSummary.textContent = 'Microphone permission was denied.';
      renderConversationSummary();
      renderReadiness();
    }
  };

  const interrupt = (): void => {
    void controller.interrupt();
    state.voiceState = 'interrupted';
    renderConversationSummary();
    updateConnectButton();
    renderReadiness();
  };

  const toggleTranscript = (): void => {
    setTranscriptVisibility(!transcriptVisible);
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
    seedWaveformBars();
    setChipState(dom.connectionState, 'Disconnected');
    setChipState(dom.micState, 'Mic off');
    setChipState(dom.voiceState, 'Ready to start');
    setTranscriptVisibility(true);
    renderTranscriptEmptyState();
    renderConversationSummary();
    updateConnectButton();
    renderReadiness();
    renderStages();
    void refreshHealth();
  };

  dom.connectBtn.addEventListener('click', () => { void connect(); });
  dom.micBtn.addEventListener('click', () => { void enableMic(); });
  dom.interruptBtn.addEventListener('click', interrupt);
  dom.clearBtn.addEventListener('click', toggleTranscript);
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
      if (callTimerHandle !== null) {
        window.clearInterval(callTimerHandle);
        callTimerHandle = null;
      }
      void controller.dispose();
    },
  };
};
