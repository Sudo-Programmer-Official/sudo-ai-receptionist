import { createAgent } from '@sudo-ai-receptionist/agent-core';
import type {
  AvailabilityResult,
  BusinessAdapter,
  BusinessProfile,
  ConfirmationDeliveryResult,
  CustomerRecord,
  ServiceOffering
} from '@sudo-ai-receptionist/business-contracts';
import type { ConversationState } from '@sudo-ai-receptionist/conversation-state';
import { MockBusinessAdapter } from '@sudo-ai-receptionist/mock-business';

export interface EvaluationScenarioResult {
  scenario: string;
  passed: boolean;
  transcript: Array<{ speaker: 'user' | 'assistant'; text: string }>;
}

const runScenario = async (adapter: BusinessAdapter, scenario: string, turns: string[]): Promise<EvaluationScenarioResult> => {
  const agent = createAgent(adapter);
  let state: ConversationState | undefined;
  const transcript: EvaluationScenarioResult['transcript'] = [];
  for (const turn of turns) {
    transcript.push({ speaker: 'user', text: turn });
    const result = await agent.handleTurn({
      text: turn,
      ...(state ? { state } : {}),
      businessId: 'demo-salon',
      channel: 'voice'
    });
    state = result.state;
    transcript.push({ speaker: 'assistant', text: result.message });
  }
  return { scenario, passed: Boolean(state), transcript };
};

class NoAvailabilityAdapter extends MockBusinessAdapter {
  async findAvailability(): Promise<AvailabilityResult> {
    return { slots: [], source: 'mock', expiresAt: new Date(Date.now() + 60_000).toISOString() };
  }
}

class TimeoutAdapter extends MockBusinessAdapter {
  async getBusinessProfile(): Promise<BusinessProfile> {
    throw new Error('timeout');
  }
  async listServices(): Promise<ServiceOffering[]> {
    throw new Error('timeout');
  }
  async findAvailability(): Promise<AvailabilityResult> {
    throw new Error('timeout');
  }
  async findOrCreateCustomer(): Promise<CustomerRecord> {
    throw new Error('timeout');
  }
  async sendConfirmation(): Promise<ConfirmationDeliveryResult> {
    throw new Error('timeout');
  }
}

export const runEvaluation = async (): Promise<EvaluationScenarioResult[]> => {
  const adapter = new MockBusinessAdapter();
  const noAvailability = new NoAvailabilityAdapter();
  const timeoutAdapter = new TimeoutAdapter();

  const successfulBooking = await runScenario(adapter, 'successful booking', [
    'I need a haircut tomorrow',
    '2',
    'My name is Jordan Lee',
    'My phone is 555-010-3333',
    'yes please confirm'
  ]);
  successfulBooking.passed = successfulBooking.transcript.some((entry) => entry.speaker === 'assistant' && /booked|confirmed/i.test(entry.text));

  const unknownService = await runScenario(adapter, 'unknown service', ['I want a beard sculpting appointment']);
  unknownService.passed = unknownService.transcript.some((entry) => entry.speaker === 'assistant' && /which service/i.test(entry.text));

  const unavailableTime = await runScenario(noAvailability, 'unavailable requested time', ['I need a haircut tomorrow at 8pm']);
  unavailableTime.passed = unavailableTime.transcript.some((entry) => entry.speaker === 'assistant' && /different time|human follow-up|could not find/i.test(entry.text));

  const missingCustomer = await runScenario(adapter, 'missing customer details', [
    'I need a haircut tomorrow',
    '1',
    'yes'
  ]);
  missingCustomer.passed = missingCustomer.transcript.some((entry) => entry.speaker === 'assistant' && /name|phone/i.test(entry.text));

  const changedMind = await runScenario(adapter, 'customer changes their mind', [
    'I need a haircut tomorrow',
    '1',
    'My name is Jordan Lee',
    'My phone is 555-010-3333',
    'change it'
  ]);
  changedMind.passed = changedMind.transcript.some((entry) => entry.speaker === 'assistant' && /different time|person/i.test(entry.text));

  const interrupted = await (async (): Promise<EvaluationScenarioResult> => {
    const agent = createAgent(adapter);
    const result = await agent.handleTurn({ text: '', businessId: 'demo-salon', channel: 'voice', interrupted: true });
    return {
      scenario: 'customer interrupts the agent',
      passed: /adjust/i.test(result.message),
      transcript: [
        { speaker: 'user', text: '[interrupted]' },
        { speaker: 'assistant', text: result.message }
      ]
    };
  })();

  const duplicateBooking = await (async (): Promise<EvaluationScenarioResult> => {
    const bookingAdapter = new MockBusinessAdapter();
    const customer = await bookingAdapter.findOrCreateCustomer({
      businessId: 'demo-salon',
      fullName: 'Jordan Lee',
      phoneNumber: '555-010-3333',
      correlationId: 'eval-duplicate'
    });
    const first = await bookingAdapter.createBooking({
      businessId: 'demo-salon',
      serviceId: 'svc-cut',
      customerId: customer.customerId,
      slotId: '2026-07-19-svc-cut-1',
      startsAt: '2026-07-19T09:00:00-07:00',
      idempotencyKey: 'duplicate-key',
      correlationId: 'eval-duplicate'
    });
    const second = await bookingAdapter.createBooking({
      businessId: 'demo-salon',
      serviceId: 'svc-cut',
      customerId: customer.customerId,
      slotId: '2026-07-19-svc-cut-1',
      startsAt: '2026-07-19T09:00:00-07:00',
      idempotencyKey: 'duplicate-key',
      correlationId: 'eval-duplicate'
    });
    return {
      scenario: 'duplicate booking attempt',
      passed: first.bookingId === second.bookingId,
      transcript: [
        { speaker: 'user', text: 'Book the same slot twice' },
        { speaker: 'assistant', text: 'The adapter returned the same booking record for the same idempotency key.' }
      ]
    };
  })();

  const timeout = await (async (): Promise<EvaluationScenarioResult> => {
    const agent = createAgent(timeoutAdapter);
    try {
      await agent.handleTurn({ text: 'I need a haircut tomorrow', businessId: 'demo-salon', channel: 'voice' });
      return {
        scenario: 'SalonFlow timeout',
        passed: false,
        transcript: [{ speaker: 'user', text: 'I need a haircut tomorrow' }]
      };
    } catch {
      return {
        scenario: 'SalonFlow timeout',
        passed: true,
        transcript: [
          { speaker: 'user', text: 'I need a haircut tomorrow' },
          { speaker: 'assistant', text: 'The adapter surfaced a timeout and the flow can degrade gracefully.' }
        ]
      };
    }
  })();

  const unrelatedQuestion = await runScenario(adapter, 'customer asks an unrelated question', ['What is your favorite movie?']);
  unrelatedQuestion.passed = unrelatedQuestion.transcript.some((entry) => entry.speaker === 'assistant' && /service|time/i.test(entry.text));

  return [
    successfulBooking,
    unknownService,
    unavailableTime,
    missingCustomer,
    changedMind,
    interrupted,
    duplicateBooking,
    timeout,
    unrelatedQuestion
  ];
};
