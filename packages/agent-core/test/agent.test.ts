import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAgent } from '../src/index.js';
import type { BusinessAdapter, AvailabilitySlot } from '@sudo-ai-receptionist/business-contracts';

const demoBusinessProfile = {
  businessId: 'demo-salon',
  name: 'Demo Salon',
  timezone: 'America/Chicago',
  phone: '+1 (555) 010-2000',
  website: 'https://demo.example',
  policies: [],
  hours: [],
};

const services = [
  { serviceId: 'svc-cut', name: 'Haircut', durationMinutes: 45 },
  { serviceId: '03d10f69-0e9b-408c-a827-6db63ef29765', name: 'Gel', durationMinutes: 30 },
];

const makeSlots = (startsAtList: string[]): AvailabilitySlot[] =>
  startsAtList.map((startsAt, index) => ({
    slotId: `slot-${index + 1}`,
    startsAt,
    endsAt: new Date(new Date(startsAt).getTime() + 30 * 60 * 1000).toISOString(),
    staffId: `staff-${index + 1}`,
    staffName: `Stylist ${index + 1}`,
  }));

const createTestAdapter = (availabilitySlots: AvailabilitySlot[] = makeSlots([
  '2026-07-21T16:00:00.000Z',
])): {
  adapter: BusinessAdapter;
  availabilityInputs: Array<Parameters<BusinessAdapter['findAvailability']>[0]>;
  bookingInputs: Array<Parameters<BusinessAdapter['createBooking']>[0]>;
} => {
  const availabilityInputs: Array<Parameters<BusinessAdapter['findAvailability']>[0]> = [];
  const bookingInputs: Array<Parameters<BusinessAdapter['createBooking']>[0]> = [];

  return {
    availabilityInputs,
    bookingInputs,
    adapter: {
      getBusinessProfile: vi.fn(async () => demoBusinessProfile),
      listServices: vi.fn(async () => services),
      listStaff: vi.fn(async () => []),
      findAvailability: vi.fn(async (input) => {
        availabilityInputs.push(input);
        return {
          slots: availabilitySlots,
          source: 'mock',
          expiresAt: '2026-07-21T00:00:00.000Z',
        };
      }),
      findOrCreateCustomer: vi.fn(async () => ({
        customerId: 'cust_1',
        fullName: 'Test Customer',
        phoneNumber: '+1 (555) 010-4242',
      })),
      createBooking: vi.fn(async (input) => {
        bookingInputs.push(input);
        return {
          bookingId: 'book_1',
          customerId: input.customerId,
          serviceId: input.serviceId,
          slotId: input.slotId,
          startsAt: input.startsAt,
          status: 'confirmed',
          summary: 'Demo Salon',
        };
      }),
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

  it('formats three UTC slots as a natural spoken response', async () => {
    const { adapter } = createTestAdapter(makeSlots([
      '2026-07-21T16:00:00.000Z',
      '2026-07-21T16:15:00.000Z',
      '2026-07-21T16:30:00.000Z',
    ]));
    const agent = createAgent(adapter);

    const result = await agent.handleTurn({
      text: 'Haircut tomorrow at 11am',
      businessId: 'demo-salon',
      channel: 'voice',
    });

    expect(result.message).toBe('I found three openings tomorrow: 11:00 AM, 11:15 AM, and 11:30 AM. Which one works best?');
    expect(result.message).not.toContain('2026-07-21T');
    expect(result.message).not.toContain('[redacted-phone]');
  });

  it('maps first one back to the first stored slot', async () => {
    const { adapter } = createTestAdapter(makeSlots([
      '2026-07-21T16:00:00.000Z',
      '2026-07-21T16:15:00.000Z',
    ]));
    const agent = createAgent(adapter);

    const firstTurn = await agent.handleTurn({
      text: 'Haircut tomorrow at 11am',
      businessId: 'demo-salon',
      channel: 'voice',
    });

    const secondTurn = await agent.handleTurn({
      text: 'the first one',
      businessId: 'demo-salon',
      state: firstTurn.state,
      channel: 'voice',
    });

    expect(secondTurn.state.selectedSlot?.slotId).toBe('slot-1');
    expect(secondTurn.state.selectedSlot?.startsAt).toBe('2026-07-21T16:00:00.000Z');
  });

  it('preserves the collected date and time until the service is selected', async () => {
    const { adapter, availabilityInputs } = createTestAdapter();
    const agent = createAgent(adapter);

    const firstTurn = await agent.handleTurn({
      text: 'tomorrow at 11am',
      businessId: 'demo-salon',
      channel: 'voice',
    });

    expect(firstTurn.state.preferredDate).toBe('2026-07-21');
    expect(firstTurn.state.preferredTimeRange).toBe('11am-12pm');
    expect(firstTurn.message).toContain('service');

    const secondTurn = await agent.handleTurn({
      text: 'Gel',
      businessId: 'demo-salon',
      state: firstTurn.state,
      channel: 'voice',
    });

    expect(secondTurn.state.serviceId).toBe('03d10f69-0e9b-408c-a827-6db63ef29765');
    expect(availabilityInputs).toHaveLength(1);
    expect(availabilityInputs[0]).toMatchObject({
      preferredDate: '2026-07-21',
      preferredTimeRange: '11am-12pm',
    });
  });

  it('keeps the exact slot and staff through booking confirmation', async () => {
    const { adapter, bookingInputs } = createTestAdapter(makeSlots([
      '2026-07-21T16:00:00.000Z',
      '2026-07-21T16:15:00.000Z',
      '2026-07-21T16:30:00.000Z',
    ]));
    const agent = createAgent(adapter);

    const firstTurn = await agent.handleTurn({
      text: 'Haircut tomorrow at 11am',
      businessId: 'demo-salon',
      channel: 'voice',
    });

    const secondTurn = await agent.handleTurn({
      text: 'first one',
      businessId: 'demo-salon',
      channel: 'voice',
      state: firstTurn.state,
    });
    expect(secondTurn.state.selectedSlot?.slotId).toBe('slot-1');

    const thirdTurn = await agent.handleTurn({
      text: 'my name is Alex Johnson',
      businessId: 'demo-salon',
      channel: 'voice',
      state: secondTurn.state,
    });

    const fourthTurn = await agent.handleTurn({
      text: '+1 (555) 010-4242',
      businessId: 'demo-salon',
      channel: 'voice',
      state: thirdTurn.state,
    });
    expect(fourthTurn.message).toContain('Just to confirm');
    expect(fourthTurn.message).toContain('11:00 AM');
    expect(fourthTurn.message).not.toContain('2026-07-21T16:00:00.000Z');

    const finalTurn = await agent.handleTurn({
      text: 'yes',
      businessId: 'demo-salon',
      channel: 'voice',
      state: { ...fourthTurn.state, callerTimezone: 'America/New_York' },
    });

    expect(finalTurn.message).toContain('Booked.');
    expect(finalTurn.message).toContain('your time');
    expect(bookingInputs).toHaveLength(1);
    expect(bookingInputs[0]).toMatchObject({
      slotId: 'slot-1',
      startsAt: '2026-07-21T16:00:00.000Z',
      staffId: 'staff-1',
    });
  });

  it('accepts a bare customer name instead of repeating the prompt', async () => {
    const { adapter } = createTestAdapter(makeSlots([
      '2026-07-21T16:00:00.000Z',
      '2026-07-21T16:15:00.000Z',
    ]));
    const agent = createAgent(adapter);

    const firstTurn = await agent.handleTurn({
      text: 'Haircut tomorrow at 11am',
      businessId: 'demo-salon',
      channel: 'voice',
    });

    const secondTurn = await agent.handleTurn({
      text: 'first one',
      businessId: 'demo-salon',
      channel: 'voice',
      state: firstTurn.state,
    });

    const thirdTurn = await agent.handleTurn({
      text: 'Abhi',
      businessId: 'demo-salon',
      channel: 'voice',
      state: secondTurn.state,
    });

    expect(thirdTurn.state.customerName).toBe('Abhi');
    expect(thirdTurn.message).toBe('What is the best phone number for confirmation?');
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
});
