import { describe, expect, test } from 'vitest';
import { validateEnvironment } from '@sudo-ai-receptionist/shared';
import { SalonFlowAdapter } from '../src/index';

const requiredEnv = [
  'SALONFLOW_STAGING_BASE_URL',
  'SALONFLOW_STAGING_TOKEN',
  'SALONFLOW_STAGING_BUSINESS_ID',
  'SALONFLOW_STAGING_SERVICE_ID',
  'SALONFLOW_STAGING_PREFERRED_DATE',
];

const env = Object.fromEntries(requiredEnv.map((key) => [key, process.env[key]]));
const hasEnv = requiredEnv.every((key) => Boolean(process.env[key]));

const demoToken = process.env.SALONFLOW_STAGING_TOKEN ?? '';
const demoBaseUrl = process.env.SALONFLOW_STAGING_BASE_URL ?? '';
const demoBusinessId = process.env.SALONFLOW_STAGING_BUSINESS_ID ?? '';
const demoServiceId = process.env.SALONFLOW_STAGING_SERVICE_ID ?? '';
const demoDate = process.env.SALONFLOW_STAGING_PREFERRED_DATE ?? '';

const suite = hasEnv ? describe : describe.skip;

suite('SalonFlow staging adapter', () => {
  test('books a synthetic appointment idempotently', async () => {
    validateEnvironment(env, requiredEnv);

    const adapter = new SalonFlowAdapter({
      baseUrl: demoBaseUrl,
      integrationToken: demoToken,
      timeoutMs: 10_000,
    });

    const profile = await adapter.getBusinessProfile({
      businessId: demoBusinessId,
      correlationId: 'staging-test-profile',
    });
    expect(profile.businessId).toBe(demoBusinessId);

    const services = await adapter.listServices({
      businessId: demoBusinessId,
      correlationId: 'staging-test-services',
    });
    expect(services.length).toBeGreaterThan(0);

    const staff = await adapter.listStaff({
      businessId: demoBusinessId,
      correlationId: 'staging-test-staff',
    });
    expect(staff.length).toBeGreaterThan(0);

    const availability = await adapter.findAvailability({
      businessId: demoBusinessId,
      serviceId: demoServiceId,
      preferredDate: demoDate,
      limit: 3,
      correlationId: 'staging-test-availability',
    });
    expect(availability.slots.length).toBeGreaterThan(0);

    const customer = await adapter.findOrCreateCustomer({
      businessId: demoBusinessId,
      fullName: 'Codex Staging Customer',
      phoneNumber: '+1 (555) 010-4242',
      email: 'codex.staging@example.com',
      correlationId: 'staging-test-customer',
    });
    expect(customer.customerId).toBeTruthy();

    const slot = availability.slots[0];
    if (!slot) {
      throw new Error('Expected at least one availability slot');
    }

    const booking = await adapter.createBooking({
      businessId: demoBusinessId,
      serviceId: demoServiceId,
      customerId: customer.customerId,
      slotId: slot.slotId,
      startsAt: slot.startsAt,
      staffId: slot.staffId,
      idempotencyKey: 'staging-test-booking-key',
      correlationId: 'staging-test-booking',
    });
    expect(booking.bookingId).toBeTruthy();

    const repeated = await adapter.createBooking({
      businessId: demoBusinessId,
      serviceId: demoServiceId,
      customerId: customer.customerId,
      slotId: slot.slotId,
      startsAt: slot.startsAt,
      staffId: slot.staffId,
      idempotencyKey: 'staging-test-booking-key',
      correlationId: 'staging-test-booking-repeat',
    });
    expect(repeated.bookingId).toBe(booking.bookingId);
    expect(repeated.summary).toBe(booking.summary);

    const confirmation = await adapter.sendConfirmation({
      businessId: demoBusinessId,
      bookingId: booking.bookingId,
      customerPhone: customer.phoneNumber,
      customerName: customer.fullName,
      channel: 'demo',
      correlationId: 'staging-test-confirmation',
    });
    expect(confirmation.delivered).toBe(true);
  });
});
