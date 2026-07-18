import type {
  AvailabilityResult,
  AvailabilitySlot,
  BookingRecord,
  BusinessAdapter,
  BusinessProfile,
  ConfirmationDeliveryResult,
  CustomerRecord,
  ServiceOffering
} from '@sudo-ai-receptionist/business-contracts';

const businessProfile: BusinessProfile = {
  businessId: 'demo-salon',
  name: 'Aurora Salon Studio',
  timezone: 'America/Denver',
  phone: '+1 (555) 010-2000',
  website: 'https://demo.example',
  policies: ['24 hour cancellation notice', 'Late arrivals may shorten the service'],
  hours: [
    { dayOfWeek: 1, open: '09:00', close: '18:00' },
    { dayOfWeek: 2, open: '09:00', close: '18:00' },
    { dayOfWeek: 3, open: '09:00', close: '18:00' },
    { dayOfWeek: 4, open: '09:00', close: '18:00' },
    { dayOfWeek: 5, open: '09:00', close: '18:00' }
  ]
};

const services: ServiceOffering[] = [
  { serviceId: 'svc-cut', name: 'Haircut', durationMinutes: 45, priceCents: 6500 },
  { serviceId: 'svc-color', name: 'Color Touch-Up', durationMinutes: 90, priceCents: 12000 },
  { serviceId: 'svc-blowout', name: 'Blowout', durationMinutes: 30, priceCents: 4500 }
];

const staff = [
  { staffId: 'stylist-1', name: 'Ava', services: ['svc-cut', 'svc-blowout'] },
  { staffId: 'stylist-2', name: 'Mia', services: ['svc-cut', 'svc-color'] },
  { staffId: 'stylist-3', name: 'Noah', services: ['svc-blowout'] }
];

export class MockBusinessAdapter implements BusinessAdapter {
  private readonly customers = new Map<string, CustomerRecord>();
  private readonly bookings = new Map<string, BookingRecord>();
  private readonly bookedSlotIds = new Set<string>();

  async getBusinessProfile(input: { businessId: string; correlationId: string; signal?: AbortSignal | undefined }): Promise<BusinessProfile> {
    return businessProfile;
  }

  async listServices(input: { businessId: string; correlationId: string; signal?: AbortSignal | undefined }): Promise<ServiceOffering[]> {
    return services;
  }

  async findAvailability(input: {
    businessId: string;
    serviceId: string;
    preferredDate: string;
    preferredTimeRange?: string;
    staffPreference?: string;
    limit: number;
    correlationId: string;
    signal?: AbortSignal;
  }): Promise<AvailabilityResult> {
    const matchingStaff = input.staffPreference
      ? staff.filter((member) => member.name.toLowerCase().includes(input.staffPreference!.toLowerCase()))
      : staff.filter((member) => member.services.includes(input.serviceId));
    const serviceRoster = staff.filter((member) => member.services.includes(input.serviceId));
    const roster = matchingStaff.length > 0 ? matchingStaff : serviceRoster.length > 0 ? serviceRoster : staff;
    const baseTimes = ['09:00', '11:00', '14:00', '16:00'];
    const slots: AvailabilitySlot[] = baseTimes
      .map((time, index) => ({
        slotId: `${input.preferredDate}-${input.serviceId}-${index + 1}`,
        startsAt: `${input.preferredDate}T${time}:00-07:00`,
        endsAt: `${input.preferredDate}T${String(Number(time.slice(0, 2)) + 1).padStart(2, '0')}:${time.slice(3)}:00-07:00`,
        staffId: roster[index % roster.length]?.staffId,
        staffName: roster[index % roster.length]?.name
      }))
      .filter((slot) => !this.bookedSlotIds.has(slot.slotId))
      .slice(0, input.limit);
    return {
      slots,
      source: 'mock',
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    };
  }

  async findOrCreateCustomer(input: {
    businessId: string;
    fullName: string;
    phoneNumber: string;
    email?: string;
    correlationId: string;
    signal?: AbortSignal;
  }): Promise<CustomerRecord> {
    const key = input.phoneNumber.replace(/\D/g, '');
    const existing = this.customers.get(key);
    if (existing) return existing;
    const record: CustomerRecord = {
      customerId: `cust_${key || Math.random().toString(36).slice(2, 8)}`,
      fullName: input.fullName,
      phoneNumber: input.phoneNumber,
      email: input.email
    };
    this.customers.set(key, record);
    return record;
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
    const existing = this.bookings.get(input.idempotencyKey);
    if (existing) return existing;
    if (this.bookedSlotIds.has(input.slotId)) {
      throw new Error('Duplicate booking attempt detected for selected slot.');
    }
    const booking: BookingRecord = {
      bookingId: `book_${Math.random().toString(36).slice(2, 10)}`,
      customerId: input.customerId,
      serviceId: input.serviceId,
      slotId: input.slotId,
      startsAt: input.startsAt,
      status: 'confirmed',
      externalReference: `mock-${input.idempotencyKey}`
    };
    this.bookedSlotIds.add(input.slotId);
    this.bookings.set(input.idempotencyKey, booking);
    return booking;
  }

  async sendConfirmation(): Promise<ConfirmationDeliveryResult> {
    return { delivered: true, providerMessageId: `msg_${Math.random().toString(36).slice(2, 10)}` };
  }
}
