import type {
  BookingRecord,
  BusinessAdapter,
  BusinessProfile,
  ServiceOffering
} from '@sudo-ai-receptionist/business-contracts';
import { performance } from 'node:perf_hooks';
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

const BUSINESS_TIME_ZONE_FALLBACK = 'America/Chicago';

const MONTHS: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

const WEEKDAYS: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

type ParsedAvailabilityIntent =
  | { kind: 'parsed'; preferredDate: string; preferredTimeRange?: string }
  | { kind: 'invalid' }
  | { kind: 'missing' };

const getZonedDateParts = (date: Date, timeZone: string): { year: number; month: number; day: number; weekday: number } => {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'long',
  });
  const parts = formatter.formatToParts(date);
  const getPart = (type: Intl.DateTimeFormatPartTypes): string => parts.find((part) => part.type === type)?.value ?? '';
  const yearPart = getPart('year');
  const monthPart = getPart('month');
  const dayPart = getPart('day');
  const weekdayPart = getPart('weekday');
  if (!yearPart || !monthPart || !dayPart || !weekdayPart) {
    throw new Error(`Failed to read date parts for time zone ${timeZone}`);
  }
  const year = Number.parseInt(yearPart, 10);
  const month = Number.parseInt(monthPart, 10);
  const day = Number.parseInt(dayPart, 10);
  const weekdayName = weekdayPart.toLowerCase();
  const weekday = WEEKDAYS[weekdayName] ?? 0;
  return { year, month, day, weekday };
};

const formatDateIso = (year: number, month: number, day: number): string => `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

const isValidCalendarDate = (year: number, month: number, day: number): boolean => {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};

const addCalendarDays = (isoDate: string, days: number): string => {
  const parts = isoDate.split('-');
  if (parts.length !== 3) {
    throw new Error(`Invalid ISO date: ${isoDate}`);
  }
  const [yearPart, monthPart, dayPart] = parts;
  if (!yearPart || !monthPart || !dayPart) {
    throw new Error(`Invalid ISO date: ${isoDate}`);
  }
  const year = Number.parseInt(yearPart, 10);
  const month = Number.parseInt(monthPart, 10);
  const day = Number.parseInt(dayPart, 10);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
};

const formatHourLabel = (hour24: number): string => {
  const normalizedHour = ((hour24 % 24) + 24) % 24;
  const hour12 = normalizedHour % 12 || 12;
  return `${hour12}${normalizedHour < 12 ? 'am' : 'pm'}`;
};

const formatHourRange = (hour24: number): string => `${formatHourLabel(hour24)}-${formatHourLabel(hour24 + 1)}`;

const parseRelativeDate = (text: string, timeZone: string): { preferredDate: string } | null => {
  const today = getZonedDateParts(new Date(), timeZone);
  const todayIso = formatDateIso(today.year, today.month, today.day);
  if (/\btoday\b/i.test(text)) {
    return { preferredDate: todayIso };
  }
  if (/\btomorrow\b/i.test(text)) {
    return { preferredDate: addCalendarDays(todayIso, 1) };
  }

  const weekdayMatch = text.match(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i);
  if (weekdayMatch) {
    const weekdayName = weekdayMatch[1]?.toLowerCase();
    if (!weekdayName) {
      return null;
    }
    const targetWeekday = WEEKDAYS[weekdayName];
    if (targetWeekday === undefined) {
      return null;
    }
    const offset = (targetWeekday - today.weekday + 7) % 7 || 7;
    return { preferredDate: addCalendarDays(todayIso, offset) };
  }

  return null;
};

const parseExplicitDate = (text: string): string | null => {
  const isoMatch = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (isoMatch) {
    const [yearPart, monthPart, dayPart] = [isoMatch[1], isoMatch[2], isoMatch[3]];
    if (!yearPart || !monthPart || !dayPart) {
      return null;
    }
    const year = Number.parseInt(yearPart, 10);
    const month = Number.parseInt(monthPart, 10);
    const day = Number.parseInt(dayPart, 10);
    return isValidCalendarDate(year, month, day) ? formatDateIso(year, month, day) : null;
  }

  const monthMatch = text.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,)?\s+(\d{4})\b/i);
  if (!monthMatch) {
    return null;
  }

  const monthName = monthMatch[1]?.toLowerCase();
  if (!monthName) {
    return null;
  }
  const month = MONTHS[monthName];
  if (!month) {
    return null;
  }
  const dayPart = monthMatch[2];
  const yearPart = monthMatch[3];
  if (!dayPart || !yearPart) {
    return null;
  }
  const day = Number.parseInt(dayPart, 10);
  const year = Number.parseInt(yearPart, 10);
  return isValidCalendarDate(year, month, day) ? formatDateIso(year, month, day) : null;
};

const parseTimeRange = (text: string): string | null => {
  const lower = text.toLowerCase();
  const timeMatch = lower.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  if (timeMatch) {
    const hourPart = timeMatch[1];
    const meridiem = timeMatch[3];
    if (!hourPart || !meridiem) {
      return null;
    }
    const rawHour = Number.parseInt(hourPart, 10);
    const minute = Number.parseInt(timeMatch[2] ?? '0', 10);

    if (!Number.isFinite(rawHour) || rawHour < 1 || rawHour > 12 || !Number.isFinite(minute) || minute < 0 || minute > 59) {
      return null;
    }

    const hour24 = meridiem === 'am'
      ? rawHour % 12
      : (rawHour % 12) + 12;
    return formatHourRange(hour24);
  }

  if (/\bmorning\b/.test(lower)) {
    return 'morning';
  }
  if (/\bafternoon\b/.test(lower)) {
    return 'afternoon';
  }
  if (/\bevening\b/.test(lower)) {
    return 'evening';
  }
  return null;
};

const parseAvailabilityIntent = (text: string, timeZone: string): ParsedAvailabilityIntent => {
  const explicitDate = parseExplicitDate(text);
  const relativeDate = explicitDate ? null : parseRelativeDate(text, timeZone);
  const preferredDate = explicitDate ?? relativeDate?.preferredDate;
  if (!preferredDate) {
    return /\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{4}-\d{2}-\d{2}|january|february|march|april|may|june|july|august|september|october|november|december)\b/i.test(text)
      ? { kind: 'invalid' }
      : { kind: 'missing' };
  }

  const preferredTimeRange = parseTimeRange(text) ?? undefined;
  if (
    /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i.test(text) &&
    !preferredTimeRange
  ) {
    return { kind: 'invalid' };
  }

  return {
    kind: 'parsed',
    preferredDate,
    ...(preferredTimeRange ? { preferredTimeRange } : {}),
  };
};

const formatDisplayDateShort = (isoDate: string): string => {
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return isoDate;
  }
  const year = Number.parseInt(match[1] ?? '', 10);
  const month = Number.parseInt(match[2] ?? '', 10);
  const day = Number.parseInt(match[3] ?? '', 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return isoDate;
  }
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, day)));
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
  const match = text.match(/(\+?\d[\d\s().-]{6,}\d)/);
  return match?.[1]?.replace(/\s+/g, ' ').trim();
};

const extractName = (text: string): string | undefined => {
  const match = text.match(/(?:i'?m|my name is|this is)\s+([a-z]+(?:\s+[a-z]+){0,2})/i);
  return match?.[1]?.trim();
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

    if (!nextState.preferredDate) {
      const timeZone = nextState.businessProfile?.timezone?.trim() || BUSINESS_TIME_ZONE_FALLBACK;
      const parsedAvailability = parseAvailabilityIntent(trimmed, timeZone);
      if (parsedAvailability.kind === 'parsed') {
        nextState = applyAssistantUpdate(nextState, {
          preferredDate: parsedAvailability.preferredDate,
          ...(parsedAvailability.preferredTimeRange ? { preferredTimeRange: parsedAvailability.preferredTimeRange } : {}),
        });
      } else {
        return {
          message: parsedAvailability.kind === 'invalid'
            ? 'I could not parse that date and time. What day and time would you prefer?'
            : 'What day and time would you prefer?',
          state: nextState,
          toolStatus,
          requiresUserAction: true
        };
      }
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
          businessTimezone: nextState.businessProfile?.timezone?.trim() || BUSINESS_TIME_ZONE_FALLBACK,
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
          message: `I couldn’t find an opening for ${nextState.requestedService ?? 'that service'} on ${formatDisplayDateShort(nextState.preferredDate ?? '')}. Would you like me to check the afternoon or another day?`,
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
