import { afterEach, describe, expect, test, vi } from 'vitest';
import { SalonFlowAdapter } from '../src/index.js';

describe('SalonFlowAdapter availability contract', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('sends the exact availability payload contract', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({
        slots: [],
        source: 'salonflow',
        expiresAt: '2026-07-21T00:00:00.000Z',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    vi.stubGlobal('fetch', fetchImpl as typeof fetch);

    const adapter = new SalonFlowAdapter({
      baseUrl: 'https://salonflow.example',
      integrationToken: 'token',
    });

    await adapter.findAvailability({
      businessId: 'biz_1',
      serviceId: 'svc_cut',
      preferredDate: '2026-07-21',
      preferredTimeRange: '11am-12pm',
      staffPreference: 'Ava',
      limit: 3,
      correlationId: 'corr_1',
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe('https://salonflow.example/api/integrations/receptionist/biz_1/availability');
    expect(init).toMatchObject({
      method: 'POST',
      body: JSON.stringify({
        serviceId: 'svc_cut',
        preferredDate: '2026-07-21',
        preferredTimeRange: '11am-12pm',
        limit: 3,
      }),
    });
  });
});
