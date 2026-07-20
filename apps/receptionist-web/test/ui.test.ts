import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createApiClient } from '../src/api';
import { mountReceptionistApp } from '../src/ui';

describe('mountReceptionistApp', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
  });

  test('renders a health check state and the booking scaffolding', async () => {
    const api = createApiClient({
      baseUrl: 'https://backend.example',
      fetchImpl: vi.fn(async (input) => {
        const url = String(input);
        if (url.endsWith('/health')) {
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        throw new Error(`Unexpected request: ${url}`);
      }) as typeof fetch,
    });
    const root = document.getElementById('app');

    if (!root) {
      throw new Error('Missing app root');
    }

    mountReceptionistApp({ root, api });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(document.querySelector('#transcript')).not.toBeNull();
    expect(document.querySelector('#sessionSummary')?.textContent).toContain('Health check succeeded');
    expect(document.querySelector('#apiState')?.textContent).toContain('API healthy');
    expect(document.querySelector('#bookingValue')?.textContent).toBe('Unconfirmed');
  });
});
