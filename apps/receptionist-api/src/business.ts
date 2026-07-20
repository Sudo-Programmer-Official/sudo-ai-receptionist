export class BusinessIdMismatchError extends Error {
  readonly status = 403;
  readonly code = 'business_not_allowed';

  constructor(
    public readonly requestedBusinessId: string,
    public readonly configuredBusinessId: string,
  ) {
    super('BUSINESS_ID_MISMATCH');
    this.name = 'BusinessIdMismatchError';
  }
}

export class ServerMisconfiguredError extends Error {
  readonly status = 500;
  readonly code = 'server_misconfigured';

  constructor(public readonly configuredBusinessId: string) {
    super('SERVER_MISCONFIGURED');
    this.name = 'ServerMisconfiguredError';
  }
}

export const resolveBusinessId = (input: {
  businessAdapter: 'mock' | 'salonflow';
  configuredBusinessId: string | undefined;
  requestedBusinessId: string | undefined;
}): string => {
  const requested = input.requestedBusinessId?.trim();
  const configured = input.configuredBusinessId?.trim() ?? '';

  if (input.businessAdapter !== 'salonflow') {
    return requested || configured || 'demo-salon';
  }

  if (!configured) {
    throw new ServerMisconfiguredError(input.configuredBusinessId ?? '');
  }

  if (!requested) {
    return configured;
  }

  if (requested !== configured) {
    throw new BusinessIdMismatchError(requested, configured);
  }

  return requested;
};

export const resolveChatText = (input: { text?: string; message?: string }): string =>
  input.text?.trim() || input.message?.trim() || '';
