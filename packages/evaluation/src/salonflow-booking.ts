import { createLoggedSalonFlowAdapter, createStableCorrelationId, loadSalonFlowRuntime } from './salonflow-runtime.js';

const formatDateInTimeZone = (date: Date, timeZone: string): string => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
};

const main = async (): Promise<void> => {
  const runtime = loadSalonFlowRuntime();
  const adapter = createLoggedSalonFlowAdapter(runtime, 'booking');
  const correlationId = createStableCorrelationId('booking');

  const businessProfile = await adapter.getBusinessProfile({
    businessId: runtime.businessId,
    correlationId,
  });
  const services = await adapter.listServices({
    businessId: runtime.businessId,
    correlationId,
  });
  const selectedService = services[0];
  if (!selectedService) {
    throw new Error('No active service returned by SalonFlow');
  }

  const preferredDate = formatDateInTimeZone(new Date(Date.now() + 24 * 60 * 60 * 1000), businessProfile.timezone);
  const availability = await adapter.findAvailability({
    businessId: runtime.businessId,
    serviceId: selectedService.serviceId,
    preferredDate,
    limit: 3,
    correlationId,
  });
  const slot = availability.slots[0];
  if (!slot) {
    throw new Error('No availability returned by SalonFlow');
  }

  const customer = await adapter.findOrCreateCustomer({
    businessId: runtime.businessId,
    fullName: 'Jordan Lee',
    phoneNumber: '+1 (555) 010-3333',
    email: 'jordan.lee@example.com',
    correlationId: createStableCorrelationId('customer'),
  });

  const idempotencyKey = `booking:${correlationId}:${slot.slotId}`;
  const booking = await adapter.createBooking({
    businessId: runtime.businessId,
    serviceId: selectedService.serviceId,
    customerId: customer.customerId,
    slotId: slot.slotId,
    startsAt: slot.startsAt,
    idempotencyKey,
    correlationId,
    ...(slot.staffId ? { staffId: slot.staffId } : {}),
  });

  const repeated = await adapter.createBooking({
    businessId: runtime.businessId,
    serviceId: selectedService.serviceId,
    customerId: customer.customerId,
    slotId: slot.slotId,
    startsAt: slot.startsAt,
    idempotencyKey,
    correlationId: createStableCorrelationId('booking-repeat'),
    ...(slot.staffId ? { staffId: slot.staffId } : {}),
  });

  if (booking.bookingId !== repeated.bookingId) {
    throw new Error('Idempotency check failed: duplicate booking was created');
  }

  console.log(JSON.stringify({
    event: 'salonflow_booking_demo_complete',
    bookingId: booking.bookingId,
    summary: booking.summary,
    serviceId: selectedService.serviceId,
    slotId: slot.slotId,
    preferredDate,
  }));
};

main().catch((error) => {
  console.error(JSON.stringify({
    event: 'salonflow_booking_demo_failed',
    error: error instanceof Error ? error.message : 'Unknown error',
  }));
  process.exitCode = 1;
});
