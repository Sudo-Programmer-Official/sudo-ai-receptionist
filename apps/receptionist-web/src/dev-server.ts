import http from 'node:http';

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>AI Receptionist Demo</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #08111f;
        --panel: rgba(11, 23, 42, 0.88);
        --panel-border: rgba(148, 163, 184, 0.22);
        --text: #e5eefb;
        --muted: #9db0c9;
        --accent: #56b3ff;
        --accent-2: #82f7c7;
        --danger: #ff7c8b;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
        color: var(--text);
        background:
          radial-gradient(circle at top left, rgba(86, 179, 255, 0.18), transparent 30%),
          radial-gradient(circle at top right, rgba(130, 247, 199, 0.14), transparent 28%),
          linear-gradient(180deg, #07101b 0%, #030712 100%);
      }
      main {
        max-width: 1180px;
        margin: 0 auto;
        padding: 32px 20px 48px;
      }
      header {
        display: flex;
        align-items: end;
        justify-content: space-between;
        gap: 16px;
        margin-bottom: 24px;
      }
      h1 { margin: 0; font-size: clamp(2rem, 3vw, 3.5rem); letter-spacing: -0.04em; }
      p { margin: 0; color: var(--muted); line-height: 1.5; }
      .grid {
        display: grid;
        grid-template-columns: 1.4fr 0.9fr;
        gap: 18px;
      }
      .panel {
        background: var(--panel);
        border: 1px solid var(--panel-border);
        border-radius: 24px;
        box-shadow: 0 32px 90px rgba(0, 0, 0, 0.35);
        overflow: hidden;
      }
      .panel-inner { padding: 20px; }
      .stack { display: grid; gap: 14px; }
      .row { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
      button {
        border: 0;
        border-radius: 999px;
        padding: 12px 16px;
        background: #16263d;
        color: var(--text);
        font-weight: 600;
        cursor: pointer;
      }
      button.primary { background: linear-gradient(135deg, var(--accent), #7b8dff); color: #07111f; }
      button.ghost { background: transparent; border: 1px solid var(--panel-border); }
      button.danger { background: rgba(255, 124, 139, 0.14); color: #ffd1d7; border: 1px solid rgba(255, 124, 139, 0.32); }
      .chips { display: flex; flex-wrap: wrap; gap: 8px; }
      .chip {
        border-radius: 999px;
        padding: 8px 12px;
        border: 1px solid var(--panel-border);
        color: var(--muted);
        background: rgba(255,255,255,0.03);
      }
      .chip.active { color: #08111f; background: var(--accent-2); border-color: transparent; }
      .chip.warn { color: #08111f; background: #ffd166; border-color: transparent; }
      .section-title {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
        padding: 18px 20px 0;
      }
      .cards { display: grid; gap: 12px; }
      .card {
        padding: 16px;
        border-radius: 18px;
        background: rgba(255,255,255,0.03);
        border: 1px solid var(--panel-border);
      }
      .small { font-size: 0.92rem; color: var(--muted); }
      .transcript {
        min-height: 280px;
        max-height: 420px;
        overflow: auto;
        display: grid;
        gap: 10px;
      }
      .bubble {
        max-width: 100%;
        padding: 12px 14px;
        border-radius: 18px;
        line-height: 1.45;
        white-space: pre-wrap;
      }
      .bubble.user { background: rgba(86, 179, 255, 0.12); border: 1px solid rgba(86, 179, 255, 0.2); }
      .bubble.assistant { background: rgba(130, 247, 199, 0.12); border: 1px solid rgba(130, 247, 199, 0.2); }
      .bubble.tool { background: rgba(255, 255, 255, 0.05); border: 1px solid var(--panel-border); }
      textarea {
        width: 100%;
        min-height: 110px;
        resize: vertical;
        border-radius: 16px;
        border: 1px solid var(--panel-border);
        background: rgba(255,255,255,0.03);
        color: var(--text);
        padding: 12px 14px;
        font: inherit;
      }
      input {
        width: 100%;
        border-radius: 14px;
        border: 1px solid var(--panel-border);
        background: rgba(255,255,255,0.03);
        color: var(--text);
        padding: 12px 14px;
        font: inherit;
      }
      .split { display: grid; gap: 12px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .status-dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background: var(--muted);
        box-shadow: 0 0 0 0 rgba(130, 247, 199, 0.0);
      }
      .status-dot.live { background: var(--accent-2); box-shadow: 0 0 0 6px rgba(130, 247, 199, 0.08); }
      .status-dot.warn { background: #ffd166; box-shadow: 0 0 0 6px rgba(255, 209, 102, 0.08); }
      .status-dot.fail { background: var(--danger); box-shadow: 0 0 0 6px rgba(255, 124, 139, 0.08); }
      .footer-note { padding: 0 20px 18px; color: var(--muted); font-size: 0.92rem; }
      @media (max-width: 920px) {
        .grid { grid-template-columns: 1fr; }
        .split { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    <main>
      <header>
        <div>
          <h1>AI Receptionist</h1>
          <p>Browser voice scaffold for realtime intake, tool execution visibility, and booking confirmation.</p>
        </div>
        <div class="chips" id="connectionChips">
          <div class="chip" id="connectionState">Disconnected</div>
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

    <script type="module">
      const transcript = document.getElementById('transcript');
      const sessionSummary = document.getElementById('sessionSummary');
      const toolStatus = document.getElementById('toolStatus');
      const connectionState = document.getElementById('connectionState');
      const micState = document.getElementById('micState');
      const speakState = document.getElementById('speakState');
      const connectionDot = document.getElementById('connectionDot');
      const toolDot = document.getElementById('toolDot');
      const serviceValue = document.getElementById('serviceValue');
      const nameValue = document.getElementById('nameValue');
      const phoneValue = document.getElementById('phoneValue');
      const slotValue = document.getElementById('slotValue');
      const bookingValue = document.getElementById('bookingValue');
      const userText = document.getElementById('userText');

      let state = null;

      const setDot = (dot, mode) => {
        dot.classList.remove('live', 'warn', 'fail');
        if (mode) dot.classList.add(mode);
      };

      const addBubble = (role, text) => {
        const el = document.createElement('div');
        el.className = 'bubble ' + role;
        el.textContent = text;
        transcript.appendChild(el);
        transcript.scrollTop = transcript.scrollHeight;
      };

      const syncBooking = () => {
        serviceValue.textContent = state?.requestedService || 'None yet';
        nameValue.textContent = state?.customerName || 'Pending';
        phoneValue.textContent = state?.customerPhone || 'Pending';
        slotValue.textContent = state?.selectedSlot?.startsAt || state?.proposedSlots?.[0]?.startsAt || 'No slot selected';
        bookingValue.textContent = state?.bookingConfirmationStatus || 'Unconfirmed';
      };

      const setConnection = (value, mode) => {
        connectionState.textContent = value;
        setDot(connectionDot, mode);
      };

      const setMic = (value, mode) => {
        micState.textContent = value;
        micState.className = 'chip' + (mode ? ' ' + mode : '');
      };

      const setSpeak = (value, mode) => {
        speakState.textContent = value;
        speakState.className = 'chip' + (mode ? ' ' + mode : '');
      };

      document.getElementById('connectBtn').addEventListener('click', async () => {
        setConnection('Connecting...', 'warn');
        sessionSummary.textContent = 'Requesting ephemeral session from backend...';
        const response = await fetch('/api/realtime/session', { method: 'POST' });
        const session = await response.json();
        state = { conversationId: session.conversationId, bookingConfirmationStatus: 'unconfirmed', proposedSlots: [] };
        setConnection('Connected', 'live');
        sessionSummary.textContent = 'Session ' + session.conversationId + ' expires at ' + session.expiresAt;
        addBubble('tool', 'Realtime session created on the backend.');
      });

      document.getElementById('micBtn').addEventListener('click', async () => {
        try {
          await navigator.mediaDevices.getUserMedia({ audio: true });
          setMic('Mic enabled', 'active');
          addBubble('tool', 'Microphone permission granted.');
        } catch {
          setMic('Mic blocked', 'warn');
          addBubble('tool', 'Microphone permission was denied.');
        }
      });

      document.getElementById('interruptBtn').addEventListener('click', () => {
        setSpeak('Interrupted', 'warn');
        addBubble('tool', 'User interrupted the agent. The backend should cancel the current response.');
      });

      document.getElementById('sendBtn').addEventListener('click', async () => {
        const text = String(userText.value || '').trim();
        if (!text) return;
        addBubble('user', text);
        setSpeak('Listening', 'live');
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, state })
        });
        const payload = await response.json();
        state = payload.state;
        addBubble('assistant', payload.message);
        toolStatus.textContent = payload.toolStatus?.length ? JSON.stringify(payload.toolStatus) : 'No tools used in this turn.';
        setDot(toolDot, payload.toolStatus?.some((entry) => entry.status === 'ok') ? 'live' : '');
        syncBooking();
        setSpeak('Speaking', payload.requiresUserAction ? 'warn' : 'active');
        userText.value = '';
      });

      document.getElementById('clearBtn').addEventListener('click', () => {
        transcript.innerHTML = '';
      });

      window.addEventListener('load', () => {
        setConnection('Disconnected', '');
        setMic('Mic off', '');
        setSpeak('Idle', '');
        syncBooking();
      });
    </script>
  </body>
</html>`;

http.createServer((_, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}).listen(5173, () => {
  console.log('receptionist-web listening on http://localhost:5173');
});

