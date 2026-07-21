import type {
  BusinessAdapter,
  BusinessProfile,
  ServiceOffering
} from '@sudo-ai-receptionist/business-contracts';
import { performance } from 'node:perf_hooks';
import {
  applyAssistantUpdate,
  createConversationState,
  type ConversationState
} from '@sudo-ai-receptionist/conversation-state';
import {
  createCorrelationId,
  formatCustomerConfirmationMessage,
  formatCustomerSuccessMessage,
  formatSlotForCustomer,
  formatSlotOptions,
  normalizeAppointmentIntent,
  selectSlotFromUtterance,
} from '@sudo-ai-receptionist/shared';

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

const BUSINESS_TIME_ZONE_FALLBACK = 'America/Chicago';
const resolveBusinessTimezone = (state: ConversationState): string =>
  state.timezone?.trim() || state.businessProfile?.timezone?.trim() || BUSINESS_TIME_ZONE_FALLBACK;

type SelectableSlot = {
  slotId: string;
  startsAt: string;
  endsAt: string;
  staffId?: string | undefined;
  staffName?: string | undefined;
};

const asSelectableSlots = (slots: ReadonlyArray<SelectableSlot>): ReadonlyArray<SelectableSlot> => slots;

const SPELLED_DIGIT_MAP: Record<string, string> = {
  zero: '0',
  oh: '0',
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
};

const formatSelectionPrompt = (slots: ReadonlyArray<{ startsAt: string }>, timezone: string): string => {
  const labels = slots.slice(0, 3).map((slot) => formatSlotForCustomer(slot.startsAt, timezone).spokenLabel);
  if (labels.length === 0) {
    return 'Please choose one of the available times first.';
  }
  if (labels.length === 1) {
    return `Please choose one of the available times first: ${labels[0]}.`;
  }
  if (labels.length === 2) {
    return `Please choose one of the available times first: ${labels[0]} and ${labels[1]}.`;
  }
  return `Please choose one of the available times first: ${labels[0]}, ${labels[1]}, and ${labels[2]}.`;
};

const logEmptyAvailabilityDiagnostics = async (input: {
  adapter: BusinessAdapter;
  businessId: string;
  businessTimezone: string;
  preferredDate: string;
  preferredTimeRange?: string;
  serviceId: string;
  serviceDurationMinutes: number | null;
  businessHoursFound: number;
  correlationId: string;
  diagnostics?: Partial<{
    staffWorkingWindowsFound: number | undefined;
    blockedIntervalsFound: number | undefined;
    candidateSlotsGenerated: number | undefined;
    finalSlotsReturned: number | undefined;
  }>;
}): Promise<void> => {
  let activeStaffConsidered: number | undefined;
  let staffAssignedToService: number | undefined;
  try {
    const staff = await input.adapter.listStaff({
      businessId: input.businessId,
      correlationId: input.correlationId,
    });
    activeStaffConsidered = staff.length;
    staffAssignedToService = staff.filter((member) => member.services.includes(input.serviceId)).length;
  } catch {
    activeStaffConsidered = undefined;
    staffAssignedToService = undefined;
  }

  console.info(JSON.stringify({
    scope: 'receptionist-agent',
    event: 'empty_availability_diagnostics',
    businessTimezone: input.businessTimezone,
    preferredDate: input.preferredDate,
    preferredTimeRange: input.preferredTimeRange ?? 'none',
    serviceId: input.serviceId,
    serviceDurationMinutes: input.serviceDurationMinutes ?? 0,
    activeStaffConsidered: activeStaffConsidered ?? 0,
    staffAssignedToService: staffAssignedToService ?? 0,
    businessHoursFound: input.businessHoursFound,
    staffWorkingWindowsFound: input.diagnostics?.staffWorkingWindowsFound ?? 0,
    blockedIntervalsFound: input.diagnostics?.blockedIntervalsFound ?? 0,
    candidateSlotsGeneratedBeforeFiltering: input.diagnostics?.candidateSlotsGenerated ?? 0,
    finalSlotsReturned: input.diagnostics?.finalSlotsReturned ?? 0,
  }));
};

const findService = (services: ServiceOffering[], text: string): ServiceOffering | undefined => {
  const normalized = normalize(text);
  return services.find((service) => normalized.includes(normalize(service.name)) || normalized.includes(normalize(service.serviceId)));
};

const extractPhone = (text: string): string | undefined => {
  const explicitMatch = text.match(/(\+?\d[\d\s().-]{6,}\d)/);
  if (explicitMatch?.[1]) {
    const digits = explicitMatch[1].replace(/\D/g, '');
    return digits.length >= 10 ? digits : undefined;
  }

  const tokens = [...text.toLowerCase().matchAll(/\b(?:zero|oh|one|two|three|four|five|six|seven|eight|nine|\d)\b/g)];
  const digits = tokens
    .map((match) => {
      const token = match[0];
      if (/^\d$/.test(token)) {
        return token;
      }
      return SPELLED_DIGIT_MAP[token] ?? '';
    })
    .join('');

  return digits.length >= 10 ? digits : undefined;
};

const extractName = (text: string): string | undefined => {
  const normalized = text
    .trim()
    .replace(/[.!?]+$/, '')
    .replace(/\s+/g, ' ');
  if (!normalized) {
    return undefined;
  }

  if (/\b(?:book|schedule|appointment|availability|available|time|slot)\b/i.test(normalized) && /\b(?:tomorrow|today|next|at|\d{1,2}|\d{4})\b/i.test(normalized)) {
    return undefined;
  }

  const prefixedMatch = normalized.match(/^(?:my name is|this is|it'?s|its|call me)\s+(.+)$/i);
  const candidate = prefixedMatch?.[1] ?? normalized;
  const bareName = candidate
    .trim()
    .replace(/[.!?]+$/, '')
    .replace(/\s+/g, ' ');

  if (!bareName) {
    return undefined;
  }

  if (/^(yes|no|ok|okay|confirm|book it|please|thanks|thank you|tomorrow|today|tonight)$/i.test(bareName)) {
    return undefined;
  }
  if (/\b(first|second|third|earliest|latest|option one|option two|option three)\b/i.test(bareName)) {
    return undefined;
  }
  const hasSchedulingCue = /\b(appointment|book|schedule|service|haircut|cut|color|style|wash|blowout|trim|beard)\b/i.test(bareName);
  const hasTimeCue = /\b(today|tomorrow|tonight|morning|afternoon|evening|am|pm|next|this|at)\b/i.test(bareName) || /\d/.test(bareName);
  const hasBookingIntent = /\b(i want|i need|want|need|book|schedule|appointment|service)\b/i.test(bareName);
  if ((hasSchedulingCue && hasTimeCue) || (hasBookingIntent && hasSchedulingCue)) {
    return undefined;
  }
  if (/\d/.test(bareName) || /[:@]/.test(bareName)) {
    return undefined;
  }
  if (!/^[a-z]+(?:[ -][a-z]+){0,3}$/i.test(bareName)) {
    return undefined;
  }
  return bareName;
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
    const timeTool = async <T>(name: string, operation: () => Promise<T>): Promise<T> => {
      const startedAt = performance.now();
      try {
        const result = await operation();
        toolStatus.push({ name, status: 'ok', latencyMs: Math.round(performance.now() - startedAt) });
        return result;
      } catch (error) {
        toolStatus.push({ name, status: 'error', latencyMs: Math.round(performance.now() - startedAt) });
        throw error;
      }
    };

    if (!nextState.businessProfile) {
      const businessProfile: BusinessProfile = await timeTool('getBusinessProfile', () =>
        this.adapter.getBusinessProfile({ businessId: input.businessId, correlationId })
      );
      nextState = applyAssistantUpdate(nextState, { businessProfile });
      if (!nextState.timezone) {
        const resolvedTimezone = businessProfile.timezone?.trim() || BUSINESS_TIME_ZONE_FALLBACK;
        nextState = applyAssistantUpdate(nextState, { timezone: resolvedTimezone });
        if (!businessProfile.timezone?.trim()) {
          console.warn(JSON.stringify({
            scope: 'receptionist-agent',
            event: 'missing_business_timezone',
            businessId: input.businessId,
            correlationId,
            fallbackTimezone: BUSINESS_TIME_ZONE_FALLBACK,
          }));
        }
      }
    }

    if (!nextState.services) {
      const services = await timeTool('listServices', () =>
        this.adapter.listServices({ businessId: input.businessId, correlationId })
      );
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

    const businessTimezone = resolveBusinessTimezone(nextState);

    const parsedAppointment = normalizeAppointmentIntent({
      text: trimmed,
      currentTimestamp: new Date(),
      businessTimezone,
    });
    if (parsedAppointment.status === 'parsed') {
      nextState = applyAssistantUpdate(nextState, {
        ...(parsedAppointment.preferredDate ? { preferredDate: parsedAppointment.preferredDate } : {}),
        ...(parsedAppointment.preferredTimeRange ? { preferredTimeRange: parsedAppointment.preferredTimeRange } : {}),
      });
    } else if (!nextState.preferredDate) {
      return {
        message: parsedAppointment.status === 'invalid'
          ? 'I could not parse that date and time. What day and time would you prefer?'
          : 'What day and time would you prefer?',
        state: nextState,
        toolStatus,
        requiresUserAction: true
      };
    }

    if (!nextState.preferredDate) {
      return {
        message: nextState.preferredTimeRange
          ? 'What day would you prefer for that time?'
          : 'What day and time would you prefer?',
        state: nextState,
        toolStatus,
        requiresUserAction: true
      };
    }

    if (nextState.serviceId && nextState.proposedSlots.length === 0) {
      const serviceId = nextState.serviceId;
      const availability = await timeTool('findAvailability', () =>
        this.adapter.findAvailability({
          businessId: input.businessId,
          serviceId,
          preferredDate: nextState.preferredDate ?? '',
          preferredTimeRange: nextState.preferredTimeRange,
          limit: 3,
          correlationId
        })
      );
      nextState = applyAssistantUpdate(nextState, { proposedSlots: availability.slots });
      if (availability.slots.length === 0) {
        const requestedService = services.find((service) => service.serviceId === serviceId);
        const diagnostics = availability.diagnostics;
        const emptyAvailabilityInput = {
          adapter: this.adapter,
          businessId: input.businessId,
          businessTimezone,
          preferredDate: nextState.preferredDate ?? '',
          serviceId,
          serviceDurationMinutes: requestedService?.durationMinutes ?? null,
          businessHoursFound: nextState.businessProfile?.hours?.length ?? 0,
          correlationId,
          diagnostics: {
            staffWorkingWindowsFound: diagnostics?.staffWorkingWindowsFound,
            blockedIntervalsFound: diagnostics?.blockedIntervalsFound,
            candidateSlotsGenerated: diagnostics?.candidateSlotsGenerated,
            finalSlotsReturned: diagnostics?.finalSlotsReturned,
          },
          ...(nextState.preferredTimeRange ? { preferredTimeRange: nextState.preferredTimeRange } : {}),
        };
        void logEmptyAvailabilityDiagnostics(emptyAvailabilityInput);
        return {
          message: formatSlotOptions([], businessTimezone),
          state: nextState,
          toolStatus,
          requiresUserAction: true
        };
      }
      return {
        message: formatSlotOptions(asSelectableSlots(availability.slots), businessTimezone),
        state: nextState,
        toolStatus,
        requiresUserAction: true
      };
    }

    if (nextState.proposedSlots.length > 0 && !nextState.selectedSlot) {
      const selectedSlot = selectSlotFromUtterance(asSelectableSlots(nextState.proposedSlots), trimmed, businessTimezone);
      if (selectedSlot) {
        nextState = applyAssistantUpdate(nextState, {
          selectedSlot,
        });
      }
      if (!nextState.selectedSlot) {
        return {
          message: formatSelectionPrompt(asSelectableSlots(nextState.proposedSlots), businessTimezone),
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
        return {
          message: `Thanks, ${name}. What phone number should I use?`,
          state: nextState,
          toolStatus,
          requiresUserAction: true
        };
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
      const slotPresentation = formatSlotForCustomer(slot.startsAt, businessTimezone, new Date());
      const customerName = nextState.customerName ?? 'the customer';
      const customerPhone = nextState.customerPhone ?? '';
      return {
        message: formatCustomerConfirmationMessage({
          serviceName: nextState.requestedService ?? 'the service',
          customerName,
          customerPhone,
          staffName: slot.staffName ?? 'your stylist',
          localDateLabel: slotPresentation.spokenDate,
          localTimeLabel: slotPresentation.spokenLabel,
        }),
        state: nextState,
        toolStatus,
        requiresUserAction: true
      };
    }

    if (nextState.bookingConfirmationStatus === 'pending' && wantsConfirmation(lower)) {
      const customer = await timeTool('findOrCreateCustomer', () =>
        this.adapter.findOrCreateCustomer({
          businessId: input.businessId,
          fullName: nextState.customerName ?? 'Customer',
          phoneNumber: nextState.customerPhone ?? '',
          correlationId
        })
      );
      const selectedSlot = nextState.selectedSlot ?? nextState.proposedSlots[0];
      if (!selectedSlot) {
        return {
          message: 'I lost the selected time. Please choose a slot again.',
          state: applyAssistantUpdate(nextState, { bookingConfirmationStatus: 'failed' }),
          toolStatus,
          requiresUserAction: true
        };
      }
      const booking = await timeTool('createBooking', () =>
        this.adapter.createBooking({
          businessId: input.businessId,
          serviceId: nextState.serviceId ?? '',
          customerId: customer.customerId,
          slotId: selectedSlot.slotId,
          startsAt: selectedSlot.startsAt,
          staffId: selectedSlot.staffId,
          idempotencyKey: `${nextState.conversationId}:${selectedSlot.slotId}`,
          correlationId
        })
      );
      await timeTool('sendConfirmation', () =>
        this.adapter.sendConfirmation({
          businessId: input.businessId,
          bookingId: booking.bookingId,
          customerPhone: customer.phoneNumber,
          customerName: customer.fullName,
          channel: nextState.channel,
          correlationId
        })
      );
      nextState = applyAssistantUpdate(nextState, {
        bookingId: booking.bookingId,
        bookingConfirmationStatus: 'confirmed',
        selectedSlot
      });
      const slotPresentation = formatSlotForCustomer(selectedSlot.startsAt, businessTimezone, new Date());
      return {
        message: formatCustomerSuccessMessage({
          serviceName: nextState.requestedService ?? 'The service',
          customerName: customer.fullName,
          customerPhone: customer.phoneNumber,
          staffName: selectedSlot.staffName ?? 'your stylist',
          localDateLabel: slotPresentation.spokenDate,
          localTimeLabel: slotPresentation.spokenLabel,
        }),
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
