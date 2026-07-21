import { describe, expect, test } from 'vitest';
import {
  formatSlotForCustomer,
  formatSlotOptions,
  InvalidUtcTimestampError,
  isSupportedTimeZone,
  normalizeAppointmentIntent,
  redactPhoneNumber,
  redactPersonData,
  selectSlotFromUtterance,
  validateUtcTimestamp,
} from '../src/index.js';

describe('datetime utilities', () => {
  test.each([
    ['tomorrow at 11am', '2026-07-21', '11am-12pm', '11:00'],
    ['tomorrow afternoon', '2026-07-21', 'afternoon', undefined],
    ['July 21, 2026 at 11:00 AM', '2026-07-21', '11am-12pm', '11:00'],
    ['2026-07-21 11:00 AM', '2026-07-21', '11am-12pm', '11:00'],
  ])('normalizes %s', (text, expectedDate, expectedTimeRange, expectedRequestedLocalTime) => {
    const result = normalizeAppointmentIntent({
      text,
      currentTimestamp: '2026-07-20T23:30:00.000Z',
      businessTimezone: 'America/Chicago',
    });

    expect(result.status).toBe('parsed');
    expect(result.preferredDate).toBe(expectedDate);
    expect(result.preferredTimeRange).toBe(expectedTimeRange);
    if (expectedRequestedLocalTime) {
      expect(result.requestedLocalTime).toBe(expectedRequestedLocalTime);
    } else {
      expect(result.requestedLocalTime).toBeUndefined();
    }
  });

  test('treats near-midnight tomorrow in the business timezone, not the browser timezone', () => {
    const result = normalizeAppointmentIntent({
      text: 'tomorrow at 11am',
      currentTimestamp: '2026-07-21T04:30:00.000Z',
      businessTimezone: 'America/Chicago',
    });

    expect(result.status).toBe('parsed');
    expect(result.preferredDate).toBe('2026-07-21');
  });

  test('accepts supported IANA time zones and rejects invalid ones', () => {
    expect(isSupportedTimeZone('America/Denver')).toBe(true);
    expect(isSupportedTimeZone('Not/A_TimeZone')).toBe(false);
  });

  test('formats UTC slots in America/Chicago and America/Denver', () => {
    const chicago = formatSlotForCustomer('2026-07-21T16:00:00.000Z', 'America/Chicago', '2026-07-20T12:00:00.000Z');
    const denver = formatSlotForCustomer('2026-07-21T16:00:00.000Z', 'America/Denver', '2026-07-20T12:00:00.000Z');

    expect(chicago.localDate).toBe('2026-07-21');
    expect(chicago.localTime).toBe('11:00 AM');
    expect(chicago.spokenDate).toBe('tomorrow');
    expect(chicago.spokenLabel).toBe('11:00 AM');

    expect(denver.localDate).toBe('2026-07-21');
    expect(denver.localTime).toBe('10:00 AM');
    expect(denver.spokenLabel).toBe('10:00 AM');
  });

  test('formats a DST transition slot into a valid local time', () => {
    const presentation = formatSlotForCustomer('2026-03-08T09:30:00.000Z', 'America/Denver', '2026-03-08T08:00:00.000Z');
    expect(presentation.localDate).toBe('2026-03-08');
    expect(presentation.localTime).toBe('3:30 AM');
  });

  test('rejects invalid UTC timestamps', () => {
    expect(() => validateUtcTimestamp('not-a-timestamp')).toThrow(InvalidUtcTimestampError);
  });

  test('formats three slots into natural spoken output', () => {
    const message = formatSlotOptions(
      [
        { slotId: 'slot-1', startsAt: '2026-07-21T16:00:00.000Z', endsAt: '2026-07-21T16:30:00.000Z' },
        { slotId: 'slot-2', startsAt: '2026-07-21T16:15:00.000Z', endsAt: '2026-07-21T16:45:00.000Z' },
        { slotId: 'slot-3', startsAt: '2026-07-21T16:30:00.000Z', endsAt: '2026-07-21T17:00:00.000Z' },
      ],
      'America/Chicago',
      '2026-07-20T12:00:00.000Z',
    );

    expect(message).toBe('I found three openings tomorrow: 11:00 AM, 11:15 AM, and 11:30 AM. Which one works best?');
    expect(message).not.toContain('2026-07-21T');
  });

  test('keeps ISO dates and timestamps out of phone redaction paths', () => {
    const customerFacing = formatSlotOptions(
      [
        { slotId: 'slot-1', startsAt: '2026-07-21T16:00:00.000Z', endsAt: '2026-07-21T16:30:00.000Z' },
      ],
      'America/Chicago',
      '2026-07-20T12:00:00.000Z',
    );

    expect(customerFacing).not.toContain('2026-07-21T16:00:00.000Z');
    expect(redactPhoneNumber('2026-07-21T16:00:00.000Z')).toBe('2026-07-21T16:00:00.000Z');
    expect(redactPhoneNumber('2026-07-21')).toBe('2026-07-21');
    expect(redactPhoneNumber('July 21, 2026')).toBe('July 21, 2026');
    expect(redactPhoneNumber('11:00 AM')).toBe('11:00 AM');
    expect(redactPersonData('Call 555-123-4567 for July 21, 2026 at 11:00 AM')).toBe('Call [redacted-phone] for July 21, 2026 at 11:00 AM');
  });

  test('maps a selection phrase back to the original slot object', () => {
    const slots = [
      { slotId: 'slot-1', startsAt: '2026-07-21T16:00:00.000Z', endsAt: '2026-07-21T16:30:00.000Z', staffId: 'staff-a' },
      { slotId: 'slot-2', startsAt: '2026-07-21T16:15:00.000Z', endsAt: '2026-07-21T16:45:00.000Z', staffId: 'staff-b' },
    ] as const;

    expect(selectSlotFromUtterance(slots, 'the first one', 'America/Chicago', '2026-07-20T12:00:00.000Z')).toEqual(slots[0]);
    expect(selectSlotFromUtterance(slots, '11:15', 'America/Chicago', '2026-07-20T12:00:00.000Z')).toEqual(slots[1]);
  });
});
