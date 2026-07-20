# Voice Smoke Test Checklist

Use this before deploying any voice-related changes. Do not create a live booking while running this checklist.

## Required checks

- Frontend loads successfully in the browser.
- `GET /health` returns `200 OK`.
- The frontend can request a realtime session from the API.
- The WebRTC connection reaches `connected`.
- Microphone permission changes the mic state to enabled.
- A user transcript appears in the UI.
- Assistant audio begins playing.
- Interrupting the session stops assistant playback immediately.
- The session closes cleanly without errors.
- No booking write endpoint is called.
- No customer write endpoint is called.

## Suggested browser flow

1. Open the receptionist web app.
2. Confirm the health chip reports a healthy backend.
3. Start the voice session.
4. Speak: `I’d like a haircut tomorrow afternoon.`
5. Confirm the assistant asks one question at a time.
6. Interrupt the assistant mid-response.
7. Close the session.
8. Inspect network logs and confirm no booking or customer write request was sent.

## Pass criteria

- Voice connects without manual console intervention.
- CORS permits the browser origin only when it is allowed.
- The smoke test ends with no created appointment.
- Any failure blocks deployment until the voice path is fixed.
