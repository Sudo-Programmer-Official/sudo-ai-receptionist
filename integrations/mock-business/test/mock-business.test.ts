import { describe, expect, it } from 'vitest';
import { MockBusinessAdapter } from '../src/index.js';

describe('MockBusinessAdapter', () => {
  it('returns business profile and services', async () => {
    const adapter = new MockBusinessAdapter();
    const profile = await adapter.getBusinessProfile({ businessId: 'demo-salon', correlationId: 'c1' });
    const services = await adapter.listServices({ businessId: 'demo-salon', correlationId: 'c1' });
    expect(profile.businessId).toBe('demo-salon');
    expect(services.length).toBeGreaterThan(0);
  });

  it('returns availability and creates idempotent bookings', async () => {
    const adapter = new MockBusinessAdapter();
    const availability = await adapter.findAvailability({
      businessId: 'demo-salon',
      serviceId: 'svc-cut',
      preferredDate: '2026-07-19',
      limit: 3,
      correlationId: 'c2'
    });
    expect(availability.slots.length).toBeGreaterThan(0);

    const customer = await adapter.findOrCreateCustomer({
      businessId: 'demo-salon',
      fullName: 'Jordan Lee',
      phoneNumber: '555-010-3333',
      correlationId: 'c3'
    });
    const slot = availability.slots[0];
    expect(slot).toBeDefined();
    if (!slot) throw new Error('missing slot');

    const first = await adapter.createBooking({
      businessId: 'demo-salon',
      serviceId: 'svc-cut',
      customerId: customer.customerId,
      slotId: slot.slotId,
      startsAt: slot.startsAt,
      idempotencyKey: 'idem-key',
      correlationId: 'c4'
    });
    const second = await adapter.createBooking({
      businessId: 'demo-salon',
      serviceId: 'svc-cut',
      customerId: customer.customerId,
      slotId: slot.slotId,
      startsAt: slot.startsAt,
      idempotencyKey: 'idem-key',
      correlationId: 'c4'
    });
    expect(second.bookingId).toBe(first.bookingId);
  });
});

