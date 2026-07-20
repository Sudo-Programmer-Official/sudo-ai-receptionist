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
  const adapter = createLoggedSalonFlowAdapter(runtime, 'verify');
  const correlationId = createStableCorrelationId('verify');

  const businessProfile = await adapter.getBusinessProfile({
    businessId: runtime.businessId,
    correlationId,
  });
  console.log(JSON.stringify({
    event: 'salonflow_verify_business_profile',
    businessId: businessProfile.businessId,
    name: businessProfile.name,
    timezone: businessProfile.timezone,
  }));

  const services = await adapter.listServices({
    businessId: runtime.businessId,
    correlationId,
  });
  if (services.length === 0) {
    throw new Error('No active services returned by SalonFlow');
  }

  const staff = await adapter.listStaff({
    businessId: runtime.businessId,
    correlationId,
  });
  const preferredService = services[0];
  if (!preferredService) {
    throw new Error('No active service available');
  }

  const preferredDate = formatDateInTimeZone(new Date(Date.now() + 24 * 60 * 60 * 1000), businessProfile.timezone);
  const availability = await adapter.findAvailability({
    businessId: runtime.businessId,
    serviceId: preferredService.serviceId,
    preferredDate,
    limit: 3,
    correlationId,
  });

  console.log(JSON.stringify({
    event: 'salonflow_verify_summary',
    services: services.length,
    staff: staff.length,
    slots: availability.slots.length,
    serviceId: preferredService.serviceId,
    preferredDate,
  }));
};

main().catch((error) => {
  console.error(JSON.stringify({
    event: 'salonflow_verify_failed',
    error: error instanceof Error ? error.message : 'Unknown error',
  }));
  process.exitCode = 1;
});
