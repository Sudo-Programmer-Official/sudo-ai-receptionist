import type {
  BookingRecord,
  BusinessAdapter,
  BusinessProfile,
  ServiceOffering
} from '@sudo-ai-receptionist/business-contracts';
import {
  applyAssistantUpdate,
  createConversationState,
  type ConversationState,
  type BookingConfirmationStatus
} from '@sudo-ai-receptionist/conversation-state';
import { createCorrelationId } from '@sudo-ai-receptionist/shared';

export interface AgentTurnInput {
  text: string;
  state?: ConversationState;
  businessId: string;
  channel?: 'web' | 'voice' | 'sms' | 'phone';
  correlationId?: string;
  interrupted?: boolean;
}

export interface AgentTurnResult {
  message: string;
  state: ConversationState;
  toolStatus: Array<{ name: string; status: 'pending' | 'ok' | 'error'; latencyMs?: number }>;
  requiresUserAction: boolean;
}

const normalize = (value: string): string => value.trim().toLowerCase();

const findService = (services: ServiceOffering[], text: string): ServiceOffering | undefined => {
  const normalized = normalize(text);
  return services.find((service) => normalized.includes(normalize(service.name)) || normalized.includes(normalize(service.serviceId)));
};

const extractPhone = (text: string): string | undefined => {
  const match = text.match(/(\+?\d[\d\s().-]{6,}\d)/);
  return match?.[1]?.replace(/\s+/g, ' ').trim();
};

const extractName = (text: string): string | undefined => {
  const match = text.match(/(?:i'?m|my name is|this is)\s+([a-z]+(?:\s+[a-z]+){0,2})/i);
  return match?.[1]?.trim();
};

const extractDatePhrase = (text: string): string | undefined => {
  const match = text.match(/\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{4}-\d{2}-\d{2})\b/i);
  return match?.[1];
};

const extractSlotChoice = (text: string): number | undefined => {
  const ordinal = text.match(/\b(1|2|3)\b/);
  if (ordinal) return Number(ordinal[1]);
  const words: Record<string, number> = { first: 1, second: 2, third: 3 };
  for (const [word, index] of Object.entries(words)) {
    if (new RegExp(`\\b${word}\\b`, 'i').test(text)) return index;
  }
  return undefined;
};

const wantsConfirmation = (text: string): boolean => /\b(yes|confirm|sounds good|book it|please do it)\b/i.test(text);
const declinesConfirmation = (text: string): boolean => /\b(no|not now|change|cancel|different time)\b/i.test(text);

export class ReceptionistAgent {
  constructor(private readonly adapter: BusinessAdapter) {}

  async handleTurn(input: AgentTurnInput): Promise<AgentTurnResult> {
    const correlationId = input.correlationId ?? createCorrelationId();
    const state = input.state ?? createConversationState({
      conversationId: correlationId,
      businessId: input.businessId,
      channel: input.channel ?? 'web'
    });

    if (input.interrupted) {
      return {
        message: 'One moment, I’ll adjust that.',
        state,
        toolStatus: [],
        requiresUserAction: false
      };
    }

    const trimmed = input.text.trim();
    const lower = normalize(trimmed);
    let nextState = applyAssistantUpdate(state, { lastUserMessage: trimmed });
    const toolStatus: AgentTurnResult['toolStatus'] = [];

    if (!nextState.businessProfile) {
      const businessProfile: BusinessProfile = await this.adapter.getBusinessProfile({ businessId: input.businessId, correlationId });
      nextState = applyAssistantUpdate(nextState, { businessProfile });
    }

    if (!nextState.services) {
      const services = await this.adapter.listServices({ businessId: input.businessId, correlationId });
      nextState = applyAssistantUpdate(nextState, { services });
    }

    const services = nextState.services ?? [];
    const serviceMatch = findService(services, trimmed);
    if (serviceMatch && !nextState.serviceId) {
      nextState = applyAssistantUpdate(nextState, {
        requestedService: serviceMatch.name,
        serviceId: serviceMatch.serviceId
      });
    }

    if (!nextState.serviceId && !serviceMatch && /appointment|service|cut|color|style|wash|blowout|trim|hair|beard/i.test(lower)) {
      return {
        message: `Which service would you like from the menu: ${services.slice(0, 3).map((service) => service.name).join(', ')}?`,
        state: nextState,
        toolStatus,
        requiresUserAction: true
      };
    }

    if (!nextState.preferredDate) {
      const date = extractDatePhrase(trimmed);
      if (date) {
        nextState = applyAssistantUpdate(nextState, { preferredDate: date, preferredTimeRange: trimmed });
      } else {
        return {
          message: 'What day and time would you prefer?',
          state: nextState,
          toolStatus,
          requiresUserAction: true
        };
      }
    }

    if (nextState.serviceId && nextState.proposedSlots.length === 0) {
      const availability = await this.adapter.findAvailability({
        businessId: input.businessId,
        serviceId: nextState.serviceId,
        preferredDate: nextState.preferredDate ?? '',
        preferredTimeRange: nextState.preferredTimeRange,
        staffPreference: nextState.staffPreference,
        limit: 3,
        correlationId
      });
      toolStatus.push({ name: 'findAvailability', status: 'ok' });
      nextState = applyAssistantUpdate(nextState, { proposedSlots: availability.slots });
      if (availability.slots.length === 0) {
        return {
          message: `I could not find open times for ${nextState.requestedService ?? 'that service'} on ${nextState.preferredDate}. Would you like a different time or should I offer human follow-up?`,
          state: nextState,
          toolStatus,
          requiresUserAction: true
        };
      }
      const slotSummary = availability.slots.slice(0, 3).map((slot, index) => `${index + 1}. ${slot.startsAt}`).join(' ');
      return {
        message: `I found these options: ${slotSummary}. Which one works best?`,
        state: nextState,
        toolStatus,
        requiresUserAction: true
      };
    }

    if (nextState.proposedSlots.length > 0 && !nextState.selectedSlot) {
      const selectedIndex = extractSlotChoice(trimmed);
      if (selectedIndex && nextState.proposedSlots[selectedIndex - 1]) {
        nextState = applyAssistantUpdate(nextState, {
          selectedSlot: nextState.proposedSlots[selectedIndex - 1]
        });
      } else if (/\b(9|10|11|12|1|2|3|4|5|6|7|8)\b/.test(lower) && /am|pm|:/.test(lower)) {
        const chosen = nextState.proposedSlots.find((slot) => lower.includes(slot.startsAt.slice(11, 16)));
        if (chosen) {
          nextState = applyAssistantUpdate(nextState, { selectedSlot: chosen });
        }
      }
      if (!nextState.selectedSlot) {
        return {
          message: `Please choose one of the available times first: ${nextState.proposedSlots.slice(0, 3).map((slot, index) => `${index + 1}. ${slot.startsAt}`).join(' ')}.`,
          state: nextState,
          toolStatus,
          requiresUserAction: true
        };
      }
    }

    if (nextState.proposedSlots.length > 0 && !nextState.customerName) {
      const name = extractName(trimmed);
      if (name) {
        nextState = applyAssistantUpdate(nextState, { customerName: name });
      } else {
        return {
          message: 'What name should I put on the appointment?',
          state: nextState,
          toolStatus,
          requiresUserAction: true
        };
      }
    }

    if (nextState.customerName && !nextState.customerPhone) {
      const phone = extractPhone(trimmed);
      if (phone) {
        nextState = applyAssistantUpdate(nextState, { customerPhone: phone });
      } else {
        return {
          message: 'What is the best phone number for confirmation?',
          state: nextState,
          toolStatus,
          requiresUserAction: true
        };
      }
    }

    if (nextState.customerName && nextState.customerPhone && nextState.proposedSlots.length > 0 && nextState.bookingConfirmationStatus === 'unconfirmed') {
      nextState = applyAssistantUpdate(nextState, { bookingConfirmationStatus: 'pending' });
      const slot = nextState.selectedSlot ?? nextState.proposedSlots[0];
      if (!slot) {
        return {
          message: 'I lost the selected time. Please choose a slot again.',
          state: applyAssistantUpdate(nextState, { bookingConfirmationStatus: 'failed' }),
          toolStatus,
          requiresUserAction: true
        };
      }
      return {
        message: `I have ${nextState.requestedService ?? 'the service'} for ${nextState.customerName} at ${slot.startsAt}. Should I confirm this booking?`,
        state: nextState,
        toolStatus,
        requiresUserAction: true
      };
    }

    if (nextState.bookingConfirmationStatus === 'pending' && wantsConfirmation(lower)) {
      const customer = await this.adapter.findOrCreateCustomer({
        businessId: input.businessId,
        fullName: nextState.customerName ?? 'Customer',
        phoneNumber: nextState.customerPhone ?? '',
        correlationId
      });
      const selectedSlot = nextState.selectedSlot ?? nextState.proposedSlots[0];
      if (!selectedSlot) {
        return {
          message: 'I lost the selected time. Please choose a slot again.',
          state: applyAssistantUpdate(nextState, { bookingConfirmationStatus: 'failed' }),
          toolStatus,
          requiresUserAction: true
        };
      }
      const booking = await this.adapter.createBooking({
        businessId: input.businessId,
        serviceId: nextState.serviceId ?? '',
        customerId: customer.customerId,
        slotId: selectedSlot.slotId,
        startsAt: selectedSlot.startsAt,
        staffId: selectedSlot.staffId,
        idempotencyKey: `${nextState.conversationId}:${selectedSlot.slotId}`,
        correlationId
      });
      await this.adapter.sendConfirmation({
        businessId: input.businessId,
        bookingId: booking.bookingId,
        customerPhone: customer.phoneNumber,
        customerName: customer.fullName,
        channel: nextState.channel,
        correlationId
      });
      nextState = applyAssistantUpdate(nextState, {
        bookingId: booking.bookingId,
        bookingConfirmationStatus: 'confirmed',
        selectedSlot
      });
      return {
        message: `Booked. ${nextState.requestedService ?? 'The service'} is confirmed for ${customer.fullName} at ${selectedSlot.startsAt}.`,
        state: nextState,
        toolStatus,
        requiresUserAction: false
      };
    }

    if (nextState.bookingConfirmationStatus === 'pending' && declinesConfirmation(lower)) {
      nextState = applyAssistantUpdate(nextState, { bookingConfirmationStatus: 'declined' });
      return {
        message: 'No problem. Would you like a different time or should I connect you with a person?',
        state: nextState,
        toolStatus,
        requiresUserAction: true
      };
    }

    return {
      message: 'Tell me the service and the time you want, and I will check availability.',
      state: nextState,
      toolStatus,
      requiresUserAction: true
    };
  }
}

export const createAgent = (adapter: BusinessAdapter): ReceptionistAgent => new ReceptionistAgent(adapter);
