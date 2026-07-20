import { describe, expect, test, vi } from 'vitest';
import { resolveRealtimeBusinessContext } from '../src/realtime';

describe('resolveRealtimeBusinessContext', () => {
  test('builds context from the adapter when the business lookup succeeds', async () => {
    const adapter = {
      getBusinessProfile: vi.fn(async () => ({
        businessId: 'demo-salon',
        name: 'Aurora Salon',
        timezone: 'America/Denver',
        phone: '+1 (555) 010-2000',
        website: 'https://demo.example',
        policies: ['24 hour cancellation notice'],
        hours: [],
      })),
      listServices: vi.fn(async () => ([
        { serviceId: 'svc-cut', name: 'Haircut', durationMinutes: 45 },
      ])),
    };
    const logger = { log: vi.fn() };

    const context = await resolveRealtimeBusinessContext({
      adapter: adapter as never,
      businessId: 'demo-salon',
      correlationId: 'corr_test',
      logger,
    });

    expect(context).toMatchObject({
      businessName: 'Aurora Salon',
      serviceNames: ['Haircut'],
      timeZone: 'America/Denver',
      location: 'https://demo.example',
      bookingPolicy: '24 hour cancellation notice',
    });
    expect(logger.log).not.toHaveBeenCalled();
  });

  test('falls back when the adapter lookup fails', async () => {
    const adapter = {
      getBusinessProfile: vi.fn(async () => {
        throw new Error('upstream unavailable');
      }),
      listServices: vi.fn(async () => {
        throw new Error('unreachable');
      }),
    };
    const logger = { log: vi.fn() };

    const context = await resolveRealtimeBusinessContext({
      adapter: adapter as never,
      businessId: 'demo-salon',
      correlationId: 'corr_test',
      logger,
    });

    expect(context).toMatchObject({
      businessName: 'Your salon',
      serviceNames: [],
      timeZone: 'unknown',
    });
    expect(logger.log).toHaveBeenCalledWith(
      'warn',
      'realtime business context lookup failed; using fallback',
      expect.objectContaining({
        businessId: 'demo-salon',
        correlationId: 'corr_test',
      }),
    );
  });
});
