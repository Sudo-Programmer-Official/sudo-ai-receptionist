import type {
  AvailabilityRequest,
  AvailabilityResult,
  BookingRecord,
  BusinessAdapter,
  BusinessProfile,
  ConfirmationDeliveryRequest,
  ConfirmationDeliveryResult,
  CustomerRecord,
  ServiceOffering
} from '@sudo-ai-receptionist/business-contracts';
import { retry, withTimeout } from '@sudo-ai-receptionist/shared';

export interface SalonflowAdapterConfig {
  baseUrl: string;
  integrationToken: string;
  demoTenantId?: string;
  timeoutMs?: number;
}

export class SalonflowAdapterError extends Error {
  constructor(message: string, public readonly code: string, public readonly retryable: boolean, public readonly status?: number) {
    super(message);
    this.name = 'SalonflowAdapterError';
  }
}

export class SalonFlowAdapter implements BusinessAdapter {
  constructor(private readonly config: SalonflowAdapterConfig) {}

  private async request<T>(path: string, init: RequestInit, safeRead = false): Promise<T> {
    const timeoutMs = this.config.timeoutMs ?? 2000;
    const url = `${this.config.baseUrl.replace(/\/$/, '')}${path}`;
    const operation = async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs);
      try {
        const requestInit: RequestInit = {
          ...init,
          headers: {
            Authorization: `Bearer ${this.config.integrationToken}`,
            'Content-Type': 'application/json',
            ...(this.config.demoTenantId ? { 'X-Demo-Tenant-Id': this.config.demoTenantId } : {}),
            ...(init.headers ?? {})
          }
        };
        if (init.signal !== undefined) {
          requestInit.signal = init.signal;
        }
        const response = await fetch(url, {
          ...requestInit,
          signal: controller.signal
        });
        if (!response.ok) {
          const body = await response.text().catch(() => '');
          throw new SalonflowAdapterError(body || `SalonFlow request failed with ${response.status}`, `http_${response.status}`, response.status >= 500, response.status);
        }
        return (await response.json()) as T;
      } finally {
        clearTimeout(timeout);
      }
    };
    return safeRead
      ? retry(operation, { retries: 2, backoffMs: 120, shouldRetry: (error) => error instanceof SalonflowAdapterError ? error.retryable : true })
      : operation();
  }

  async getBusinessProfile(input: { businessId: string; correlationId: string; signal?: AbortSignal }): Promise<BusinessProfile> {
    return this.request(`/v1/businesses/${input.businessId}/profile`, { method: 'GET', ...(input.signal ? { signal: input.signal } : {}) }, true);
  }

  async listServices(input: { businessId: string; correlationId: string; signal?: AbortSignal }): Promise<ServiceOffering[]> {
    return this.request(`/v1/businesses/${input.businessId}/services`, { method: 'GET', ...(input.signal ? { signal: input.signal } : {}) }, true);
  }

  async findAvailability(input: AvailabilityRequest): Promise<AvailabilityResult> {
    return this.request(`/v1/businesses/${input.businessId}/availability`, {
      method: 'POST',
      ...(input.signal ? { signal: input.signal } : {}),
      body: JSON.stringify({
        serviceId: input.serviceId,
        preferredDate: input.preferredDate,
        preferredTimeRange: input.preferredTimeRange,
        staffPreference: input.staffPreference,
        limit: input.limit,
        correlationId: input.correlationId
      })
    }, true);
  }

  async findOrCreateCustomer(input: {
    businessId: string;
    fullName: string;
    phoneNumber: string;
    email?: string;
    correlationId: string;
    signal?: AbortSignal;
  }): Promise<CustomerRecord> {
    return this.request(`/v1/businesses/${input.businessId}/customers/resolve`, {
      method: 'POST',
      ...(input.signal ? { signal: input.signal } : {}),
      body: JSON.stringify(input)
    }, true);
  }

  async createBooking(input: {
    businessId: string;
    serviceId: string;
    customerId: string;
    slotId: string;
    startsAt: string;
    staffId?: string;
    notes?: string;
    idempotencyKey: string;
    correlationId: string;
    signal?: AbortSignal;
  }): Promise<BookingRecord> {
    return this.request(`/v1/businesses/${input.businessId}/bookings`, {
      method: 'POST',
      ...(input.signal ? { signal: input.signal } : {}),
      headers: { 'Idempotency-Key': input.idempotencyKey },
      body: JSON.stringify(input)
    });
  }

  async sendConfirmation(input: ConfirmationDeliveryRequest): Promise<ConfirmationDeliveryResult> {
    return this.request(`/v1/businesses/${input.businessId}/confirmations`, {
      method: 'POST',
      ...(input.signal ? { signal: input.signal } : {}),
      body: JSON.stringify(input)
    });
  }
}
