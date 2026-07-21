import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAgent } from '../src/index.js';
import type { BusinessAdapter } from '@sudo-ai-receptionist/business-contracts';

const createTestAdapter = (): {
  adapter: BusinessAdapter;
  availabilityInputs: Array<Parameters<BusinessAdapter['findAvailability']>[0]>;
} => {
  const availabilityInputs: Array<Parameters<BusinessAdapter['findAvailability']>[0]> = [];
  const businessProfile = {
    businessId: 'demo-salon',
    name: 'Demo Salon',
    timezone: 'America/Chicago',
    phone: '+1 (555) 010-2000',
    website: 'https://demo.example',
    policies: [],
    hours: [],
  };
  const services = [{ serviceId: 'svc-cut', name: 'Haircut', durationMinutes: 45 }];

  return {
    availabilityInputs,
    adapter: {
      getBusinessProfile: vi.fn(async () => businessProfile),
      listServices: vi.fn(async () => services),
      listStaff: vi.fn(async () => []),
      findAvailability: vi.fn(async (input) => {
        availabilityInputs.push(input);
        return {
          slots: [
            {
              slotId: `${input.preferredDate}-${input.serviceId}-1`,
              startsAt: `${input.preferredDate}T11:00:00-05:00`,
              endsAt: `${input.preferredDate}T12:00:00-05:00`,
            },
          ],
          source: 'mock',
          expiresAt: '2026-07-21T00:00:00.000Z',
        };
      }),
      findOrCreateCustomer: vi.fn(async () => ({
        customerId: 'cust_1',
        fullName: 'Test Customer',
        phoneNumber: '+1 (555) 010-4242',
      })),
      createBooking: vi.fn(async () => ({
        bookingId: 'book_1',
        customerId: 'cust_1',
        serviceId: 'svc-cut',
        slotId: 'slot_1',
        startsAt: '2026-07-21T11:00:00-05:00',
        status: 'confirmed',
        summary: 'Demo Salon',
      })),
      sendConfirmation: vi.fn(async () => ({ delivered: true })),
    },
  };
};

describe('ReceptionistAgent', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-20T15:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ['Haircut tomorrow at 11am', '2026-07-21', '11am-12pm'],
    ['Haircut tomorrow afternoon', '2026-07-21', 'afternoon'],
    ['Haircut July 21, 2026 at 11:00 AM', '2026-07-21', '11am-12pm'],
    ['Haircut 2026-07-21 11:00 AM', '2026-07-21', '11am-12pm'],
  ])('normalizes availability intent for %s', async (text, expectedDate, expectedTimeRange) => {
    const { adapter, availabilityInputs } = createTestAdapter();
    const agent = createAgent(adapter);

    const result = await agent.handleTurn({
      text,
      businessId: 'demo-salon',
      channel: 'voice',
    });

    expect(result.state.serviceId).toBe('svc-cut');
    expect(result.state.preferredDate).toBe(expectedDate);
    expect(result.state.preferredTimeRange).toBe(expectedTimeRange);
    expect(availabilityInputs).toHaveLength(1);
    expect(availabilityInputs[0]).toMatchObject({
      businessId: 'demo-salon',
      serviceId: 'svc-cut',
      preferredDate: expectedDate,
      preferredTimeRange: expectedTimeRange,
      limit: 3,
    });
  });

  it('does not throw on invalid dates and asks for clarification', async () => {
    const { adapter, availabilityInputs } = createTestAdapter();
    const agent = createAgent(adapter);

    const result = await agent.handleTurn({
      text: 'Haircut July 32, 2026 at 11am',
      businessId: 'demo-salon',
      channel: 'voice',
    });

    expect(result.message).toContain('I could not parse that date and time');
    expect(result.state.requestedService).toBe('Haircut');
    expect(result.state.serviceId).toBe('svc-cut');
    expect(availabilityInputs).toHaveLength(0);
  });

  it('returns the updated empty-availability message with a preserved display date', async () => {
    const adapter: BusinessAdapter = {
      getBusinessProfile: vi.fn(async () => ({
        businessId: 'demo-salon',
        name: 'Demo Salon',
        timezone: 'America/Chicago',
        phone: '+1 (555) 010-2000',
        website: 'https://demo.example',
        policies: [],
        hours: [],
      })),
      listServices: vi.fn(async () => [
        { serviceId: '03d10f69-0e9b-408c-a827-6db63ef29765', name: 'Gel', durationMinutes: 30 },
      ]),
      listStaff: vi.fn(async () => []),
      findAvailability: vi.fn(async () => ({
        slots: [],
        source: 'salonflow',
        expiresAt: '2026-07-21T00:00:00.000Z',
      })),
      findOrCreateCustomer: vi.fn(async () => ({
        customerId: 'cust_1',
        fullName: 'Test Customer',
        phoneNumber: '+1 (555) 010-4242',
      })),
      createBooking: vi.fn(async () => ({
        bookingId: 'book_1',
        customerId: 'cust_1',
        serviceId: '03d10f69-0e9b-408c-a827-6db63ef29765',
        slotId: 'slot_1',
        startsAt: '2026-07-21T11:00:00-05:00',
        status: 'confirmed',
        summary: 'Demo Salon',
      })),
      sendConfirmation: vi.fn(async () => ({ delivered: true })),
    };
    const agent = createAgent(adapter);

    const result = await agent.handleTurn({
      text: 'Gel tomorrow at 11am',
      businessId: 'demo-salon',
      channel: 'voice',
    });

    expect(result.message).toBe("I couldn’t find an opening for Gel on July 21. Would you like me to check the afternoon or another day?");
  });
});
