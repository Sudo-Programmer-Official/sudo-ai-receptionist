import dayjs, { type Dayjs } from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';
import timezone from 'dayjs/plugin/timezone.js';
import utc from 'dayjs/plugin/utc.js';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(customParseFormat);

dayjs.locale('en');

const WEEKDAY_ORDER = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/;
const DISPLAY_DATE_PATTERN = /^(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:st|nd|rd|th)?(?:,\s*)?\d{4}$/i;
const DISPLAY_TIME_PATTERN = /^\d{1,2}:\d{2}\s?(?:AM|PM)$/i;
const ISO_DATE_CAPTURE = /\b\d{4}-\d{2}-\d{2}\b/;
const DISPLAY_DATE_CAPTURE = /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:st|nd|rd|th)?(?:,\s*)?\d{4}\b/i;
const IANA_TIME_ZONES = typeof Intl !== 'undefined' && typeof Intl.supportedValuesOf === 'function'
  ? new Set(Intl.supportedValuesOf('timeZone'))
  : null;

export class InvalidUtcTimestampError extends Error {
  readonly code = 'invalid_utc_timestamp';

  constructor(value: string) {
    super(`Invalid UTC timestamp: ${value}`);
    this.name = 'InvalidUtcTimestampError';
  }
}

export type NormalizeAppointmentIntentInput = {
  text: string;
  currentTimestamp: string | Date;
  businessTimezone: string;
  serviceDurationMinutes?: number;
};

export type NormalizedAppointmentIntent = {
  status: 'parsed' | 'invalid' | 'missing';
  preferredDate?: string;
  preferredTimeRange?: 'morning' | 'afternoon' | 'evening' | string;
  requestedLocalTime?: string;
};

export type SlotLike = {
  slotId: string;
  startsAt: string;
  endsAt: string;
  staffId?: string | undefined;
  staffName?: string | undefined;
};

export type SlotPresentation = {
  localDate: string;
  localTime: string;
  spokenDate: string;
  spokenLabel: string;
};

const shieldTemporalValues = (value: string): { text: string; tokens: Array<{ token: string; value: string }> } => {
  const tokens: Array<{ token: string; value: string }> = [];
  let nextToken = 0;

  const replaceMatches = (text: string, pattern: RegExp): string =>
    text.replace(pattern, (match) => {
      const token = `__DATE_TOKEN_${nextToken++}__`;
      tokens.push({ token, value: match });
      return token;
    });

  let text = value;
  text = replaceMatches(text, ISO_DATE_PATTERN);
  text = replaceMatches(text, ISO_TIMESTAMP_PATTERN);
  text = replaceMatches(text, DISPLAY_DATE_PATTERN);
  text = replaceMatches(text, DISPLAY_TIME_PATTERN);
  return { text, tokens };
};

const restoreDates = (value: string, tokens: Array<{ token: string; value: string }>): string =>
  tokens.reduce((text, token) => text.replaceAll(token.token, token.value), value);

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const toUtc = (value: string | Date): Dayjs => (value instanceof Date ? dayjs.utc(value) : dayjs.utc(value));

export const isSupportedTimeZone = (value: string): boolean => {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  if (IANA_TIME_ZONES) {
    return IANA_TIME_ZONES.has(trimmed);
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: trimmed }).format(new Date());
    return true;
  } catch {
    return false;
  }
};

export const validateUtcTimestamp = (value: string): Dayjs => {
  const parsed = dayjs.utc(value);
  if (!parsed.isValid()) {
    throw new InvalidUtcTimestampError(value);
  }
  return parsed;
};

const formatHourLabel = (hour24: number, minute: number): string => {
  const normalizedHour = ((hour24 % 24) + 24) % 24;
  const hour12 = normalizedHour % 12 || 12;
  const meridiem = normalizedHour < 12 ? 'am' : 'pm';
  return minute === 0 ? `${hour12}${meridiem}` : `${hour12}:${String(minute).padStart(2, '0')}${meridiem}`;
};

const formatReadableTimeRange = (startHour: number, startMinute: number, endHour: number, endMinute: number): string => {
  const startLabel = formatHourLabel(startHour, startMinute);
  const endLabel = formatHourLabel(endHour, endMinute);
  return `${startLabel}-${endLabel}`;
};

const parseClockToken = (value: string): { hour: number; minute: number; meridiem?: 'am' | 'pm' } | null => {
  const match = value.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!match) {
    return null;
  }
  const hour = Number.parseInt(match[1] ?? '', 10);
  const minute = Number.parseInt(match[2] ?? '0', 10);
  const meridiem = match[3]?.toLowerCase() as 'am' | 'pm' | undefined;
  if (!Number.isFinite(hour) || hour < 1 || hour > 12 || !Number.isFinite(minute) || minute < 0 || minute > 59) {
    return null;
  }
  const token: { hour: number; minute: number; meridiem?: 'am' | 'pm' } = { hour, minute };
  if (meridiem !== undefined) {
    token.meridiem = meridiem;
  }
  return token;
};

const to24Hour = (hour: number, meridiem?: 'am' | 'pm'): number => {
  if (meridiem === 'am') {
    return hour % 12;
  }
  if (meridiem === 'pm') {
    return (hour % 12) + 12;
  }
  return hour % 12;
};

const parseExplicitTime = (text: string): { requestedLocalTime: string; preferredTimeRange: string } | null => {
  const rangeMatch = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:to|-)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
  if (rangeMatch) {
    const start = parseClockToken(`${rangeMatch[1] ?? ''}${rangeMatch[2] ? `:${rangeMatch[2]}` : ''}${rangeMatch[3] ? ` ${rangeMatch[3]}` : ''}`);
    const end = parseClockToken(`${rangeMatch[4] ?? ''}${rangeMatch[5] ? `:${rangeMatch[5]}` : ''}${rangeMatch[6] ? ` ${rangeMatch[6]}` : ''}`);
    if (!start || !end) {
      return null;
    }
    const startHour24 = to24Hour(start.hour, start.meridiem);
    const endMeridiem = end.meridiem ?? start.meridiem;
    let endHour24 = to24Hour(end.hour, endMeridiem);
    if (endHour24 <= startHour24) {
      endHour24 += 12;
    }
    return {
      requestedLocalTime: `${String(startHour24).padStart(2, '0')}:${String(start.minute).padStart(2, '0')}`,
      preferredTimeRange: formatReadableTimeRange(startHour24, start.minute, endHour24, end.minute),
    };
  }

  const meridiemMatches = [...text.matchAll(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/gi)];
  const meridiemMatch = meridiemMatches.at(-1);
  if (meridiemMatch) {
    const hour = Number.parseInt(meridiemMatch[1] ?? '', 10);
    const minute = Number.parseInt(meridiemMatch[2] ?? '0', 10);
    const meridiem = meridiemMatch[3]?.toLowerCase() as 'am' | 'pm' | undefined;
    if (!Number.isFinite(hour) || hour < 1 || hour > 12 || !Number.isFinite(minute) || minute < 0 || minute > 59 || !meridiem) {
      return null;
    }
    const localHour = to24Hour(hour, meridiem);
    return {
      requestedLocalTime: `${String(localHour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
      preferredTimeRange: formatReadableTimeRange(localHour, minute, localHour + 1, minute),
    };
  }

  const bareMatches = [...text.matchAll(/(?:^|[^\d])(\d{1,2}):(\d{2})(?!\d)/g)];
  const bareMatch = bareMatches.at(-1);
  if (!bareMatch) {
    return null;
  }
  const hour = Number.parseInt(bareMatch[1] ?? '', 10);
  const minute = Number.parseInt(bareMatch[2] ?? '0', 10);
  if (!Number.isFinite(hour) || hour < 1 || hour > 12 || !Number.isFinite(minute) || minute < 0 || minute > 59) {
    return null;
  }
  const localHour = to24Hour(hour);
  return {
    requestedLocalTime: `${String(localHour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
    preferredTimeRange: formatReadableTimeRange(localHour, minute, localHour + 1, minute),
  };
};

const parseExplicitDate = (text: string, businessTimezone: string): string | null => {
  const isoMatch = text.match(ISO_DATE_CAPTURE)?.[0];
  if (isoMatch) {
    const parsed = dayjs(isoMatch, 'YYYY-MM-DD', true);
    if (parsed.isValid()) {
      return parsed.tz(businessTimezone).format('YYYY-MM-DD');
    }
  }

  const displayMatch = text.match(DISPLAY_DATE_CAPTURE)?.[0];
  if (displayMatch) {
    const parsed = dayjs(displayMatch, ['MMMM D, YYYY', 'MMMM D YYYY'], true);
    if (parsed.isValid()) {
      return parsed.tz(businessTimezone).format('YYYY-MM-DD');
    }
  }

  return null;
};

const parseRelativeDate = (text: string, currentTimestamp: string | Date, businessTimezone: string): string | null => {
  const current = dayjs.utc(currentTimestamp).tz(businessTimezone);
  if (!current.isValid()) {
    return null;
  }

  if (/\btoday\b/i.test(text)) {
    return current.format('YYYY-MM-DD');
  }
  if (/\btomorrow\b/i.test(text)) {
    return current.add(1, 'day').format('YYYY-MM-DD');
  }

  const weekdayMatch = text.match(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i);
  if (!weekdayMatch) {
    return null;
  }

  const weekdayName = weekdayMatch[1]?.toLowerCase();
  if (!weekdayName) {
    return null;
  }
  const targetIndex = WEEKDAY_ORDER.indexOf(weekdayName as (typeof WEEKDAY_ORDER)[number]);
  if (targetIndex < 0) {
    return null;
  }

  const offset = (targetIndex - current.day() + 7) % 7 || 7;
  return current.add(offset, 'day').format('YYYY-MM-DD');
};

export const normalizeAppointmentIntent = (input: NormalizeAppointmentIntentInput): NormalizedAppointmentIntent => {
  const text = input.text.trim();
  if (!text) {
    return { status: 'missing' };
  }

  const explicitDate = parseExplicitDate(text, input.businessTimezone);
  const relativeDate = explicitDate ? null : parseRelativeDate(text, input.currentTimestamp, input.businessTimezone);
  const preferredDate = explicitDate ?? relativeDate ?? undefined;

  const explicitTimeMatches = [...text.matchAll(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/gi)];
  const explicitTimeMatch = explicitTimeMatches.at(-1);
  const explicitTime = explicitTimeMatch
    ? (() => {
        const hour = Number.parseInt(explicitTimeMatch[1] ?? '', 10);
        const minute = Number.parseInt(explicitTimeMatch[2] ?? '0', 10);
        const meridiem = explicitTimeMatch[3]?.toLowerCase() as 'am' | 'pm' | undefined;
        if (!Number.isFinite(hour) || hour < 1 || hour > 12 || !Number.isFinite(minute) || minute < 0 || minute > 59 || !meridiem) {
          return null;
        }
        const localHour = to24Hour(hour, meridiem);
        return {
          requestedLocalTime: `${String(localHour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
          preferredTimeRange: formatReadableTimeRange(localHour, minute, localHour + 1, minute),
        } satisfies { requestedLocalTime: string; preferredTimeRange: string };
      })()
    : null;
  const timeRangeText = text.toLowerCase();
  const rangeLabel = /\bmorning\b/.test(timeRangeText)
    ? 'morning'
    : /\bafternoon\b/.test(timeRangeText)
      ? 'afternoon'
      : /\bevening\b/.test(timeRangeText)
        ? 'evening'
        : undefined;

  const dateMentioned =
    /\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(text) ||
    /\b\d{4}-\d{2}-\d{2}\b/.test(text) ||
    /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\b/i.test(text);
  const timeMentioned = explicitTime !== null || Boolean(rangeLabel) || /\b\d{1,2}:\d{2}\b/i.test(text);

  if (!preferredDate) {
    if (dateMentioned) {
      return { status: 'invalid' };
    }
    if (!timeMentioned) {
      return { status: 'missing' };
    }
  }

  const normalized: NormalizedAppointmentIntent = {
    status: 'parsed',
  };
  if (preferredDate !== undefined) {
    normalized.preferredDate = preferredDate;
  }
  const preferredTimeRange = explicitTime?.preferredTimeRange ?? rangeLabel;
  if (preferredTimeRange !== undefined) {
    normalized.preferredTimeRange = preferredTimeRange;
  }
  if (explicitTime?.requestedLocalTime !== undefined) {
    normalized.requestedLocalTime = explicitTime.requestedLocalTime;
  }
  return normalized;
};

export const formatSlotForCustomer = (
  startsAtUtc: string,
  timezone: string,
  currentTimestamp: string | Date = new Date(),
): SlotPresentation => {
  const parsed = validateUtcTimestamp(startsAtUtc);
  const local = parsed.tz(timezone);
  const currentLocal = toUtc(currentTimestamp).tz(timezone);

  let spokenDate = local.format('dddd, MMMM D');
  if (local.isSame(currentLocal, 'day')) {
    spokenDate = 'today';
  } else if (local.isSame(currentLocal.add(1, 'day'), 'day')) {
    spokenDate = 'tomorrow';
  }

  return {
    localDate: local.format('YYYY-MM-DD'),
    localTime: local.format('h:mm A'),
    spokenDate,
    spokenLabel: local.format('h:mm A'),
  };
};

export const formatTimeZoneLabel = (timezone: string): string => {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'longGeneric',
    }).formatToParts(new Date());
    return parts.find((part) => part.type === 'timeZoneName')?.value ?? timezone;
  } catch {
    return timezone;
  }
};

export const formatSlotOptions = (
  slots: ReadonlyArray<SlotLike>,
  timezone: string,
  currentTimestamp: string | Date = new Date(),
): string => {
  if (slots.length === 0) {
    return 'I couldn’t find an opening at that time. Would you like me to check another time tomorrow?';
  }

  const presentations = slots.slice(0, 3).map((slot) => formatSlotForCustomer(slot.startsAt, timezone, currentTimestamp));
  const firstPresentation = presentations[0];
  const slotDate = firstPresentation?.spokenDate ?? 'that day';
  if (presentations.length === 1) {
    return `I found an opening ${slotDate} at ${firstPresentation?.spokenLabel ?? 'that time'}. Would you like that time?`;
  }

  const labels = presentations.map((slot) => slot.spokenLabel);
  const prefix = presentations.length === 3 ? 'three openings' : `${presentations.length} openings`;
  const listText = labels.length === 2
    ? `${labels[0]} and ${labels[1]}`
    : `${labels.slice(0, -1).join(', ')}, and ${labels[labels.length - 1]}`;

  return `I found ${prefix} ${slotDate}: ${listText}. Which one works best?`;
};

const parseTimeSelection = (utterance: string): { hour: number; minute: number; meridiem?: 'am' | 'pm' } | null => {
  const match = utterance.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
  if (!match) {
    return null;
  }
  const hour = Number.parseInt(match[1] ?? '', 10);
  const minute = Number.parseInt(match[2] ?? '0', 10);
  const meridiem = match[3]?.toLowerCase() as 'am' | 'pm' | undefined;
  if (!Number.isFinite(hour) || hour < 1 || hour > 12 || !Number.isFinite(minute) || minute < 0 || minute > 59) {
    return null;
  }
  const selection: { hour: number; minute: number; meridiem?: 'am' | 'pm' } = { hour, minute };
  if (meridiem !== undefined) {
    selection.meridiem = meridiem;
  }
  return selection;
};

export const selectSlotFromUtterance = <T extends SlotLike>(
  slots: ReadonlyArray<T>,
  utterance: string,
  timezone: string,
  currentTimestamp: string | Date = new Date(),
): T | null => {
  if (slots.length === 0) {
    return null;
  }

  const lower = utterance.trim().toLowerCase();
  if (!lower) {
    return null;
  }

  if (/\b(first|earliest|1st|the first one|the first|option one)\b/.test(lower)) {
    return slots[0] ?? null;
  }
  if (/\bsecond\b/.test(lower)) {
    return slots[1] ?? null;
  }
  if (/\bthird\b/.test(lower)) {
    return slots[2] ?? null;
  }

  const timeSelection = parseTimeSelection(lower);
  if (!timeSelection) {
    return null;
  }

  const timeMatches = slots.find((slot) => {
    const presentation = formatSlotForCustomer(slot.startsAt, timezone, currentTimestamp);
    const slotTime = dayjs.tz(`${presentation.localDate} ${presentation.localTime}`, 'YYYY-MM-DD h:mm A', timezone);
    if (!slotTime.isValid()) {
      return false;
    }
    const slotHour = slotTime.hour();
    const slotMinute = slotTime.minute();
    const normalizedHour = timeSelection.meridiem
      ? ((timeSelection.hour % 12) + (timeSelection.meridiem === 'pm' ? 12 : 0))
      : timeSelection.hour % 24;
    return slotHour === normalizedHour && slotMinute === timeSelection.minute;
  });

  return timeMatches ?? null;
};

export const redactPhoneNumber = (value: string): string => {
  const { text, tokens } = shieldTemporalValues(value);
  const redacted = text
    .replace(/\(\d{3}\)\s*\d{3}[\s.-]?\d{4}/g, '[redacted-phone]')
    .replace(/(?<!\d)(\+?\d[\d\s().-]{6,}\d)(?!\d)/g, '[redacted-phone]');
  return restoreDates(redacted, tokens);
};

export const redactPersonData = (value: string): string => {
  const { text, tokens } = shieldTemporalValues(value);
  const redacted = redactPhoneNumber(text).replace(/\b[A-Z][a-z]+ [A-Z][a-z]+\b/g, '[redacted-name]');
  return restoreDates(redacted, tokens);
};

export const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, signal?: AbortSignal): Promise<T> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);
  const onAbort = () => controller.abort(signal?.reason ?? new Error('Aborted'));
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true })),
    ]);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', onAbort);
  }
};

export const retry = async <T>(
  operation: () => Promise<T>,
  options: { retries: number; backoffMs: number; shouldRetry: (error: unknown) => boolean },
): Promise<T> => {
  let attempt = 0;
  let lastError: unknown;
  while (attempt <= options.retries) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === options.retries || !options.shouldRetry(error)) {
        throw error;
      }
      await sleep(options.backoffMs * Math.max(1, attempt + 1));
      attempt += 1;
    }
  }
  throw lastError;
};

export const sanitizeErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return redactPersonData(error.message).replace(/[A-Za-z0-9+/=]{20,}/g, '[redacted-token]');
  }
  return 'Unknown error';
};

export type RuntimeAdapter = 'mock' | 'salonflow';

export type RuntimeConfig = {
  businessAdapter: RuntimeAdapter;
  receptionistApiPort: number;
  salonflowBaseUrl?: string;
  salonflowIntegrationToken?: string;
  salonflowBusinessId?: string;
  openaiApiKey?: string | undefined;
  openaiRealtimeModel?: string | undefined;
};

const isPlaceholderValue = (value: string): boolean => {
  const normalized = value.trim().toLowerCase();
  return (
    normalized === 'replace-me' ||
    normalized === 'demo-tenant' ||
    normalized.includes('staging.salonflow.example') ||
    normalized.includes('example.com') ||
    normalized.includes('todo') ||
    normalized.includes('changeme')
  );
};

const readRequiredValue = (env: Record<string, string | undefined>, key: string): string => {
  const value = env[key];
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  if (isPlaceholderValue(value)) {
    throw new Error(`Environment variable ${key} still contains a placeholder value`);
  }
  return value.trim();
};

const readOptionalValue = (env: Record<string, string | undefined>, key: string): string | undefined => {
  const value = env[key];
  if (!value || !value.trim()) return undefined;
  if (isPlaceholderValue(value)) {
    throw new Error(`Environment variable ${key} still contains a placeholder value`);
  }
  return value.trim();
};

export const loadRuntimeConfig = (
  env: Record<string, string | undefined>,
  options?: { requireOpenAi?: boolean },
): RuntimeConfig => {
  const businessAdapterRaw = env.BUSINESS_ADAPTER?.trim().toLowerCase() || 'mock';
  if (businessAdapterRaw !== 'mock' && businessAdapterRaw !== 'salonflow') {
    throw new Error('BUSINESS_ADAPTER must be either "mock" or "salonflow"');
  }
  if ((env.NODE_ENV?.trim().toLowerCase() ?? '') === 'production' && businessAdapterRaw !== 'salonflow') {
    throw new Error('BUSINESS_ADAPTER must equal "salonflow" in production');
  }

  const portRaw = env.PORT ?? env.RECEPTIONIST_API_PORT ?? '8787';
  const receptionistApiPort = Number.parseInt(portRaw, 10);
  if (!Number.isFinite(receptionistApiPort) || receptionistApiPort <= 0) {
    throw new Error('Invalid PORT or RECEPTIONIST_API_PORT');
  }

  const openaiApiKey = options?.requireOpenAi ? readRequiredValue(env, 'OPENAI_API_KEY') : readOptionalValue(env, 'OPENAI_API_KEY');
  const openaiRealtimeModel = options?.requireOpenAi
    ? readRequiredValue(env, 'OPENAI_REALTIME_MODEL')
    : readOptionalValue(env, 'OPENAI_REALTIME_MODEL');

  const config: RuntimeConfig = {
    businessAdapter: businessAdapterRaw,
    receptionistApiPort,
  };

  if (openaiApiKey !== undefined) {
    config.openaiApiKey = openaiApiKey;
  }
  if (openaiRealtimeModel !== undefined) {
    config.openaiRealtimeModel = openaiRealtimeModel;
  }

  if (businessAdapterRaw === 'salonflow') {
    config.salonflowBaseUrl = readRequiredValue(env, 'SALONFLOW_BASE_URL');
    config.salonflowIntegrationToken = readRequiredValue(env, 'SALONFLOW_INTEGRATION_TOKEN');
    config.salonflowBusinessId = readRequiredValue(env, 'SALONFLOW_BUSINESS_ID');
  }

  return config;
};

export const validateEnvironment = (
  input: Record<string, string | undefined>,
  required: string[],
): Record<string, string> => {
  const output: Record<string, string> = {};
  for (const key of required) {
    const value = input[key];
    if (!value) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
    output[key] = value;
  }
  return output;
};

export * from './datetime.js';
