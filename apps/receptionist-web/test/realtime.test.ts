import { describe, expect, test } from 'vitest';
import { getTranscriptEventDeduplicationKey } from '../src/realtime';

describe('realtime transcript dedupe', () => {
  test('uses item or event ids to suppress duplicate transcript events', () => {
    const first = {
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: 'item-123',
      transcript: 'Abhi',
    };
    const duplicateByItem = {
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: 'item-123',
      transcript: 'Abhi',
    };
    const duplicateByEvent = {
      type: 'conversation.item.input_audio_transcription.completed',
      event_id: 'evt-456',
      item_id: 'item-123',
      transcript: 'Abhi',
    };

    const seen = new Set<string>();
    const firstKey = getTranscriptEventDeduplicationKey(first);
    const duplicateItemKey = getTranscriptEventDeduplicationKey(duplicateByItem);
    const duplicateEventKey = getTranscriptEventDeduplicationKey(duplicateByEvent);

    expect(firstKey).toBe('item-123');
    expect(duplicateItemKey).toBe('item-123');
    expect(duplicateEventKey).toBe('evt-456');

    if (firstKey) {
      seen.add(firstKey);
    }
    expect(seen.has(duplicateItemKey ?? '')).toBe(true);
    expect(seen.has(duplicateEventKey ?? '')).toBe(false);
  });
});
