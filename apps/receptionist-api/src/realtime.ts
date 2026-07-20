import type { BusinessAdapter } from '@sudo-ai-receptionist/business-contracts';
import { sanitizeErrorMessage } from '@sudo-ai-receptionist/shared';
import type { RealtimeBusinessContext } from '@sudo-ai-receptionist/realtime-runtime';

export const buildFallbackBusinessContext = (): RealtimeBusinessContext => ({
  businessName: 'Your salon',
  serviceNames: [],
  timeZone: 'unknown',
});

export const resolveRealtimeBusinessContext = async (
  input: {
    adapter: BusinessAdapter;
    businessId: string;
    correlationId: string;
    logger: { log: (level: 'debug' | 'info' | 'warn' | 'error', message: string, meta?: Record<string, unknown>) => void };
  }
): Promise<RealtimeBusinessContext> => {
  try {
    const businessProfile = await input.adapter.getBusinessProfile({
      businessId: input.businessId,
      correlationId: input.correlationId,
    });
    const services = await input.adapter.listServices({
      businessId: input.businessId,
      correlationId: input.correlationId,
    });
    const businessContext: RealtimeBusinessContext = {
      businessName: businessProfile.name,
      serviceNames: services.map((service) => service.name).filter(Boolean),
      timeZone: businessProfile.timezone,
    };
    const location = businessProfile.website ?? businessProfile.phone;
    if (location) {
      businessContext.location = location;
    }
    const bookingPolicy = businessProfile.policies.filter(Boolean).join(' ').trim();
    if (bookingPolicy) {
      businessContext.bookingPolicy = bookingPolicy;
    }
    return businessContext;
  } catch (error) {
    input.logger.log('warn', 'realtime business context lookup failed; using fallback', {
      businessId: input.businessId,
      correlationId: input.correlationId,
      detail: sanitizeErrorMessage(error),
    });
    return buildFallbackBusinessContext();
  }
};
