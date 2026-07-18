export type BookingChannel = 'web' | 'voice' | 'phone' | 'demo' | 'sms';

export interface BusinessProfile {
  businessId: string;
  name: string;
  timezone: string;
  phone?: string | undefined;
  website?: string | undefined;
  policies: string[];
  hours: Array<{
    dayOfWeek: number;
    open: string;
    close: string;
  }>;
}

export interface ServiceOffering {
  serviceId: string;
  name: string;
  description?: string | undefined;
  durationMinutes: number;
  priceCents?: number | undefined;
}

export interface StaffMember {
  staffId: string;
  name: string;
  services: string[];
}

export interface AvailabilityRequest {
  businessId: string;
  serviceId: string;
  preferredDate: string;
  preferredTimeRange?: string | undefined;
  staffPreference?: string | undefined;
  limit: number;
  correlationId: string;
  signal?: AbortSignal | undefined;
}

export interface AvailabilitySlot {
  slotId: string;
  startsAt: string;
  endsAt: string;
  staffId?: string | undefined;
  staffName?: string | undefined;
}

export interface AvailabilityResult {
  slots: AvailabilitySlot[];
  source: 'mock' | 'salonflow';
  expiresAt: string;
}

export interface CustomerRecord {
  customerId: string;
  fullName: string;
  phoneNumber: string;
  email?: string | undefined;
}

export interface BookingRequest {
  businessId: string;
  serviceId: string;
  customerId: string;
  slotId: string;
  startsAt: string;
  staffId?: string | undefined;
  notes?: string | undefined;
  idempotencyKey: string;
  correlationId: string;
  signal?: AbortSignal | undefined;
}

export interface BookingRecord {
  bookingId: string;
  customerId: string;
  serviceId: string;
  slotId: string;
  startsAt: string;
  status: 'confirmed' | 'pending' | 'failed';
  externalReference?: string | undefined;
}

export interface ConfirmationDeliveryRequest {
  businessId: string;
  bookingId: string;
  customerPhone: string;
  customerName: string;
  channel: BookingChannel;
  correlationId: string;
  signal?: AbortSignal | undefined;
}

export interface ConfirmationDeliveryResult {
  delivered: boolean;
  providerMessageId?: string;
}

export interface BusinessAdapter {
  getBusinessProfile(input: { businessId: string; correlationId: string; signal?: AbortSignal }): Promise<BusinessProfile>;
  listServices(input: { businessId: string; correlationId: string; signal?: AbortSignal }): Promise<ServiceOffering[]>;
  findAvailability(input: AvailabilityRequest): Promise<AvailabilityResult>;
  findOrCreateCustomer(input: {
    businessId: string;
    fullName: string;
    phoneNumber: string;
    email?: string;
    correlationId: string;
    signal?: AbortSignal;
  }): Promise<CustomerRecord>;
  createBooking(input: BookingRequest): Promise<BookingRecord>;
  sendConfirmation(input: ConfirmationDeliveryRequest): Promise<ConfirmationDeliveryResult>;
}

export class AdapterError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly status?: number | undefined;

  constructor(message: string, options: { code: string; retryable?: boolean; status?: number }) {
    super(message);
    this.name = 'AdapterError';
    this.code = options.code;
    this.retryable = options.retryable ?? false;
    if (options.status !== undefined) {
      this.status = options.status;
    }
  }
}
