import type {
  AvailabilityRequest,
  AvailabilityDiagnostics,
  AvailabilityResult,
  BookingRecord,
  BusinessAdapter,
  BusinessProfile,
  ConfirmationDeliveryRequest,
  ConfirmationDeliveryResult,
  CustomerRecord,
  StaffMember,
  ServiceOffering,
} from '@sudo-ai-receptionist/business-contracts';
import { createCorrelationId, retry } from '@sudo-ai-receptionist/shared';

export interface SalonflowAdapterConfig {
  baseUrl: string;
  integrationToken: string;
  timeoutMs?: number;
  observer?: (event: {
    method: string;
    path: string;
    correlationId: string;
    status: number;
    latencyMs: number;
    retryable: boolean;
    errorCode?: string;
  }) => void;
}

type RequestBody = Record<string, unknown>;

type JsonObject = Record<string, unknown>;

type ErrorResponse = {
  error?: string;
  correlationId?: string;
};

const isRecord = (value: unknown): value is JsonObject =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const isString = (value: unknown): value is string => typeof value === 'string';

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

const optionalString = (value: unknown): string | undefined => (isString(value) && value.trim() ? value : undefined);

const ensure = (condition: boolean, message: string): void => {
  if (!condition) {
    throw new Error(message);
  }
};

const assertRecord = (value: unknown, message: string): JsonObject => {
  ensure(isRecord(value), message);
  return value as JsonObject;
};

const parseErrorMessage = (payload: unknown, fallback: string): string => {
  if (isRecord(payload) && isString(payload.error) && payload.error.trim()) {
    return payload.error;
  }
  return fallback;
};

const maskPhone = (phone: string): string => phone.replace(/\d(?=\d{2})/g, '•');

const toHeaders = (config: SalonflowAdapterConfig, correlationId: string, extra?: HeadersInit): HeadersInit => ({
  Authorization: `Bearer ${config.integrationToken}`,
  'Content-Type': 'application/json',
  'x-correlation-id': correlationId,
  ...(extra ?? {}),
});

const parseBusinessProfile = (value: unknown): BusinessProfile => {
  const obj = assertRecord(value, 'Invalid business profile payload');
  const policies = obj.policies;
  const hours = obj.hours;
  ensure(isString(obj.businessId), 'Invalid business profile payload: businessId');
  ensure(isString(obj.name), 'Invalid business profile payload: name');
  ensure(isString(obj.timezone), 'Invalid business profile payload: timezone');
  ensure(Array.isArray(policies), 'Invalid business profile payload: policies');
  ensure(Array.isArray(hours), 'Invalid business profile payload: hours');

  return {
    businessId: obj.businessId as string,
    name: obj.name as string,
    timezone: obj.timezone as string,
    phone: optionalString(obj.phone),
    website: optionalString(obj.website),
    policies: (policies as unknown[]).map((item: unknown) => {
      ensure(isString(item), 'Invalid business profile payload: policy');
      return item as string;
    }),
    hours: (hours as unknown[]).map((entry: unknown) => {
      ensure(isRecord(entry), 'Invalid business profile payload: hours entry');
      const hour = entry as JsonObject;
      ensure(isNumber(hour.dayOfWeek), 'Invalid business profile payload: dayOfWeek');
      ensure(isString(hour.open), 'Invalid business profile payload: open');
      ensure(isString(hour.close), 'Invalid business profile payload: close');
      return {
        dayOfWeek: hour.dayOfWeek as number,
        open: hour.open as string,
        close: hour.close as string,
      };
    }),
  };
};

const parseServices = (value: unknown): ServiceOffering[] => {
  const items = isRecord(value) && Array.isArray(value.services) ? value.services : value;
  ensure(Array.isArray(items), 'Invalid services payload');
  return (items as unknown[]).map((item: unknown) => {
    ensure(isRecord(item), 'Invalid service payload');
    const service = item as JsonObject;
    ensure(isString(service.serviceId), 'Invalid service payload: serviceId');
    ensure(isString(service.name), 'Invalid service payload: name');
    ensure(isNumber(service.durationMinutes), 'Invalid service payload: durationMinutes');
    return {
      serviceId: service.serviceId as string,
      name: service.name as string,
      description: optionalString(service.description),
      durationMinutes: service.durationMinutes as number,
      priceCents: isNumber(service.priceCents) ? service.priceCents : undefined,
    };
  });
};

const parseStaff = (value: unknown): StaffMember[] => {
  const items = isRecord(value) && Array.isArray(value.staff) ? value.staff : value;
  ensure(Array.isArray(items), 'Invalid staff payload');
  return (items as unknown[]).map((item: unknown) => {
    ensure(isRecord(item), 'Invalid staff payload');
    const member = item as JsonObject;
    ensure(isString(member.staffId), 'Invalid staff payload: staffId');
    ensure(isString(member.name), 'Invalid staff payload: name');
    ensure(Array.isArray(member.services), 'Invalid staff payload: services');
    return {
      staffId: member.staffId as string,
      name: member.name as string,
      services: (member.services as unknown[]).map((service: unknown) => {
        ensure(isString(service), 'Invalid staff payload: service');
        return service as string;
      }),
    };
  });
};

const parseAvailability = (value: unknown): AvailabilityResult => {
  const obj = assertRecord(value, 'Invalid availability payload');
  const slots = obj.slots;
  ensure(Array.isArray(slots), 'Invalid availability payload: slots');
  ensure(isString(obj.source), 'Invalid availability payload: source');
  ensure(isString(obj.expiresAt), 'Invalid availability payload: expiresAt');

  const diagnosticsSource = isRecord(obj.diagnostics) ? obj.diagnostics : obj;
  const diagnostics = parseAvailabilityDiagnostics(diagnosticsSource, (slots as unknown[]).length);

  const result: AvailabilityResult = {
    slots: (slots as unknown[]).map((slot: unknown) => {
      ensure(isRecord(slot), 'Invalid availability slot payload');
      const slotRecord = slot as JsonObject;
      ensure(isString(slotRecord.slotId), 'Invalid availability slot payload: slotId');
      ensure(isString(slotRecord.startsAt), 'Invalid availability slot payload: startsAt');
      ensure(isString(slotRecord.endsAt), 'Invalid availability slot payload: endsAt');
      return {
        slotId: slotRecord.slotId as string,
        startsAt: slotRecord.startsAt as string,
        endsAt: slotRecord.endsAt as string,
        staffId: optionalString(slotRecord.staffId),
        staffName: optionalString(slotRecord.staffName),
      };
    }),
    source: 'salonflow',
    expiresAt: obj.expiresAt as string,
  };

  if (diagnostics) {
    result.diagnostics = diagnostics;
  }

  return result;
};

const parseAvailabilityDiagnostics = (value: JsonObject, finalSlotsReturned: number): AvailabilityDiagnostics | undefined => {
  const diagnostics: AvailabilityDiagnostics = {};
  const businessTimezone = optionalString(value.businessTimezone ?? value.timeZone ?? value.timezone);
  const preferredDate = optionalString(value.preferredDate);
  const preferredTimeRange = optionalString(value.preferredTimeRange);
  const serviceId = optionalString(value.serviceId);
  const serviceDurationMinutes = isNumber(value.serviceDurationMinutes) ? value.serviceDurationMinutes : isNumber(value.durationMinutes) ? value.durationMinutes : undefined;
  const activeStaffConsidered = isNumber(value.activeStaffConsidered) ? value.activeStaffConsidered : isNumber(value.activeStaffCount) ? value.activeStaffCount : undefined;
  const staffAssignedToService = isNumber(value.staffAssignedToService) ? value.staffAssignedToService : isNumber(value.serviceStaffCount) ? value.serviceStaffCount : undefined;
  const businessHoursFound = isNumber(value.businessHoursFound) ? value.businessHoursFound : isNumber(value.businessHoursCount) ? value.businessHoursCount : undefined;
  const staffWorkingWindowsFound = isNumber(value.staffWorkingWindowsFound) ? value.staffWorkingWindowsFound : undefined;
  const blockedIntervalsFound = isNumber(value.blockedIntervalsFound) ? value.blockedIntervalsFound : undefined;
  const candidateSlotsGenerated = isNumber(value.candidateSlotsGenerated) ? value.candidateSlotsGenerated : isNumber(value.candidateSlotsBeforeFiltering) ? value.candidateSlotsBeforeFiltering : undefined;

  if (businessTimezone) diagnostics.businessTimezone = businessTimezone;
  if (preferredDate) diagnostics.preferredDate = preferredDate;
  if (preferredTimeRange) diagnostics.preferredTimeRange = preferredTimeRange;
  if (serviceId) diagnostics.serviceId = serviceId;
  if (serviceDurationMinutes !== undefined) diagnostics.serviceDurationMinutes = serviceDurationMinutes;
  if (activeStaffConsidered !== undefined) diagnostics.activeStaffConsidered = activeStaffConsidered;
  if (staffAssignedToService !== undefined) diagnostics.staffAssignedToService = staffAssignedToService;
  if (businessHoursFound !== undefined) diagnostics.businessHoursFound = businessHoursFound;
  if (staffWorkingWindowsFound !== undefined) diagnostics.staffWorkingWindowsFound = staffWorkingWindowsFound;
  if (blockedIntervalsFound !== undefined) diagnostics.blockedIntervalsFound = blockedIntervalsFound;
  if (candidateSlotsGenerated !== undefined) diagnostics.candidateSlotsGenerated = candidateSlotsGenerated;
  if (finalSlotsReturned >= 0) diagnostics.finalSlotsReturned = finalSlotsReturned;

  return Object.keys(diagnostics).length > 0 ? diagnostics : undefined;
};

const parseCustomer = (value: unknown): CustomerRecord => {
  const obj = assertRecord(value, 'Invalid customer payload');
  ensure(isString(obj.customerId), 'Invalid customer payload: customerId');
  ensure(isString(obj.fullName), 'Invalid customer payload: fullName');
  ensure(isString(obj.phoneNumber), 'Invalid customer payload: phoneNumber');
  return {
    customerId: obj.customerId as string,
    fullName: obj.fullName as string,
    phoneNumber: obj.phoneNumber as string,
    email: optionalString(obj.email),
  };
};

const parseBooking = (value: unknown): BookingRecord => {
  const obj = assertRecord(value, 'Invalid booking payload');
  ensure(isString(obj.bookingId), 'Invalid booking payload: bookingId');
  ensure(isString(obj.customerId), 'Invalid booking payload: customerId');
  ensure(isString(obj.serviceId), 'Invalid booking payload: serviceId');
  ensure(isString(obj.slotId), 'Invalid booking payload: slotId');
  ensure(isString(obj.startsAt), 'Invalid booking payload: startsAt');
  ensure(isString(obj.status), 'Invalid booking payload: status');
  ensure(isString(obj.summary), 'Invalid booking payload: summary');

  const status = obj.status as BookingRecord['status'];
  ensure(status === 'confirmed' || status === 'pending' || status === 'failed', 'Invalid booking status');

  return {
    bookingId: obj.bookingId as string,
    customerId: obj.customerId as string,
    serviceId: obj.serviceId as string,
    slotId: obj.slotId as string,
    startsAt: obj.startsAt as string,
    status,
    summary: obj.summary as string,
    externalReference: optionalString(obj.externalReference),
  };
};

const parseConfirmation = (value: unknown): ConfirmationDeliveryResult => {
  const obj = assertRecord(value, 'Invalid confirmation payload');
  ensure(typeof obj.delivered === 'boolean', 'Invalid confirmation payload: delivered');
  const result: ConfirmationDeliveryResult = {
    delivered: obj.delivered as boolean,
  };
  const providerMessageId = optionalString(obj.providerMessageId);
  if (providerMessageId) {
    result.providerMessageId = providerMessageId;
  }
  return result;
};

export class SalonflowAdapterError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly retryable: boolean,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'SalonflowAdapterError';
  }
}

export class SalonFlowAdapter implements BusinessAdapter {
  constructor(private readonly config: SalonflowAdapterConfig) {}

  private async requestJson<T>(options: {
    method: string;
    path: string;
    correlationId: string;
    retryable: boolean;
    signal?: AbortSignal | undefined;
    body?: RequestBody | undefined;
    idempotencyKey?: string | undefined;
    validate: (value: unknown) => T;
  }): Promise<T> {
    const timeoutMs = this.config.timeoutMs ?? 5000;
    const url = `${this.config.baseUrl.replace(/\/$/, '')}${options.path}`;
    const operation = async (): Promise<T> => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);
      const onAbort = () => controller.abort(options.signal?.reason ?? new Error('Aborted'));
      options.signal?.addEventListener('abort', onAbort, { once: true });

      const started = Date.now();
      try {
        const requestInit: RequestInit = {
          method: options.method,
          headers: toHeaders(
            this.config,
            options.correlationId,
            options.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : undefined,
          ),
          signal: controller.signal,
        };
        if (options.body !== undefined) {
          requestInit.body = JSON.stringify(options.body);
        }

        const response = await fetch(url, requestInit);
        const raw = await response.text();
        const payload = raw ? (JSON.parse(raw) as unknown) : undefined;

        if (!response.ok) {
          const errorMessage = parseErrorMessage(payload, `SalonFlow request failed with ${response.status}`);
          this.config.observer?.({
            method: options.method,
            path: options.path,
            correlationId: options.correlationId,
            status: response.status,
            latencyMs: Date.now() - started,
            retryable: response.status >= 500,
            errorCode: `http_${response.status}`,
          });
          throw new SalonflowAdapterError(
            errorMessage,
            `http_${response.status}`,
            response.status >= 500,
            response.status,
          );
        }

        const value = options.validate(payload);
        this.config.observer?.({
          method: options.method,
          path: options.path,
          correlationId: options.correlationId,
          status: response.status,
          latencyMs: Date.now() - started,
          retryable: false,
        });
        return value;
      } catch (error) {
        const adapterError =
          error instanceof SalonflowAdapterError
            ? error
            : new SalonflowAdapterError(
                error instanceof Error ? error.message : 'Unknown SalonFlow error',
                'network_error',
                true,
              );
        this.config.observer?.({
          method: options.method,
          path: options.path,
          correlationId: options.correlationId,
          status: adapterError.status ?? 0,
          latencyMs: Date.now() - started,
          retryable: adapterError.retryable,
          errorCode: adapterError.code,
        });
        throw adapterError;
      } finally {
        clearTimeout(timeout);
        options.signal?.removeEventListener('abort', onAbort);
      }
    };

    if (options.retryable) {
      return retry(operation, {
        retries: 2,
        backoffMs: 150,
        shouldRetry: (error) => error instanceof SalonflowAdapterError && error.retryable,
      });
    }

    return operation();
  }

  async getBusinessProfile(input: { businessId: string; correlationId: string; signal?: AbortSignal }): Promise<BusinessProfile> {
    ensure(Boolean(input.businessId), 'businessId is required');
    return this.requestJson({
      method: 'GET',
      path: `/api/integrations/receptionist/${input.businessId}/business-profile`,
      correlationId: input.correlationId || createCorrelationId(),
      signal: input.signal,
      retryable: true,
      validate: parseBusinessProfile,
    });
  }

  async listServices(input: { businessId: string; correlationId: string; signal?: AbortSignal }): Promise<ServiceOffering[]> {
    ensure(Boolean(input.businessId), 'businessId is required');
    const services = await this.requestJson({
      method: 'GET',
      path: `/api/integrations/receptionist/${input.businessId}/services`,
      correlationId: input.correlationId || createCorrelationId(),
      signal: input.signal,
      retryable: true,
      validate: parseServices,
    });
    return services;
  }

  async listStaff(input: { businessId: string; correlationId: string; signal?: AbortSignal }): Promise<StaffMember[]> {
    ensure(Boolean(input.businessId), 'businessId is required');
    return this.requestJson({
      method: 'GET',
      path: `/api/integrations/receptionist/${input.businessId}/staff`,
      correlationId: input.correlationId || createCorrelationId(),
      signal: input.signal,
      retryable: true,
      validate: parseStaff,
    });
  }

  async findAvailability(input: AvailabilityRequest): Promise<AvailabilityResult> {
    ensure(Boolean(input.businessId), 'businessId is required');
    ensure(Boolean(input.serviceId), 'serviceId is required');
    ensure(Boolean(input.preferredDate), 'preferredDate is required');
    const limit = Math.min(Math.max(input.limit, 1), 3);
    return this.requestJson({
      method: 'POST',
      path: `/api/integrations/receptionist/${input.businessId}/availability`,
      correlationId: input.correlationId || createCorrelationId(),
      signal: input.signal,
      retryable: true,
      body: {
        serviceId: input.serviceId,
        preferredDate: input.preferredDate,
        preferredTimeRange: input.preferredTimeRange,
        limit,
      },
      validate: parseAvailability,
    });
  }

  async findOrCreateCustomer(input: {
    businessId: string;
    fullName: string;
    phoneNumber: string;
    email?: string;
    correlationId: string;
    signal?: AbortSignal;
  }): Promise<CustomerRecord> {
    ensure(Boolean(input.businessId), 'businessId is required');
    ensure(Boolean(input.fullName), 'fullName is required');
    ensure(Boolean(input.phoneNumber), 'phoneNumber is required');
    const correlationId = input.correlationId || createCorrelationId();
    const idempotencyKey = `${correlationId}:customer:${input.phoneNumber.replace(/\D/g, '')}`;
    const maskedPhone = maskPhone(input.phoneNumber);
    console.log(JSON.stringify({
      event: 'salonflow_customer_resolve_start',
      businessId: input.businessId,
      correlationId,
      phoneNumber: maskedPhone,
    }));

    return this.requestJson({
      method: 'POST',
      path: `/api/integrations/receptionist/${input.businessId}/customers/resolve`,
      correlationId,
      signal: input.signal,
      idempotencyKey,
      retryable: false,
      body: {
        fullName: input.fullName,
        phoneNumber: input.phoneNumber,
        email: input.email,
        idempotencyKey,
      },
      validate: parseCustomer,
    });
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
    ensure(Boolean(input.businessId), 'businessId is required');
    ensure(Boolean(input.serviceId), 'serviceId is required');
    ensure(Boolean(input.customerId), 'customerId is required');
    ensure(Boolean(input.slotId), 'slotId is required');
    ensure(Boolean(input.startsAt), 'startsAt is required');
    ensure(Boolean(input.idempotencyKey), 'idempotencyKey is required');
    return this.requestJson({
      method: 'POST',
      path: `/api/integrations/receptionist/${input.businessId}/bookings`,
      correlationId: input.correlationId || createCorrelationId(),
      signal: input.signal,
      retryable: false,
      idempotencyKey: input.idempotencyKey,
      body: {
        serviceId: input.serviceId,
        customerId: input.customerId,
        slotId: input.slotId,
        startsAt: input.startsAt,
        staffId: input.staffId,
        notes: input.notes,
        idempotencyKey: input.idempotencyKey,
      },
      validate: parseBooking,
    });
  }

  async sendConfirmation(input: ConfirmationDeliveryRequest): Promise<ConfirmationDeliveryResult> {
    ensure(Boolean(input.businessId), 'businessId is required');
    ensure(Boolean(input.bookingId), 'bookingId is required');
    ensure(Boolean(input.customerPhone), 'customerPhone is required');
    ensure(Boolean(input.customerName), 'customerName is required');
    const correlationId = input.correlationId || createCorrelationId();
    return this.requestJson({
      method: 'POST',
      path: `/api/integrations/receptionist/${input.businessId}/confirmations`,
      correlationId,
      signal: input.signal,
      retryable: false,
      body: {
        bookingId: input.bookingId,
        customerPhone: input.customerPhone,
        customerName: input.customerName,
        channel: input.channel,
      },
      validate: parseConfirmation,
    });
  }
}
