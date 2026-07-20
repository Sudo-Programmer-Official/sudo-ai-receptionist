export class BusinessIdMismatchError extends Error {
  readonly status = 403;

  constructor(
    public readonly requestedBusinessId: string,
    public readonly configuredBusinessId: string,
  ) {
    super('BUSINESS_ID_MISMATCH');
    this.name = 'BusinessIdMismatchError';
  }
}

export const resolveBusinessId = (input: {
  businessAdapter: 'mock' | 'salonflow';
  configuredBusinessId: string;
  requestedBusinessId: string | undefined;
}): string => {
  const requested = input.requestedBusinessId?.trim();

  if (input.businessAdapter !== 'salonflow') {
    return requested || input.configuredBusinessId;
  }

  if (!input.configuredBusinessId.trim()) {
    throw new Error('SALONFLOW_BUSINESS_ID is required');
  }

  if (!requested) {
    return input.configuredBusinessId;
  }

  if (requested !== input.configuredBusinessId) {
    throw new BusinessIdMismatchError(requested, input.configuredBusinessId);
  }

  return requested;
};
