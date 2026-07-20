export type HealthResponse = {
  ok?: boolean;
  status?: string;
  service?: string;
  message?: string;
};

export type ToolStatus = {
  name: string;
  status: 'pending' | 'ok' | 'error';
  latencyMs?: number;
};

export type BookingSlot = {
  slotId: string;
  startsAt: string;
  endsAt: string;
  staffId?: string;
  staffName?: string;
};

export type ConversationStateSnapshot = {
  requestedService?: string;
  customerName?: string;
  customerPhone?: string;
  selectedSlot?: BookingSlot;
  proposedSlots?: BookingSlot[];
  bookingConfirmationStatus?: 'unconfirmed' | 'pending' | 'confirmed' | 'failed' | string;
  conversationId?: string;
};

export type ChatRequest = {
  text: string;
  state?: ConversationStateSnapshot;
  interrupted?: boolean;
};

export type ChatResponse = {
  message: string;
  state?: ConversationStateSnapshot;
  toolStatus?: ToolStatus[];
  requiresUserAction: boolean;
};

export type RealtimeSessionResponse = {
  businessId: string;
  conversationId: string;
  ephemeralSessionToken: string;
  webrtcUrl: string;
  expiresAt: string;
  model?: string;
};

export type FrontendEnv = {
  VITE_RECEPTIONIST_API_URL?: string;
};
