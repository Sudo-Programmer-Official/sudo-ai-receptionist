import type { AvailabilitySlot, BusinessProfile, BookingRecord, ServiceOffering } from '@sudo-ai-receptionist/business-contracts';
import { isSupportedTimeZone } from '@sudo-ai-receptionist/shared';

export type ConversationChannel = 'web' | 'voice' | 'sms' | 'phone';
export type BookingConfirmationStatus = 'unconfirmed' | 'pending' | 'confirmed' | 'declined' | 'failed';

export interface ConversationState {
  conversationId: string;
  businessId: string;
  channel: ConversationChannel;
  timezone?: string | undefined;
  callerTimezone?: string | undefined;
  requestedService?: string | undefined;
  serviceId?: string | undefined;
  preferredDate?: string | undefined;
  preferredTimeRange?: string | undefined;
  staffPreference?: string | undefined;
  proposedSlots: AvailabilitySlot[];
  selectedSlot?: AvailabilitySlot | undefined;
  customerName?: string | undefined;
  customerPhone?: string | undefined;
  bookingConfirmationStatus: BookingConfirmationStatus;
  bookingId?: string | undefined;
  businessProfile?: BusinessProfile | undefined;
  services?: ServiceOffering[] | undefined;
  lastUserMessage?: string | undefined;
  lastAssistantMessage?: string | undefined;
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export const createConversationState = (input: Pick<ConversationState, 'conversationId' | 'businessId' | 'channel'>): ConversationState => ({
  conversationId: input.conversationId,
  businessId: input.businessId,
  channel: input.channel,
  proposedSlots: [],
  bookingConfirmationStatus: 'unconfirmed'
});

export const validateConversationState = (value: unknown): ConversationState => {
  if (!value || typeof value !== 'object') {
    throw new ValidationError('Conversation state must be an object.');
  }
  const state = value as Partial<ConversationState>;
  if (typeof state.conversationId !== 'string' || !state.conversationId) throw new ValidationError('Missing conversationId.');
  if (typeof state.businessId !== 'string' || !state.businessId) throw new ValidationError('Missing businessId.');
  if (!['web', 'voice', 'sms', 'phone'].includes(String(state.channel))) throw new ValidationError('Invalid channel.');
  if (!Array.isArray(state.proposedSlots)) throw new ValidationError('proposedSlots must be an array.');
  if (!['unconfirmed', 'pending', 'confirmed', 'declined', 'failed'].includes(String(state.bookingConfirmationStatus))) {
    throw new ValidationError('Invalid bookingConfirmationStatus.');
  }
  const validated: ConversationState = {
    conversationId: state.conversationId,
    businessId: state.businessId,
    channel: state.channel as ConversationChannel,
    proposedSlots: state.proposedSlots as AvailabilitySlot[],
    bookingConfirmationStatus: state.bookingConfirmationStatus as BookingConfirmationStatus
  };
  if (state.timezone !== undefined) {
    if (!isSupportedTimeZone(state.timezone)) {
      throw new ValidationError('Invalid timezone.');
    }
    validated.timezone = state.timezone;
  }
  if (state.callerTimezone !== undefined) {
    if (!isSupportedTimeZone(state.callerTimezone)) {
      throw new ValidationError('Invalid callerTimezone.');
    }
    validated.callerTimezone = state.callerTimezone;
  }
  if (state.requestedService !== undefined) validated.requestedService = state.requestedService;
  if (state.serviceId !== undefined) validated.serviceId = state.serviceId;
  if (state.preferredDate !== undefined) validated.preferredDate = state.preferredDate;
  if (state.preferredTimeRange !== undefined) validated.preferredTimeRange = state.preferredTimeRange;
  if (state.staffPreference !== undefined) validated.staffPreference = state.staffPreference;
  if (state.selectedSlot !== undefined) validated.selectedSlot = state.selectedSlot;
  if (state.customerName !== undefined) validated.customerName = state.customerName;
  if (state.customerPhone !== undefined) validated.customerPhone = state.customerPhone;
  if (state.bookingId !== undefined) validated.bookingId = state.bookingId;
  if (state.businessProfile !== undefined) validated.businessProfile = state.businessProfile;
  if (state.services !== undefined) validated.services = state.services;
  if (state.lastUserMessage !== undefined) validated.lastUserMessage = state.lastUserMessage;
  if (state.lastAssistantMessage !== undefined) validated.lastAssistantMessage = state.lastAssistantMessage;
  return validated;
};

export const applyAssistantUpdate = (state: ConversationState, patch: Partial<ConversationState>): ConversationState => {
  const next = { ...state, ...patch };
  return validateConversationState(next);
};

export const isBookingReady = (state: ConversationState): boolean => {
  return Boolean(
    state.serviceId &&
    state.preferredDate &&
    state.proposedSlots.length > 0 &&
    state.customerName &&
    state.customerPhone &&
    state.bookingConfirmationStatus === 'pending'
  );
};

export const summarizeBooking = (state: ConversationState): string => {
  const slot = state.selectedSlot ?? state.proposedSlots[0];
  return [
    state.businessProfile?.name ?? 'the business',
    state.requestedService ?? 'requested service',
    slot?.startsAt ?? 'an available time',
    state.customerName ?? 'the customer'
  ].join(' | ');
};
