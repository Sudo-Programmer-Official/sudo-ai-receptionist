import type { ApiClient } from './api';
import type { ChatResponse, ConversationStateSnapshot, ToolStatus } from './types';
import { requestRealtimeSession } from './realtime';

type MountOptions = {
  root: HTMLElement;
  api: ApiClient;
};

type AppDom = {
  transcript: HTMLElement;
  sessionSummary: HTMLElement;
  toolStatus: HTMLElement;
  connectionState: HTMLElement;
  apiState: HTMLElement;
  micState: HTMLElement;
  speakState: HTMLElement;
  connectionDot: HTMLElement;
  toolDot: HTMLElement;
  serviceValue: HTMLElement;
  nameValue: HTMLElement;
  phoneValue: HTMLElement;
  slotValue: HTMLElement;
  bookingValue: HTMLElement;
  userText: HTMLTextAreaElement;
  connectBtn: HTMLButtonElement;
  micBtn: HTMLButtonElement;
  interruptBtn: HTMLButtonElement;
  sendBtn: HTMLButtonElement;
  clearBtn: HTMLButtonElement;
};

type AppState = {
  conversation: ConversationStateSnapshot | null;
};

const shellMarkup = `
  <main>
    <header>
      <div>
        <h1>AI Receptionist</h1>
        <p>Browser voice scaffold for realtime intake, tool execution visibility, and booking confirmation.</p>
      </div>
      <div class="chips" id="connectionChips">
        <div class="chip" id="connectionState">Disconnected</div>
        <div class="chip" id="apiState">Checking API</div>
        <div class="chip" id="micState">Mic off</div>
        <div class="chip" id="speakState">Idle</div>
      </div>
    </header>

    <div class="grid">
      <section class="panel">
        <div class="section-title">
          <div>
            <strong>Conversation</strong>
            <div class="small">Transcript, live controls, and confirmation flow.</div>
          </div>
          <div class="row">
            <button class="primary" id="connectBtn">Connect</button>
            <button class="ghost" id="micBtn">Enable Mic</button>
            <button class="danger" id="interruptBtn">Interrupt</button>
          </div>
        </div>
        <div class="panel-inner stack">
          <div class="cards">
            <div class="card">
              <div class="row">
                <div class="status-dot" id="connectionDot"></div>
                <strong>Session state</strong>
              </div>
              <div class="small" id="sessionSummary">No session started.</div>
            </div>
            <div class="card">
              <div class="row">
                <div class="status-dot" id="toolDot"></div>
                <strong>Tool execution</strong>
              </div>
              <div class="small" id="toolStatus">Waiting for an availability lookup or booking action.</div>
            </div>
          </div>

          <div class="card">
            <div class="row" style="justify-content: space-between;">
              <strong>Transcript</strong>
              <button class="ghost" id="clearBtn">Clear</button>
            </div>
            <div class="transcript" id="transcript"></div>
          </div>

          <div class="card stack">
            <strong>Send text fallback</strong>
            <textarea id="userText" placeholder="Type what the customer says if voice is unavailable."></textarea>
            <div class="row">
              <button class="primary" id="sendBtn">Send</button>
              <span class="small">The client only talks to the backend for session creation and tool execution.</span>
            </div>
          </div>
        </div>
      </section>

      <aside class="panel">
        <div class="section-title">
          <div>
            <strong>Booking details</strong>
            <div class="small">Final confirmation state.</div>
          </div>
        </div>
        <div class="panel-inner stack">
          <div class="card">
            <div class="small">Selected service</div>
            <div id="serviceValue">None yet</div>
          </div>
          <div class="card split">
            <div>
              <div class="small">Customer name</div>
              <div id="nameValue">Pending</div>
            </div>
            <div>
              <div class="small">Customer phone</div>
              <div id="phoneValue">Pending</div>
            </div>
          </div>
          <div class="card">
            <div class="small">Appointment slot</div>
            <div id="slotValue">No slot selected</div>
          </div>
          <div class="card">
            <div class="small">Booking status</div>
            <div id="bookingValue">Unconfirmed</div>
          </div>
          <div class="card">
            <div class="small">Connection notes</div>
            <div class="small">
              Mic permission, speaking/listening indicators, interruption handling, and transcript visibility are wired at the UI layer.
            </div>
          </div>
        </div>
        <div class="footer-note">
          Realtime session creation and any OpenAI or SalonFlow action should stay on the backend.
        </div>
      </aside>
    </div>
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

const summarizeToolStatus = (items: ToolStatus[] | undefined): string =>
  items && items.length > 0 ? JSON.stringify(items) : 'No tools used in this turn.';

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
    toolStatus: get('toolStatus'),
    connectionState: get('connectionState'),
    apiState: get('apiState'),
    micState: get('micState'),
    speakState: get('speakState'),
    connectionDot: get('connectionDot'),
    toolDot: get('toolDot'),
    serviceValue: get('serviceValue'),
    nameValue: get('nameValue'),
    phoneValue: get('phoneValue'),
    slotValue: get('slotValue'),
    bookingValue: get('bookingValue'),
    userText: get<HTMLTextAreaElement>('userText'),
    connectBtn: get<HTMLButtonElement>('connectBtn'),
    micBtn: get<HTMLButtonElement>('micBtn'),
    interruptBtn: get<HTMLButtonElement>('interruptBtn'),
    sendBtn: get<HTMLButtonElement>('sendBtn'),
    clearBtn: get<HTMLButtonElement>('clearBtn'),
  };
};

export const mountReceptionistApp = ({ root, api }: MountOptions): { destroy: () => void } => {
  const dom = createDom(root);
  const state: AppState = { conversation: null };

  const appendBubble = (role: 'user' | 'assistant' | 'tool', text: string): void => {
    const bubble = document.createElement('div');
    bubble.className = `bubble ${role}`;
    bubble.textContent = text;
    dom.transcript.appendChild(bubble);
    dom.transcript.scrollTop = dom.transcript.scrollHeight;
  };

  const syncBooking = (): void => {
    dom.serviceValue.textContent = state.conversation?.requestedService || 'None yet';
    dom.nameValue.textContent = state.conversation?.customerName || 'Pending';
    dom.phoneValue.textContent = state.conversation?.customerPhone || 'Pending';
    dom.slotValue.textContent =
      state.conversation?.selectedSlot?.startsAt ||
      state.conversation?.proposedSlots?.[0]?.startsAt ||
      'No slot selected';
    dom.bookingValue.textContent = state.conversation?.bookingConfirmationStatus || 'Unconfirmed';
  };

  const setApiHealth = (label: string, mode: 'active' | 'warn' | 'fail' | undefined): void => {
    setChipState(dom.apiState, label, mode);
  };

  const refreshHealth = async (): Promise<void> => {
    setApiHealth('Checking API', 'warn');
    try {
      const health = await api.getHealth();
      const label = health.ok === false ? 'API degraded' : 'API healthy';
      setApiHealth(label, 'active');
      dom.sessionSummary.textContent = `Health check succeeded via /health${health.status ? ` (${health.status})` : ''}.`;
    } catch {
      setApiHealth('API offline', 'fail');
      dom.sessionSummary.textContent = 'Unable to reach the backend health endpoint.';
    }
  };

  const connect = async (): Promise<void> => {
    setChipState(dom.connectionState, 'Connecting...', 'warn');
    setStatusDot(dom.connectionDot, 'warn');
    dom.sessionSummary.textContent = 'Requesting ephemeral session from backend...';
    try {
      const session = await requestRealtimeSession(api);
      state.conversation = {
        ...(state.conversation ?? {}),
        conversationId: session.conversationId,
      };
      setChipState(dom.connectionState, 'Connected', 'active');
      setStatusDot(dom.connectionDot, 'live');
      dom.sessionSummary.textContent = `Session ${session.conversationId} expires at ${session.expiresAt}`;
      appendBubble('tool', 'Realtime session created on the backend.');
      syncBooking();
    } catch (error) {
      setChipState(dom.connectionState, 'Connection failed', 'fail');
      setStatusDot(dom.connectionDot, 'fail');
      dom.sessionSummary.textContent = error instanceof Error ? error.message : 'Failed to create session.';
    }
  };

  const sendText = async (): Promise<void> => {
    const text = dom.userText.value.trim();
    if (!text) return;
    appendBubble('user', text);
    setChipState(dom.speakState, 'Listening', 'active');
    try {
      const response: ChatResponse = await api.sendChat({
        text,
        ...(state.conversation ? { state: state.conversation } : {}),
      });
      state.conversation = response.state ?? state.conversation;
      appendBubble('assistant', response.message);
      dom.toolStatus.textContent = summarizeToolStatus(response.toolStatus);
      setStatusDot(dom.toolDot, response.toolStatus?.some((entry) => entry.status === 'ok') ? 'live' : '');
      syncBooking();
      setChipState(dom.speakState, response.requiresUserAction ? 'Waiting' : 'Speaking', response.requiresUserAction ? 'warn' : 'active');
    } catch (error) {
      appendBubble('tool', error instanceof Error ? error.message : 'The backend request failed.');
      setChipState(dom.speakState, 'Error', 'fail');
      setStatusDot(dom.toolDot, 'fail');
    } finally {
      dom.userText.value = '';
    }
  };

  const enableMic = async (): Promise<void> => {
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      setChipState(dom.micState, 'Mic enabled', 'active');
      appendBubble('tool', 'Microphone permission granted.');
    } catch {
      setChipState(dom.micState, 'Mic blocked', 'warn');
      appendBubble('tool', 'Microphone permission was denied.');
    }
  };

  const interrupt = (): void => {
    setChipState(dom.speakState, 'Interrupted', 'warn');
    appendBubble('tool', 'User interrupted the agent. The backend should cancel the current response.');
  };

  const clearTranscript = (): void => {
    dom.transcript.innerHTML = '';
  };

  const onConnect = (): void => {
    void connect();
  };

  const onSend = (): void => {
    void sendText();
  };

  const onMic = (): void => {
    void enableMic();
  };

  const onLoad = (): void => {
    setChipState(dom.connectionState, 'Disconnected');
    setChipState(dom.micState, 'Mic off');
    setChipState(dom.speakState, 'Idle');
    syncBooking();
    void refreshHealth();
  };

  dom.connectBtn.addEventListener('click', onConnect);
  dom.sendBtn.addEventListener('click', onSend);
  dom.micBtn.addEventListener('click', onMic);
  dom.interruptBtn.addEventListener('click', interrupt);
  dom.clearBtn.addEventListener('click', clearTranscript);
  window.addEventListener('load', onLoad, { once: true });

  if (document.readyState !== 'loading') {
    onLoad();
  }

  return {
    destroy: () => {
      dom.connectBtn.removeEventListener('click', onConnect);
      dom.sendBtn.removeEventListener('click', onSend);
      dom.micBtn.removeEventListener('click', onMic);
      dom.interruptBtn.removeEventListener('click', interrupt);
      dom.clearBtn.removeEventListener('click', clearTranscript);
      window.removeEventListener('load', onLoad);
    },
  };
};
